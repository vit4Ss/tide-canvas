package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"

	"tidecanvas/internal/app"
	"tidecanvas/internal/handler/points"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/cache"
	"tidecanvas/internal/pkg/eventlog"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/logger"
	"tidecanvas/internal/pkg/relaychat"
	"tidecanvas/internal/pkg/storage"
)

// Task status values (mirror frontend AiTaskStatus enum).
const (
	statusProcessing = 0
	statusSuccess    = 1
	statusFailed     = 2
	statusCancelled  = 3
)

// taskStateTTL is how long transient task state lives in Redis.
const taskStateTTL = 30 * time.Minute

// service holds AI domain business logic.
type service struct {
	repo     *repo
	rdb      *redis.Client
	registry *handlerRegistry
	provider AiProviderClient
	// relay powers prompt optimization via the relay text model; nil when no
	// relay API key is configured.
	relay        *relaychat.Client
	systemPrompt string
	// storage backs durable server-side artifacts (e.g. grid-split cells).
	storage storage.StorageStrategy
	// docHost 是启动时 storage.publicURL 的 host：画布 AI 助手转发文档附件时
	// 只允许抓取该 host 或 *.aliyuncs.com 的 URL（SSRF 防护，见 pkg/chatattach）。
	docHost string
	// sem 限制并发执行的 runTask 数(每个会打无上限时长的上游 relay 调用),避免突发
	// 请求产生无上限 goroutine + 无上限上游连接;超额任务在 goroutine 内排队等待。
	sem chan struct{}
}

// maxConcurrentGenerations 是同时执行的生成任务上限(排队而非拒绝)。
const maxConcurrentGenerations = 32

func newService(d *app.Deps) *service {
	s := &service{
		repo:         newRepo(d.DB),
		rdb:          d.RDB,
		registry:     newHandlerRegistry(),
		provider:     newProviderClient(d.Cfg.Relay.BaseURL, d.Cfg.Relay.APIKey, d.Storage),
		relay:        relaychat.New(d.Cfg.Relay.BaseURL, d.Cfg.Relay.APIKey),
		systemPrompt: d.Cfg.LLM.SystemPrompt,
		storage:      d.Storage,
		sem:          make(chan struct{}, maxConcurrentGenerations),
	}
	if pu, err := url.Parse(d.Cfg.Storage.PublicURL); err == nil {
		s.docHost = pu.Host
	}
	return s
}

// ---- catalog ------------------------------------------------------------

func (s *service) listModels(ctx context.Context) ([]AiModelVO, error) {
	rows, err := s.repo.listEnabledModels(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]AiModelVO, 0, len(rows))
	for i := range rows {
		out = append(out, toModelVO(&rows[i]))
	}
	return out, nil
}

func (s *service) listHandlers(ctx context.Context) ([]AiHandlerVO, error) {
	rows, err := s.repo.listEnabledHandlers(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]AiHandlerVO, 0, len(rows))
	for i := range rows {
		out = append(out, toHandlerVO(&rows[i]))
	}
	return out, nil
}

// listSiteTools lists the 智能工具 the public site renders (独立工具页 + 首页
// 卡片): enabled AND showPage rows only, in admin-defined order.
func (s *service) listSiteTools(ctx context.Context) ([]AiToolVO, error) {
	rows, err := s.repo.listSiteTools(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]AiToolVO, 0, len(rows))
	for i := range rows {
		out = append(out, toToolVO(&rows[i]))
	}
	return out, nil
}

// ---- generate -----------------------------------------------------------

// errNoHandler / errNoModel / errInsufficientPoints let the HTTP layer map to
// specific business codes.
var (
	errNoHandler          = errors.New("handler not found")
	errNoModel            = errors.New("model unavailable")
	errInsufficientPoints = errors.New("insufficient points")
	// errToolDisabled：后台把预设工具下线（ai_tools.enabled=false）后拒绝生成。
	errToolDisabled = errors.New("tool disabled")
)

// generate creates a task in PROCESSING state, kicks off async execution, and
// returns the task VO immediately so the frontend can start polling.
func (s *service) generate(ctx context.Context, userID idgen.ID, dto generateDTO) (*AiTaskVO, error) {
	gh, ok := s.registry.get(dto.Handler)
	if !ok {
		// Also accept a DB-registered handler whose impl isn't built in: treat as
		// missing capability so the frontend shows HANDLER_NOT_FOUND cleanly.
		return nil, errNoHandler
	}

	// 预设工具的服务端配置（ai_tools 行）——只对 presetEditHandler 生效，绝不
	// 波及基础能力（下线「局部重绘」工具不能挡掉创作台的图生图）。后台下线
	// (enabled=false) 直接拒绝；在线则把后台维护的提示词/附加参数带进执行。
	// runTask 跑在 detached goroutine（context.Background()），所以配置必须在
	// 这里用请求 context 预加载。行缺失时退回内建默认值（resilience）。
	var tool *model.AiTool
	if _, isPreset := gh.(presetEditHandler); isPreset {
		row, err := s.repo.findToolByHandler(ctx, dto.Handler)
		if err != nil {
			return nil, err
		}
		if row != nil {
			if !row.Enabled {
				return nil, errToolDisabled
			}
			tool = row
		}
	}

	m, err := s.repo.findModel(ctx, dto.ModelID)
	if err != nil {
		return nil, err
	}
	if m == nil || !m.Enabled {
		return nil, errNoModel
	}

	now := time.Now()
	task := &model.AiTask{
		ID:         idgen.Next(),
		UserID:     userID,
		ProjectID:  dto.ProjectID,
		Handler:    dto.Handler,
		ModelID:    m.ID,
		ModelName:  m.Name,
		Status:     statusProcessing,
		Progress:   5,
		Input:      string(normalizeInput(dto.Input)),
		CreateTime: now,
		UpdateTime: now,
	}

	// Charge the server-computed point cost up front (guarded against concurrent
	// overspend). The deduction is the authoritative gate — a balance below cost
	// rejects the generation before any task/row exists. cost==0 models are free.
	// The cost is persisted on the task so a crash-recovery sweep can refund the
	// exact amount; runTask refunds it on any non-success outcome too.
	cost := resolveCost(m, dto.Input, s.repo.teamPriceFactor(ctx, userID))
	task.PointCost = int64(cost)
	if cost > 0 {
		if err := points.Consume(s.repo.db, userID, cost, "生成消耗："+m.Name, task.ID); err != nil {
			if errors.Is(err, points.ErrInsufficient) {
				return nil, errInsufficientPoints
			}
			return nil, err
		}
	}

	if err := s.repo.createTask(ctx, task); err != nil {
		// Charged but the task row failed to persist: refund so the user isn't
		// billed for a generation that never started.
		if cost > 0 {
			if rerr := points.Refund(s.repo.db, userID, cost, "生成创建失败退款", task.ID); rerr != nil {
				logger.L().Error("ai: refund after createTask failed",
					zap.String("taskId", task.ID.String()), zap.Error(rerr))
			}
		}
		return nil, err
	}
	s.writeTaskState(ctx, task)

	// Execute in the background; the HTTP request returns the PROCESSING task.
	go s.runTask(context.Background(), task.ID, gh, m, userID, dto, cost, tool)

	vo := toTaskVO(task)
	return &vo, nil
}

// runTask performs the generation and persists the terminal state. It is run in
// a detached goroutine; errors are logged, not returned. tool is the preset op's
// pre-loaded ai_tools config (nil for base handlers / when the row is missing).
func (s *service) runTask(ctx context.Context, taskID idgen.ID, gh GenHandler, m *model.AiModel, userID idgen.ID, dto generateDTO, cost int, tool *model.AiTool) {
	// 并发闸:超过 maxConcurrentGenerations 的任务在此排队(任务已处于 PROCESSING),
	// 限制同时打到上游 relay 的连接数。
	s.sem <- struct{}{}
	defer func() { <-s.sem }()

	// refund credits the up-front charge back on any non-success outcome
	// (failure / cancel / panic). It is single-shot: once a refund transaction
	// commits, later terminal paths are no-ops, so the user is never double-paid.
	refunded := false
	refund := func(reason string) {
		if cost <= 0 || refunded {
			return
		}
		if err := points.Refund(s.repo.db, userID, cost, reason, taskID); err != nil {
			logger.L().Error("ai: refund failed", zap.String("taskId", taskID.String()), zap.Error(err))
			return
		}
		refunded = true
	}

	// This goroutine is detached from Gin's request scope, so Gin's Recovery
	// middleware does NOT cover it — an unrecovered panic on the generation path
	// (provider client, rehost, image decode, nil map, …) would crash the whole
	// process and strand every other in-flight task. Recover, mark this task
	// failed, and keep the server alive.
	defer func() {
		if r := recover(); r != nil {
			logger.L().Error("ai: runTask panic recovered",
				zap.String("taskId", taskID.String()), zap.Any("panic", r))
			end := time.Now()
			t := &model.AiTask{
				ID: taskID, Status: statusFailed, Progress: 100,
				ErrorMsg: userFacingGenErr, UpdateTime: end, CompleteTime: &end,
			}
			if _, err := s.repo.finalizeTask(context.Background(), t, statusProcessing); err != nil {
				logger.L().Error("ai: finalize after panic failed", zap.String("taskId", taskID.String()), zap.Error(err))
			}
			s.clearTaskState(context.Background(), taskID)
			refund("生成异常退款")
		}
	}()

	start := time.Now()

	// Re-load the task so a cancellation that landed between create and run is
	// respected.
	task, err := s.repo.getTask(ctx, taskID)
	if err != nil || task == nil {
		logger.L().Warn("ai: runTask load failed", zap.String("taskId", taskID.String()), zap.Error(err))
		// Task removed (cancelled/deleted) or unreadable before it ran: refund.
		refund("生成取消退款")
		return
	}
	if task.Status == statusCancelled {
		refund("生成取消退款")
		return
	}

	s.setProgress(ctx, taskID, 30)

	// 技能:客户端只传 skillId,模板由服务端拼到用户描述前面。拼接放在这里而不是
	// 客户端,是为了让落库的 input 保持用户原文——作品标题、日志、「重新编辑」
	// 读的都是它,客户端先拼好的话它们看到的全是技能模板开头。
	input := s.applySkill(decodeInput(dto.Input), gh)
	req := GenerateRequest{
		Handler:  dto.Handler,
		Model:    m,
		Provider: nil, // resolved by a real provider client; stub ignores it
		Input:    input,
	}
	// 注入后台维护的预设工具配置（generate() 已用请求 context 预加载）。计费
	// (resolveCost) 始终基于客户端原始 input 且早已完成，这里的注入绝不影响费用。
	if tool != nil {
		req.PresetPrompt = tool.PresetPrompt
		req.PresetExtra = decodeToolExtra(tool.ExtraParams)
	}

	var res GenerateResult
	var genErr error
	if gh.Name() == assistantChatHandler {
		// 画布 AI 助手:走 relay 文本对话,回复在 Meta["text"](无 URL 结果)。
		res, genErr = s.runAssistantChat(ctx, m, dto)
	} else {
		res, genErr = gh.Execute(ctx, s.provider, req)
	}
	duration := time.Since(start).Milliseconds()

	// Persist terminal task state atomically: finalizeTask only transitions a row
	// that is still Processing, so a concurrent cancel/delete (which flags the row
	// cancelled or removes it) can never be resurrected as success. This replaces
	// the previous recheck-then-Save, which had a window where a cancel whose
	// delete failed would leave the row and let this Save overwrite it as success.
	end := time.Now()
	task.UpdateTime = end
	task.CompleteTime = &end
	if genErr != nil || (res.ResultURL == "" && !resultHasText(res)) {
		task.Status = statusFailed
		task.Progress = 100
		// 用户可见错误分两类:能自行修正的「输入类」给出具体可操作提示;其余
		// 系统/供应商故障统一「系统异常，请联系客服」。两类的原始错误都进 zap
		// 日志,admin 侧另有 ai_generation_logs 全量留档(见 writeGenLog 的 errMsg)。
		task.ErrorMsg = userFacingGenError(genErr)
		logger.L().Warn("ai: generation failed",
			zap.String("taskId", taskID.String()), zap.String("detail", errMessage(genErr)))
	} else {
		task.Status = statusSuccess
		task.Progress = 100
		task.ResultUrl = res.ResultURL
		task.ResultMeta = buildResultMeta(res)
	}
	updated, err := s.repo.finalizeTask(ctx, task, statusProcessing)
	if err != nil {
		logger.L().Error("ai: persist task result failed", zap.String("taskId", taskID.String()), zap.Error(err))
	}
	if !updated {
		// Row was cancelled/deleted mid-run (or already finalized): drop the result
		// without writing Redis/audit state for an abandoned task, and refund.
		logger.L().Info("ai: task no longer processing, dropping result", zap.String("taskId", taskID.String()))
		s.clearTaskState(ctx, taskID)
		refund("生成取消退款")
		return
	}
	s.writeTaskState(ctx, task)

	// Failed generation: give the charged points back.
	if task.Status == statusFailed {
		refund("生成失败退款")
	}

	// 生成成功 → 登记成一条未发布作品（后台「作品管理」的数据源）。放在
	// finalizeTask 之后：只有真正落库成功的产出才算作品，被取消/丢弃的不算。
	if task.Status == statusSuccess {
		s.registerWork(ctx, task, gh, m, userID, dto, res)
	}

	// Audit log row (best-effort).
	s.writeLog(ctx, task, gh, m, userID, dto, res, genErr, start, duration)
}

// cancelTask removes a task. A still-processing task is flagged cancelled first
// (so runTask's post-Execute recheck drops its result), then the row is deleted
// and its transient Redis poll entry cleared. This backs the user-facing 删除 in
// 生成记录 — a finished task would otherwise reappear on the next history reload.
func (s *service) cancelTask(ctx context.Context, userID idgen.ID, id idgen.ID) error {
	task, err := s.repo.getTask(ctx, id)
	if err != nil {
		return err
	}
	if task == nil {
		return errTaskNotFound
	}
	if task.UserID != userID {
		return errTaskForbidden
	}
	if task.Status == statusProcessing {
		// flag cancelled first: if runTask's recheck reads the row before the delete
		// commits, it still sees "cancelled" and drops the result cleanly.
		nowT := time.Now()
		task.Status = statusCancelled
		task.UpdateTime = nowT
		task.CompleteTime = &nowT
		if err := s.repo.updateTask(ctx, task); err != nil {
			return err
		}
	}
	if err := s.repo.deleteTask(ctx, id); err != nil {
		return err
	}
	s.clearTaskState(ctx, id)
	return nil
}

// getTask returns a task VO, preferring fresher Redis progress for in-flight
// tasks. Ownership is enforced.
func (s *service) getTask(ctx context.Context, userID idgen.ID, id idgen.ID) (*AiTaskVO, error) {
	task, err := s.repo.getTask(ctx, id)
	if err != nil {
		return nil, err
	}
	if task == nil {
		return nil, errTaskNotFound
	}
	if task.UserID != userID {
		return nil, errTaskForbidden
	}
	// Overlay live progress from Redis while processing.
	if task.Status == statusProcessing {
		if p, ok := s.readProgress(ctx, id); ok && p > task.Progress {
			task.Progress = p
		}
	}
	vo := toTaskVO(task)
	return &vo, nil
}

func (s *service) listTasks(ctx context.Context, userID idgen.ID, q taskQuery, offset, limit int) ([]AiTaskVO, int64, error) {
	rows, total, err := s.repo.listTasks(ctx, userID, q, offset, limit)
	if err != nil {
		return nil, 0, err
	}
	out := make([]AiTaskVO, 0, len(rows))
	for i := range rows {
		out = append(out, toTaskVO(&rows[i]))
	}
	return out, total, nil
}

// ---- grid split ---------------------------------------------------------

// gridSplit is a server-side image grid splitter: it downloads the source
// image, cuts it into rows×cols cells and persists each requested cell to
// storage, returning the durable public URLs. The frontend keeps a client-side
// canvas slicer (lib/image-slice.ts) as the primary fast path; this server path
// is used when the cells must be persisted (e.g. onto OSS) rather than kept as
// ephemeral blob URLs.
func (s *service) gridSplit(ctx context.Context, dto gridSplitDTO) ([]string, error) {
	if dto.ImageURL == "" || dto.Rows <= 0 || dto.Cols <= 0 ||
		dto.Rows > maxGridSide || dto.Cols > maxGridSide {
		return nil, errBadGridSplit
	}
	// The source URL is client-supplied, so download it through the SSRF-guarded
	// fetcher (grid_fetch.go), NOT the trusted relay-rehost path. Errors are kept
	// generic (no target URL/status) so the endpoint can't probe the network.
	data, _, err := safeFetchImage(ctx, dto.ImageURL)
	if err != nil {
		return nil, fmt.Errorf("%w: fetch source", errGridSplitUnavailable)
	}
	return s.sliceGrid(ctx, dto.ImageURL, data, dto.Rows, dto.Cols, dto.Cells)
}

// ---- logs ---------------------------------------------------------------

func (s *service) listLogs(ctx context.Context, userID idgen.ID, isAdmin bool, q logQuery, offset, limit int) ([]AiGenerationLogVO, int64, error) {
	rows, total, err := s.repo.listLogs(ctx, userID, isAdmin, q, offset, limit)
	if err != nil {
		return nil, 0, err
	}
	vos := make([]AiGenerationLogVO, 0, len(rows))
	var userIDs, projIDs, taskIDs []idgen.ID
	for i := range rows {
		vo := toLogVO(&rows[i])
		// 非管理员:抹掉上游原文再出站。放在这里而不是 toLogVO 里,是因为后台
		// 「模型调用日志」要的正是全量原文。
		if !isAdmin {
			vo.redactForUser()
		}
		vos = append(vos, vo)
		if rows[i].UserID != 0 {
			userIDs = append(userIDs, rows[i].UserID)
		}
		if rows[i].ProjectID != 0 {
			projIDs = append(projIDs, rows[i].ProjectID)
		}
		if rows[i].TaskID != 0 {
			taskIDs = append(taskIDs, rows[i].TaskID)
		}
	}
	// Enrich association display fields (best-effort).
	names, _ := s.repo.userNames(ctx, userIDs)
	pnames, _ := s.repo.projectNames(ctx, projIDs)
	statuses, _ := s.repo.taskStatuses(ctx, taskIDs)
	for i := range vos {
		if n, ok := names[vos[i].UserID]; ok {
			vos[i].UserName = n
		}
		if n, ok := pnames[vos[i].ProjectID]; ok {
			vos[i].ProjectName = n
		}
		if st, ok := statuses[vos[i].TaskID]; ok {
			v := st
			vos[i].TaskStatus = &v
		}
	}
	return vos, total, nil
}

// ---- helpers ------------------------------------------------------------

// startedAt 与 durationMs 都由调用方给：durationMs 是上游返回那一刻量的，
// startedAt 是发起前打的点。两个分开传而不是在这里现算——本函数在任务落库
// 之后才被调用，现算会把 DB 写入时间算进耗时。
func (s *service) writeLog(ctx context.Context, task *model.AiTask, gh GenHandler, m *model.AiModel, userID idgen.ID, dto generateDTO, res GenerateResult, genErr error, startedAt time.Time, durationMs int64) {
	success := 1
	errMsg := ""
	// 判失败口径必须与 runTask 落库任务状态时完全一致（见上方 finalizeTask 前的
	// 分支）：纯文本产出(assistant_chat / 文本节点)没有 ResultURL,回复在
	// Meta["text"]。少了 resultHasText 的话,这类**成功**的生成会被记成
	// success=0 + errMsg="generation failed",用户在画布历史面板里看到红叉报错。
	if genErr != nil || (res.ResultURL == "" && !resultHasText(res)) {
		success = 0
		errMsg = errMessage(genErr)
	}
	l := &model.AiGenerationLog{
		ID:             idgen.Next(),
		TaskID:         task.ID,
		UserID:         userID,
		ProjectID:      dto.ProjectID,
		HandlerName:    dto.Handler,
		OperationType:  gh.OperationType(),
		Model:          m.Name,
		Operation:      gh.OperationType(),
		RequestUrl:     res.RequestURL,
		RequestBody:    res.RequestBody,
		InputParams:    string(normalizeInput(dto.Input)),
		HttpStatus:     res.HttpStatus,
		ResponseBody:   res.ResponseBody,
		UpstreamTaskID: res.UpstreamTaskID,
		Success:        success,
		ResultUrl:      res.ResultURL,
		ErrorMsg:       errMsg,
		DurationMs:     durationMs,
		Cost:           res.Cost,
		CreateTime:     time.Now(),
	}
	if err := s.repo.createLog(ctx, l); err != nil {
		logger.L().Warn("ai: write generation log failed", zap.String("taskId", task.ID.String()), zap.Error(err))
	}

	// Mirror the upstream relay call into the unified model-call log.
	// 场景取自 handler 的 operation type：音频此前被归进 image，日志按场景
	// 筛选时音乐/音效调用会混在图片里。
	scene := workTypeOf(gh.OperationType())
	if scene == "" {
		scene = "image"
	}
	eventlog.ModelCall(&model.ModelCallLog{
		UserID:         userID,
		Scene:          scene,
		Model:          m.ModelID,
		Endpoint:       res.RequestURL,
		RequestBody:    res.RequestBody,
		ResponseBody:   res.ResponseBody,
		HttpStatus:     res.HttpStatus,
		Success:        success,
		ErrorMsg:       errMsg,
		StartTime:      startedAt,
		DurationMs:     durationMs,
		UpstreamTaskID: res.UpstreamTaskID,
		Cost:           res.Cost,
	})
}

// writeTaskState mirrors the task's progress/status into Redis for fast polling.
func (s *service) writeTaskState(ctx context.Context, task *model.AiTask) {
	if s.rdb == nil {
		return
	}
	key := cache.AiTaskKey(task.ID.String())
	payload := map[string]any{
		"status":   task.Status,
		"progress": task.Progress,
	}
	b, _ := json.Marshal(payload)
	if err := s.rdb.Set(ctx, key, b, taskStateTTL).Err(); err != nil {
		logger.L().Debug("ai: redis set task state failed", zap.Error(err))
	}
}

// clearTaskState removes a task's transient Redis poll entry (on delete/cancel),
// so no orphan progress lingers until its TTL.
func (s *service) clearTaskState(ctx context.Context, id idgen.ID) {
	if s.rdb == nil {
		return
	}
	if err := s.rdb.Del(ctx, cache.AiTaskKey(id.String())).Err(); err != nil {
		logger.L().Debug("ai: redis del task state failed", zap.Error(err))
	}
}

func (s *service) setProgress(ctx context.Context, id idgen.ID, progress int) {
	if s.rdb == nil {
		return
	}
	key := cache.AiTaskKey(id.String())
	payload := map[string]any{
		"status":   statusProcessing,
		"progress": progress,
	}
	b, _ := json.Marshal(payload)
	_ = s.rdb.Set(ctx, key, b, taskStateTTL).Err()
}

// readProgress reads the live progress from Redis, returning (0,false) when
// absent/unreadable.
func (s *service) readProgress(ctx context.Context, id idgen.ID) (int, bool) {
	if s.rdb == nil {
		return 0, false
	}
	key := cache.AiTaskKey(id.String())
	raw, err := s.rdb.Get(ctx, key).Result()
	if err != nil {
		return 0, false
	}
	var st struct {
		Progress int `json:"progress"`
	}
	if json.Unmarshal([]byte(raw), &st) != nil {
		return 0, false
	}
	return st.Progress, true
}

// normalizeInput returns input as compact JSON text, defaulting to "{}".
func normalizeInput(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 {
		return json.RawMessage("{}")
	}
	if json.Valid(raw) {
		return raw
	}
	return json.RawMessage("{}")
}

// decodeInput parses the raw input object into a map (empty on failure).
func decodeInput(raw json.RawMessage) map[string]any {
	m := map[string]any{}
	if len(raw) == 0 {
		return m
	}
	_ = json.Unmarshal(raw, &m)
	return m
}

// buildResultMeta serializes the result's meta + extra urls for resultMeta.
// resultHasText reports whether the result carries a non-empty text reply
// (画布 AI 助手用 Meta["text"] 承载文本结果,没有 URL 也算成功)。
func resultHasText(res GenerateResult) bool {
	if res.Meta == nil {
		return false
	}
	t, _ := res.Meta["text"].(string)
	return strings.TrimSpace(t) != ""
}

func buildResultMeta(res GenerateResult) string {
	meta := map[string]any{}
	for k, v := range res.Meta {
		meta[k] = v
	}
	if len(res.URLs) > 0 {
		meta["urls"] = res.URLs
	}
	if len(meta) == 0 {
		return ""
	}
	b, err := json.Marshal(meta)
	if err != nil {
		return ""
	}
	return string(b)
}

func errMessage(err error) string {
	if err == nil {
		return "generation failed"
	}
	return err.Error()
}

// userFacingGenErr 是生成失败时下发给前端的系统级统一文案。供应商/内部错误
// 原文(含上游 HTTP 细节、密钥路由等)一律不出站——详情进 zap 日志与
// ai_generation_logs / model_call_log(admin 后台可查)。
const userFacingGenErr = "系统异常，请联系客服"

// inputErrorRules 把「用户可自行修正的输入类」上游错误映射为具体、可操作的
// 中文提示。仅做特征匹配后返回**我们自己撰写的**文案,绝不回显供应商原文——
// 既满足「告诉用户缺什么」,又不泄露内部/供应商细节。命不中则按系统异常处理。
//
// 顺序即优先级:自上而下首个命中者生效,所以更具体的规则要排在更宽泛的前面
// (审核类回执常同时带 prompt/image 字样,必须先判,否则会被输入类规则截胡)。
//
// 入表门槛:只收「用户改了输入就能成功」的情形。中转站余额不足、密钥失效、
// 网关抖动、上游 5xx 一律不入表——那是我们的问题,不该让用户去改提示词。
var inputErrorRules = []struct {
	// 高置信度特征片段(小写匹配):宁可漏判落到系统异常,也不误把系统故障
	// 说成用户输入问题。命中任一片段即判定为该输入类问题。
	markers []string
	message string
}{
	// —— 安全审核 ——
	{[]string{
		"content policy", "content_policy", "sensitive content", "safety system",
		"prohibited content", "moderation", "nsfw", "flagged",
		"内容违规", "内容审核", "违规内容", "敏感词",
	}, "内容未通过安全审核，请调整后重试"},
	// 参考图版权要先于下面的通用版权规则:同样是审核,但用户该做的是「换图」而不是
	// 「改描述」,给通用文案会把人指到错误的方向上。
	{[]string{
		"参考图可能涉及版权", "参考图涉及版权", "参考图版权", "参考图涉嫌侵权",
		"image copyright", "reference image copyright", "image may infringe",
	}, "参考图可能涉及版权限制，请更换参考素材后重试"},
	// 版权/名人同属审核,但用户要改的是「别写具体艺人、角色、作品名」,给单独文案。
	{[]string{
		"copyright", "trademark", "public figure", "celebrity", "artist name",
		"版权", "侵权",
	}, "内容涉及受保护的名称或作品，请改用描述性表达后重试"},

	// —— 音乐 ——
	{[]string{"can not both null", "both null", "gpt_description_prompt"}, "请补充音乐描述或歌词后重试"},
	{[]string{"lyrics is too long", "lyrics too long", "lyrics exceeds"}, "歌词过长，请精简后重试"},
	{[]string{"lyrics is required", "lyrics required", "lyrics can not be empty"}, "请填写歌词后重试"},

	// —— 参考素材(图/音频)——
	// "at least one image" 兼容 relaymedia 自抛的 "edits require at least one image url"。
	{[]string{
		"至少一张", "at least one reference", "reference required",
		"reference image is required", "at least one image", "image_urls is required",
	}, "请先上传所需的参考素材后重试"},
	{[]string{
		"failed to download image", "download image failed", "cannot fetch image",
		"fetch image failed", "invalid image url", "unable to access image",
		"image url is not accessible",
	}, "参考素材无法读取，请重新上传后重试"},
	{[]string{
		"unsupported image format", "invalid image format", "image format not supported",
		"unsupported file type", "unsupported mime", "invalid file format",
	}, "参考素材格式不支持，请改用 JPG / PNG 后重试"},
	{[]string{
		"image too large", "image is too large", "image size exceeds",
		"file too large", "file size exceeds", "resolution too high",
	}, "参考素材体积或分辨率超限，请压缩后重试"},

	// —— 提示词 ——
	{[]string{
		"prompt is too long", "prompt too long", "exceeds maximum length",
		"maximum context length", "too many tokens", "string too long",
	}, "提示词过长，请精简后重试"},
	{[]string{
		"prompt is required", "prompt required", "prompt can not be empty",
		"prompt cannot be empty", "missing prompt", "input text is required",
		"requires input text", "请输入内容", "请先输入提示词",
	}, "请输入提示词后重试"},

	// —— 生成参数 ——
	{[]string{
		"unsupported aspect ratio", "invalid aspect ratio", "invalid aspect_ratio",
		"aspect ratio must", "unsupported size", "invalid size", "unsupported resolution",
	}, "所选画面比例或尺寸不受支持，请调整后重试"},
	{[]string{
		"unsupported duration", "invalid duration", "duration must be",
		"duration is not supported",
	}, "所选时长不受支持，请调整后重试"},

	// —— 限流 ——
	// 唯一一条非输入类:上游 429 可能是我们的共享密钥被限,所以文案不写「你请求
	// 太频繁」而写排队,既不甩锅给用户,又给出可操作动作(稍后重试)。
	{[]string{
		"rate limit", "rate_limit", "too many requests", "请求过于频繁",
	}, "当前生成排队较多，请稍后重试"},
}

// userFacingGenError 分级:命中输入类规则→具体提示;否则→系统异常统一文案。
func userFacingGenError(err error) string {
	if err == nil {
		return userFacingGenErr
	}
	low := strings.ToLower(err.Error())
	for _, rule := range inputErrorRules {
		for _, mk := range rule.markers {
			if strings.Contains(low, strings.ToLower(mk)) {
				return rule.message
			}
		}
	}
	return userFacingGenErr
}

// pagination clamps page params to sane bounds and returns (offset, limit).
func pagination(pageNum, pageSize int) (int, int) {
	if pageNum <= 0 {
		pageNum = 1
	}
	if pageSize <= 0 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}
	return (pageNum - 1) * pageSize, pageSize
}
