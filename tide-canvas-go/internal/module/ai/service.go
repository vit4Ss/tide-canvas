package ai

import (
	"fmt"
	"strings"
	"time"

	"github.com/shopspring/decimal"
	"github.com/sirupsen/logrus"
	"gorm.io/datatypes"
	"gorm.io/gorm"

	"github.com/tidecanvas/tide-canvas-go/internal/model"
	"github.com/tidecanvas/tide-canvas-go/pkg/ecode"
)

// Service AI 生成业务编排（忠实迁移 AiServiceImpl + AiTaskRunner + AiTaskRecoveryRunner）。
// 业务错误返回 *ecode.Error。
type Service struct {
	repo     *Repository
	db       *gorm.DB
	gateway  *Gateway
	registry *handlerRegistry

	points   PointsService
	teamMember TeamMemberProvider
	teamPrice  TeamPriceProvider
	project    ProjectFinder
	fileSaver  FileSaver // 可空：nil 时结果直接存上游原 URL
	logger     *logrus.Logger
}

// 编译期断言：Service 实现 logSink（接收 client 产出的上游日志并落库）。
var _ logSink = (*Service)(nil)

// NewService 构造 AI 服务。
//
// 依赖注入：
//   - repo        本模块 Repository。
//   - cfg         上游轮询/重试/超时参数（router 从 config ai.relay.* / ai.runware.* 读取）。
//   - points      points.Service（扣/退积分）。
//   - teamMember  team.Service（GetTeamMemberIDs，任务/历史共享口径）。
//   - teamPrice   team.Service（GetPriceFactor，计费加价系数）。
//   - project     画布归属校验（默认 NewDBProjectFinder(db)）。
//   - fileSaver   结果转存（可空；nil → 存上游原 URL）。
//   - logger      可空。
func NewService(
	repo *Repository,
	cfg ClientConfig,
	points PointsService,
	teamMember TeamMemberProvider,
	teamPrice TeamPriceProvider,
	project ProjectFinder,
	fileSaver FileSaver,
	logger *logrus.Logger,
) *Service {
	s := &Service{
		repo:       repo,
		db:         repo.DB(),
		points:     points,
		teamMember: teamMember,
		teamPrice:  teamPrice,
		project:    project,
		fileSaver:  fileSaver,
		logger:     logger,
	}
	// gateway 的 logSink 即本 service（client 调用日志回填任务归属后落库）。
	s.gateway = NewGateway(repo, cfg, s, logger)
	s.registry = newHandlerRegistry(s.gateway, logger)
	return s
}

// Gateway 暴露上游网关（供管理端 AdminService 复用其 Runware 客户端做 modelSearch / 拉取模型列表）。
func (s *Service) Gateway() *Gateway { return s.gateway }

// StartRecoveryScheduler 启动定时超时收尾（首次延迟 5 分钟，之后按 scanMs 周期；缺省/<=0 用 5 分钟）。
// 对齐 AiTaskRecoveryRunner.recoverTimedOut 的 @Scheduled(initialDelay=300000, fixedDelay=ai.task.timeout-scan-ms:300000)。
// 用独立 goroutine + ticker（无需额外 cron 依赖）。进程退出随之结束。
func StartRecoveryScheduler(svc *Service, scanMs int64, logger *logrus.Logger) {
	period := time.Duration(scanMs) * time.Millisecond
	if period <= 0 {
		period = 5 * time.Minute
	}
	go func() {
		defer func() {
			if r := recover(); r != nil && logger != nil {
				logger.Errorf("AI 任务超时收尾调度 panic: %v", r)
			}
		}()
		// 首次延迟 5 分钟，避免与启动收尾撞车。
		time.Sleep(5 * time.Minute)
		ticker := time.NewTicker(period)
		defer ticker.Stop()
		svc.RecoverTimedOut()
		for range ticker.C {
			svc.RecoverTimedOut()
		}
	}()
}

// ===== 用户接口 =====

// Generate 统一生成入口（对齐 AiServiceImpl.generate）。
// 流程：校验项目归属 → 取 handler 并校验 input → 计费 → 事务内建 ai_task + 扣积分 → 异步/同步执行。
func (s *Service) Generate(userID int64, dto *GenerateDTO) (*TaskVO, error) {
	// 1) 项目归属（团队共享：成员可在队友项目内生成，计费仍扣本人积分）
	projectID, err := s.assertProjectOwned(userID, dto.ProjectID)
	if err != nil {
		return nil, err
	}

	// 1.5) 并发上限：按用户等级（团队 > VIP > 普通）取一档上限；管理员(role=9)与白名单用户豁免。0=不限。
	if role, inTeam, uname := s.repo.GetUserTier(userID); role != 9 {
		if !inWhitelist(uname, s.repo.GetConfigStr("ai.concurrency_whitelist")) {
			if limit := s.resolveConcurrencyLimit(role, inTeam); limit > 0 {
				active, cErr := s.repo.CountActiveTasksByUser(userID, TaskProcessing)
				if cErr != nil {
					return nil, cErr
				}
				if active >= int64(limit) {
					return nil, ecode.RateLimit.WithMessage(fmt.Sprintf("当前进行中的 AI 任务已达上限 %d 个，请等待已有任务完成后再试", limit))
				}
			}
		}
	}

	// 2) handler + 入参校验
	handler, ok := s.registry.get(dto.Handler)
	if !ok {
		return nil, ecode.HandlerNotFound.WithMessage("Handler不存在: " + dto.Handler)
	}
	if err := handler.validate(dto.Input); err != nil {
		return nil, ecode.BadRequest.WithMessage(err.Error())
	}

	// 3) 计费：单价 = model.pricing/pointCost × 张数 × 团队系数，向上取整为整数积分
	selectedModel, err := s.findModel(dto.ModelID)
	if err != nil {
		return nil, err
	}
	unitCost, err := s.resolvePointCost(selectedModel, dto.Handler, dto.Input)
	if err != nil {
		return nil, err
	}
	teamFactor := decimal.NewFromInt(1)
	if s.teamPrice != nil {
		teamFactor = s.teamPrice.GetPriceFactor(userID)
	}
	total := unitCost.
		Mul(decimal.NewFromInt(int64(batchCountOf(dto.Input)))).
		Mul(teamFactor)
	pointCost := ceilToInt(total)

	// 4) 事务：建任务 + 扣积分
	var modelPK *int64
	var modelName string
	if selectedModel != nil {
		id := selectedModel.ID
		modelPK = &id
		modelName = selectedModel.Name
	}
	var pid *int64
	if projectID != 0 {
		pid = &projectID
	}
	task := &model.AiTask{
		UserID:      userID,
		ProjectID:   pid,
		HandlerName: dto.Handler,
		ModelID:     modelPK,
		Status:      TaskProcessing,
		Progress:    0,
		Cost:        decimal.NewFromInt(int64(pointCost)),
		InputParams: toJSON(dto.Input),
	}
	err = s.db.Transaction(func(tx *gorm.DB) error {
		if err := s.repo.CreateTask(tx, task); err != nil {
			return err
		}
		if pointCost > 0 {
			bizID := task.ID
			if err := s.points.DeductPointsTx(tx, userID, pointCost, txTypeAIConsume, &bizID, "AI生成: "+dto.Handler); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}

	// 5) 执行（异步 goroutine 轮询上游 / 同步阻塞）
	if handler.async() {
		go s.runAsync(task.ID, handler, dto.ModelID, dto.Input, pointCost)
	} else {
		s.executeSync(task, handler, dto.ModelID, dto.Input, pointCost)
	}

	return s.toTaskVO(task, modelName), nil
}

// resolveConcurrencyLimit 按用户等级取并发上限：团队成员 > VIP > 普通，各自独立配置（0=不限）。
func (s *Service) resolveConcurrencyLimit(role int, inTeam bool) int {
	if inTeam {
		return s.repo.GetConfigInt("ai.user_max_concurrency_team", 0)
	}
	if role == 1 { // VIP
		return s.repo.GetConfigInt("ai.user_max_concurrency_vip", 0)
	}
	return s.repo.GetConfigInt("ai.user_max_concurrency", 0)
}

// inWhitelist 判断用户名是否在并发白名单（逗号分隔，大小写不敏感）内。
func inWhitelist(username, whitelist string) bool {
	if strings.TrimSpace(whitelist) == "" || username == "" {
		return false
	}
	for _, w := range strings.Split(whitelist, ",") {
		if strings.EqualFold(strings.TrimSpace(w), username) {
			return true
		}
	}
	return false
}

// GetTask 按 public_id 查任务状态（前端轮询；团队共享：成员可查队友任务，对齐 getTask）。
func (s *Service) GetTask(userID int64, publicID string) (*TaskVO, error) {
	task, err := s.repo.FindTaskByPublicID(publicID)
	if err != nil {
		return nil, err
	}
	members, err := s.teamMembers(userID)
	if err != nil {
		return nil, err
	}
	if task == nil || !containsInt64(members, task.UserID) {
		return nil, ecode.NotFound.WithMessage("任务不存在")
	}
	return s.toTaskVOWithModel(task), nil
}

// CancelTask 取消任务（仅本人；对齐 cancelTask）。CAS 取消成功则退款。
func (s *Service) CancelTask(userID int64, publicID string) error {
	task, err := s.repo.FindTaskByPublicID(publicID)
	if err != nil {
		return err
	}
	if task == nil || task.UserID != userID {
		return ecode.NotFound.WithMessage("任务不存在")
	}
	affected, err := s.repo.CancelIfProcessing(task.ID, userID)
	if err != nil {
		return err
	}
	if affected > 0 {
		pointCost := intFromDecimal(task.Cost)
		s.refundPoints(userID, pointCost, task.ID, "AI生成失败返还")
	}
	return nil
}

// ListTasks 我的任务分页（团队共享口径，对齐 listTasks）。
func (s *Service) ListTasks(userID int64, q *TaskQuery) ([]TaskVO, int64, error) {
	q.normalize()
	members, err := s.teamMembers(userID)
	if err != nil {
		return nil, 0, err
	}
	var projectID *int64
	if hasText(q.ProjectID) {
		pid, ok, err := s.project.ResolveProjectID(q.ProjectID)
		if err != nil {
			return nil, 0, err
		}
		if !ok {
			return []TaskVO{}, 0, nil // 项目不存在 → 空结果
		}
		projectID = &pid
	}
	tasks, total, err := s.repo.PageTasks(members, q.Handler, q.Status, projectID, &q.PageQuery)
	if err != nil {
		return nil, 0, err
	}
	return s.toTaskVOList(tasks), total, nil
}

// ListModels 可用模型列表（用户侧脱敏 costPerCall，对齐 listModels）。
func (s *Service) ListModels() ([]ModelVO, error) {
	models, err := s.repo.ListEnabledModels()
	if err != nil {
		return nil, err
	}
	out := make([]ModelVO, 0, len(models))
	for i := range models {
		vo := toModelVO(&models[i], "")
		vo.CostPerCall = nil // 上游成本对用户脱敏
		out = append(out, vo)
	}
	return out, nil
}

// ListHandlers 可用 handler 列表（status=1 按 sort_order，对齐 listHandlers）。
func (s *Service) ListHandlers() ([]HandlerVO, error) {
	configs, err := s.repo.ListEnabledHandlers()
	if err != nil {
		return nil, err
	}
	out := make([]HandlerVO, 0, len(configs))
	for i := range configs {
		out = append(out, toHandlerVO(&configs[i]))
	}
	return out, nil
}

// MyLogs 本画布生成历史（当前用户，团队共享，可按 projectId 过滤，对齐 AiController.myLogs）。
func (s *Service) MyLogs(userID int64, projectPublicID string, q *PageQuery) ([]GenerationLogVO, int64, error) {
	q.normalize()
	members, err := s.teamMembers(userID)
	if err != nil {
		return nil, 0, err
	}
	var projectID *int64
	if hasText(projectPublicID) {
		pid, ok, err := s.project.ResolveProjectID(projectPublicID)
		if err != nil {
			return nil, 0, err
		}
		if !ok {
			return []GenerationLogVO{}, 0, nil
		}
		projectID = &pid
	}
	logs, total, err := s.repo.PageLogsByOwners(members, projectID, q)
	if err != nil {
		return nil, 0, err
	}
	out := make([]GenerationLogVO, 0, len(logs))
	for i := range logs {
		out = append(out, toLogVO(&logs[i]))
	}
	return out, total, nil
}

// ===== 异步执行 / 同步执行（对齐 AiTaskRunner.run / AiServiceImpl.executeSync）=====

// runAsync 异步执行任务（goroutine）：执行上游 → 更新任务 → 失败退款。
// 取消竞态：执行前/后均检查 cancelled，保留取消态不覆盖（对齐 AiTaskRunner）。
func (s *Service) runAsync(taskID int64, handler aiHandler, modelID string, input map[string]interface{}, pointCost int) {
	defer func() {
		if r := recover(); r != nil && s.logger != nil {
			s.logger.Errorf("AI 异步任务 panic: taskId=%d, %v", taskID, r)
		}
	}()

	task, err := s.repo.FindTaskByID(taskID)
	if err != nil || task == nil {
		if s.logger != nil {
			s.logger.Errorf("AI task not found: taskId=%d", taskID)
		}
		return
	}
	if task.Status == TaskCancelled {
		if s.logger != nil {
			s.logger.Infof("AI task already cancelled before execution: taskId=%d", taskID)
		}
		return
	}

	failed, _ := s.executeAndFill(task, handler, modelID, input)

	// 执行完成后若任务已被取消，保留取消态不覆盖。
	latest, _ := s.repo.FindTaskByID(taskID)
	if latest != nil && latest.Status == TaskCancelled {
		if s.logger != nil {
			s.logger.Infof("AI task completed after cancellation, preserving cancelled status: taskId=%d", taskID)
		}
		return
	}

	if err := s.repo.SaveTaskResult(task); err != nil && s.logger != nil {
		s.logger.Errorf("AI task result save failed: taskId=%d, %v", taskID, err)
	}
	if failed && pointCost > 0 {
		s.refundPoints(task.UserID, pointCost, taskID, "AI生成失败返还")
	}
}

// executeSync 同步执行任务（如 creative_desc，对齐 executeSync）。
func (s *Service) executeSync(task *model.AiTask, handler aiHandler, modelID string, input map[string]interface{}, pointCost int) {
	failed, _ := s.executeAndFill(task, handler, modelID, input)
	if err := s.repo.SaveTaskResult(task); err != nil && s.logger != nil {
		s.logger.Errorf("AI sync task save failed: taskId=%d, %v", task.ID, err)
	}
	if failed {
		s.refundPoints(task.UserID, pointCost, task.ID, "AI生成失败返还")
	}
}

// executeAndFill 调用 handler 执行并把结果回填到 task（含转存）；返回 (是否失败, 错误信息)。
// recorded 为本次执行的「是否已产生上游日志」标志（per-call，goroutine 安全）：client 落库一条
// 上游日志即置位；执行结束若仍未置位（占位/同步 handler）则由本函数补记任务级 summary 日志。
func (s *Service) executeAndFill(task *model.AiTask, handler aiHandler, modelID string, input map[string]interface{}) (bool, string) {
	startMs := time.Now()
	recorded := false
	ctx := logCtx{taskID: &task.ID, userID: &task.UserID, projectID: task.ProjectID, handler: task.HandlerName, recorded: &recorded}
	pr := &taskProgress{repo: s.repo, taskID: task.ID}

	result := handler.execute(modelID, input, pr, ctx)
	failed := !result.Success
	resultURL := result.ResultURL
	errMsg := result.ErrorMsg

	// 转存：如配置 FileSaver 且结果为可转存 URL，则转存到自有 OSS（失败回退原 URL）。
	if !failed && hasText(resultURL) {
		resultURL = s.maybeSave(task.UserID, resultURL)
	}

	now := time.Now()
	if failed {
		task.Status = TaskFailed
		task.ErrorMsg = errMsg
	} else {
		task.Status = TaskSuccess
		task.ResultURL = resultURL
		if hasText(result.ResultMeta) {
			task.ResultMeta = datatypes.JSON(result.ResultMeta)
		}
		task.Progress = 100
	}
	task.CompleteTime = &now

	// 兜底任务级日志：本次执行未产生任何上游日志（如占位/同步 handler）时补一条 summary。
	if !recorded {
		s.recordSummaryLog(task, !failed, resultURL, errMsg, startMs)
	}
	return failed, errMsg
}

// maybeSave 结果转存（FileSaver 可空；非 http(s) 资源如 data: 占位图不转存）。
func (s *Service) maybeSave(userID int64, url string) string {
	if s.fileSaver == nil {
		return url
	}
	if !isHTTPURL(url) {
		return url
	}
	saved, err := s.fileSaver.SaveFromURL(userID, url)
	if err != nil || !hasText(saved) {
		if s.logger != nil {
			s.logger.Warnf("AI 结果转存失败，回退原 URL: %v", err)
		}
		return url
	}
	return saved
}

// recordSummaryLog 补记一条任务级生成日志（对齐 recordSummary(Sync)Log）。
func (s *Service) recordSummaryLog(task *model.AiTask, success bool, resultURL, errMsg string, startMs time.Time) {
	lg := &model.AiGenerationLog{
		TaskID:        &task.ID,
		UserID:        &task.UserID,
		ProjectID:     task.ProjectID,
		HandlerName:   task.HandlerName,
		OperationType: "ai_generate",
		Success:       boolToInt(success),
		ResultURL:     blankNil(resultURL),
		ErrorMsg:      blankNil(errMsg),
	}
	dur := time.Since(startMs).Milliseconds()
	lg.DurationMs = &dur
	if err := s.repo.InsertLog(lg); err != nil && s.logger != nil {
		s.logger.Warnf("Failed to record summary AI log: taskId=%d, %v", task.ID, err)
	}
}

// sink 实现 logSink：接收 client 产出的上游调用日志，回填任务归属后落库（对齐 GenerationLogRecorder.save）。
// ctx 来自本次执行（per-call），无共享可变状态。
func (s *Service) sink(lg upstreamLog, ctx logCtx) {
	const maxBody = 8000
	record := &model.AiGenerationLog{
		HandlerName:    ctx.handler,
		OperationType:  lg.OperationType,
		Model:          lg.Model,
		Operation:      lg.Operation,
		RequestURL:     lg.RequestURL,
		RequestBody:    truncate(lg.RequestBody, maxBody),
		HTTPStatus:     lg.HTTPStatus,
		ResponseBody:   truncate(lg.ResponseBody, maxBody),
		UpstreamTaskID: lg.UpstreamTaskID,
		Success:        boolToInt(lg.Success),
		ResultURL:      lg.ResultURL,
		ErrorMsg:       lg.ErrorMsg,
		Cost:           lg.Cost,
	}
	record.TaskID = ctx.taskID
	record.UserID = ctx.userID
	record.ProjectID = ctx.projectID
	dur := lg.DurationMs
	record.DurationMs = &dur
	if err := s.repo.InsertLog(record); err != nil && s.logger != nil {
		// best-effort：落库失败仅告警；recorded 标志由 client 在 sink 返回后置位（与旧 markRecorded 一致）。
		s.logger.Warnf("记录AI生成日志失败: %v", err)
	}
}

// ===== 任务收尾 / 恢复（对齐 AiTaskRecoveryRunner）=====

// RecoverOnStartup 进程就绪后收尾上一次运行遗留的「处理中」任务（必为孤儿，对齐 recoverOnStartup）。
// 由 router 在装配后调用一次。
func (s *Service) RecoverOnStartup() {
	n := s.failProcessingBefore(time.Now(), "服务重启，任务中断")
	if n > 0 && s.logger != nil {
		s.logger.Warnf("启动收尾：%d 个中断的处理中任务已标记为失败并退还积分", n)
	}
}

// RecoverTimedOut 收尾超过阈值仍处理中的任务（兜底上游卡死/goroutine 泄漏，对齐 recoverTimedOut）。
// 由 router 用 cron 定时调用（默认每 5 分钟）。
func (s *Service) RecoverTimedOut() {
	const timeoutMinutes = 15
	n := s.failProcessingBefore(time.Now().Add(-timeoutMinutes*time.Minute), "任务执行超时")
	if n > 0 && s.logger != nil {
		s.logger.Warnf("超时收尾：%d 个处理中任务超过 %d 分钟未完成，已标记为失败并退还积分", n, timeoutMinutes)
	}
}

// failProcessingBefore 将 createTime 早于 before 且仍处理中的任务 CAS 收尾为失败并幂等退款（对齐同名方法）。
func (s *Service) failProcessingBefore(before time.Time, reason string) int {
	tasks, err := s.repo.ListProcessingBefore(before)
	if err != nil {
		if s.logger != nil {
			s.logger.Errorf("收尾任务查询失败: %v", err)
		}
		return 0
	}
	done := 0
	for i := range tasks {
		t := &tasks[i]
		affected, err := s.repo.FailIfProcessing(t.ID, reason)
		if err != nil || affected != 1 {
			continue
		}
		s.refundIfNeeded(t.ID, t.UserID)
		done++
	}
	return done
}

// refundIfNeeded 按任务已扣积分退还，幂等（已有退款流水则跳过，对齐 refundIfNeeded）。
func (s *Service) refundIfNeeded(taskID, userID int64) {
	refunded, err := s.repo.CountRefundByTask(taskID)
	if err != nil || refunded > 0 {
		return
	}
	refund, err := s.repo.SumConsumeByTask(taskID)
	if err != nil || refund <= 0 {
		return
	}
	s.refundPoints(userID, refund, taskID, "任务中断返还")
}

// ===== 内部辅助 =====

// assertProjectOwned 校验项目归属（团队共享）；返回内部项目主键（无项目返回 0）。对齐 assertProjectOwned。
func (s *Service) assertProjectOwned(userID int64, projectPublicID string) (int64, error) {
	if !hasText(projectPublicID) {
		return 0, nil
	}
	projectID, ok, err := s.project.ResolveProjectID(projectPublicID)
	if err != nil {
		return 0, err
	}
	if !ok {
		return 0, ecode.Forbidden.WithMessage("无权在该项目下创建任务")
	}
	members, err := s.teamMembers(userID)
	if err != nil {
		return 0, err
	}
	count, err := s.project.CountOwnedByMembers(projectID, members)
	if err != nil {
		return 0, err
	}
	if count == 0 {
		return 0, ecode.Forbidden.WithMessage("无权在该项目下创建任务")
	}
	return projectID, nil
}

// findModel 解析模型：modelId 为空/"default" 返回 nil；否则按 model_id 查（对齐 findModel）。
func (s *Service) findModel(modelID string) (*model.AiModel, error) {
	if !hasText(modelID) || modelID == "default" {
		return nil, nil
	}
	return s.repo.FindModelByModelID(modelID)
}

// resolvePointCost 解析单价（对齐 resolvePointCost）：
// 模型 config.pricing 矩阵 → model.point_cost → handler_config.point_cost → 默认 10。
//
// 说明：旧 Java 以「字段非 null」判断是否取该价（允许 0 积分单价）。Go 侧 AiModel.PointCost /
// AiHandlerConfig.PointCost 为非指针 decimal（NULL 即零值），无法区分「未配置」与「配置为 0」。
// 故忠实取「模型存在即用其 point_cost；否则取 handler 配置的 point_cost；handler 未配置（零值）回退默认 10」。
// 与旧实现唯一差异：handler.point_cost 配为 0 时回退默认 10（旧版会取 0）；模型侧无差异（模型存在即取其值）。
func (s *Service) resolvePointCost(m *model.AiModel, handlerName string, input map[string]interface{}) (decimal.Decimal, error) {
	if m != nil {
		if matrix, ok := pricingFromConfig(string(m.Config), input, m.Type); ok {
			return matrix, nil
		}
		return m.PointCost, nil
	}
	hc, err := s.repo.FindHandlerConfig(handlerName)
	if err != nil {
		return decimal.Zero, err
	}
	if hc != nil && hc.PointCost.Sign() > 0 {
		return hc.PointCost, nil
	}
	return defaultPointCost, nil
}

// refundPoints 退还积分（best-effort，对齐 refundPoints）。
func (s *Service) refundPoints(userID int64, pointCost int, taskID int64, remark string) {
	if pointCost <= 0 {
		return
	}
	bizID := taskID
	if err := s.points.AddPoints(userID, pointCost, txTypeAIRefund, &bizID, remark); err != nil {
		if s.logger != nil {
			s.logger.Errorf("Failed to refund AI points: taskId=%d, %v", taskID, err)
		}
		return
	}
	if s.logger != nil {
		s.logger.Infof("AI points refunded: userId=%d, taskId=%d, points=%d", userID, taskID, pointCost)
	}
}

// teamMembers 团队共享可见成员ID（无 teamMember 注入时退化为本人）。
func (s *Service) teamMembers(userID int64) ([]int64, error) {
	if s.teamMember == nil {
		return []int64{userID}, nil
	}
	ids, err := s.teamMember.GetTeamMemberIDs(userID)
	if err != nil {
		return nil, err
	}
	if len(ids) == 0 {
		return []int64{userID}, nil
	}
	return ids, nil
}
