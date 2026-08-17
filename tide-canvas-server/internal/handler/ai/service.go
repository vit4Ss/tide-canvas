package ai

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"tidecanvas/internal/app"
	"tidecanvas/internal/handler/points"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/cache"
	"tidecanvas/internal/pkg/eventlog"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/logger"
	"tidecanvas/internal/pkg/relaychat"
	"tidecanvas/internal/pkg/relaymedia"
	"tidecanvas/internal/pkg/storage"
)

// Task status values (mirror frontend AiTaskStatus enum).
const (
	statusProcessing = 0
	statusSuccess    = 1
	statusFailed     = 2
	statusCancelled  = 3
)

// taskStateTTL is how long transient task state lives in Redis. Keep it beyond
// the longest provider deadline (video 40m) so long-running tasks retain their
// fast-poll state through finalization.
const taskStateTTL = 50 * time.Minute

const maxRenderedSkillPromptBytes = 1 << 20

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
	// confirmVideoDuration verifies ownership and reads source media metadata
	// server-side before any points are charged. Video upscale and optional
	// reference-video billing share the same verifier. It is injectable in tests.
	confirmVideoDuration videoDurationConfirmer
	// docHosts 是启动时存储策略 FetchHosts() 的本站资产 host 列表（CDN/区域/
	// 加速域名）：画布 AI 助手转发文档附件时只允许抓取这些 host 或
	// *.aliyuncs.com 的 URL（SSRF 防护，见 pkg/chatattach）。
	docHosts []string
	// sem 限制并发执行的 runTask 数(每个会打无上限时长的上游 relay 调用),避免突发
	// 请求产生无上限 goroutine + 无上限上游连接;超额任务在 goroutine 内排队等待。
	sem chan struct{}
	// taskCancels stops this process's provider request immediately. A DB
	// heartbeat/status watcher supplies the same cancellation across instances.
	taskCancels sync.Map // map[idgen.ID]context.CancelFunc
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
	if d.Storage != nil {
		s.docHosts = d.Storage.FetchHosts()
	}
	s.confirmVideoDuration = s.confirmOwnedVideoDuration
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
	errProjectUnavailable = errors.New("project unavailable")
	// errToolDisabled：后台把预设工具下线（ai_tools.enabled=false）后拒绝生成。
	errToolDisabled = errors.New("tool disabled")
)

type skillPlacementError struct{ message string }

func (e skillPlacementError) Error() string { return e.message }

// refundTaskOnce serializes refunds on the persisted task row. It makes
// cancellation, worker completion and periodic stale-task recovery safe to run
// concurrently and across multiple server instances.
func refundTaskOnce(db *gorm.DB, taskID idgen.ID, reason string) error {
	var task model.AiTask
	err := db.Unscoped().Select("id", "user_id", "status", "point_cost", "refunded").First(&task, "id = ?", taskID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		// New code deletes terminal tasks only after their refund commits. A
		// missing row is therefore either uncharged or already handled legacy data.
		return nil
	}
	if err != nil || task.Refunded || task.PointCost <= 0 {
		return err
	}
	// Never infer a refund from a caller-side/transport error. Only the
	// persisted failed/cancelled terminal state is eligible; a success row can
	// therefore not become free if a finalize response was ambiguous.
	if task.Status != statusFailed && task.Status != statusCancelled {
		return nil
	}
	// points.Refund locks the task row and flips refunded in the same balance+
	// ledger transaction. Its Unscoped lookup also covers legacy soft deletes.
	return points.Refund(db, task.UserID, int(task.PointCost), reason, taskID)
}

// generate creates a task in PROCESSING state, kicks off async execution, and
// returns the task VO immediately so the frontend can start polling.
func (s *service) generate(ctx context.Context, userID idgen.ID, dto generateDTO) (*AiTaskVO, error) {
	// HTTP/direct calls may only associate tasks and derived works with a canvas
	// owned by the caller. SkillRun creation already validates its project and
	// carries a non-zero step ID, so avoid repeating this query for every step.
	if err := validateDirectProjectOwnership(ctx, userID, dto, s.repo.projectOwnedBy); err != nil {
		return nil, err
	}
	clientRequestID := strings.TrimSpace(dto.ClientRequestID)
	requestHash := ""
	if clientRequestID != "" {
		if len(clientRequestID) > 96 {
			return nil, skillPlacementError{message: "clientRequestId is too long"}
		}
		var err error
		requestHash, err = directGenerationFingerprint(dto)
		if err != nil {
			return nil, skillPlacementError{message: "generation request is invalid"}
		}
		if existing, found, err := s.replayDirectTask(ctx, userID, clientRequestID, requestHash); err != nil || found {
			return existing, err
		}
	}
	gh, ok := s.registry.get(dto.Handler)
	if !ok {
		// Also accept a DB-registered handler whose impl isn't built in: treat as
		// missing capability so the frontend shows HANDLER_NOT_FOUND cleanly.
		return nil, errNoHandler
	}
	directSkillID, err := s.validateDirectSkillPlacement(ctx, &dto, gh)
	if err != nil {
		return nil, err
	}

	// 智能工具策略只由精确的 handler + input.toolKey 标记触发。相同 handler 也会
	// 被创作台结果工具栏复用，因此上下线不能再按 handler 粗暴拦截。独立工具请求
	// 同时检查 enabled/show_page；数据库行缺失时以内建 canonical 配置兜底。
	// 未打标的 preset handler 仍读取后台提示词，但不受独立工具页开关影响。
	// runTask 跑在 detached goroutine，配置须在这里用请求 context 预加载。
	var tool *model.AiTool
	requestedTool, hasToolMarker := canonicalToolRequest(dto.Handler, dto.Input)
	if hasToolMarker && requestedTool == nil {
		return nil, skillPlacementError{message: "智能工具标识无效"}
	}
	if requestedTool != nil {
		row, err := s.repo.findToolByKey(ctx, requestedTool.Key)
		if err != nil {
			return nil, err
		}
		if row != nil {
			if !row.Enabled || !row.ShowPage {
				return nil, errToolDisabled
			}
			tool = row
		} else {
			tool = requestedTool
		}
	} else if _, preset := gh.(presetEditHandler); preset {
		row, err := s.repo.findToolByHandler(ctx, dto.Handler)
		if err != nil {
			return nil, err
		}
		if row != nil {
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
	if !modelSupportsHandler(m, dto.Handler) {
		return nil, skillPlacementError{message: "所选模型不支持当前生成方式，请切换模型或生成模式"}
	}
	if err := validateOmniReferenceInput(&dto, m); err != nil {
		return nil, err
	}
	if err := s.prepareUpscalePricingInput(ctx, userID, &dto, m); err != nil {
		return nil, err
	}
	if configured, valid := prepareVideoPerRequestPricingInput(&dto, m); configured && !valid {
		return nil, skillPlacementError{message: "所选清晰度尚未配置按次积分，请更换模型或输出规格"}
	}
	referenceVideoCost, err := s.prepareReferenceVideoPricingInput(ctx, userID, &dto, m)
	if err != nil {
		return nil, err
	}
	if requested, configured, allowed := modelVideoDurationAllowed(m, dto.Handler, dto.Input); configured && !allowed {
		return nil, skillPlacementError{message: fmt.Sprintf("所选模型不支持 %g 秒视频，请选择模型支持的时长", requested)}
	}

	now := time.Now()
	concurrentLimit := generationConcurrentLimit(s.repo.db.WithContext(ctx))
	origin := strings.TrimSpace(dto.Origin)
	if origin == "" {
		origin = "direct"
	}
	outputRole := strings.TrimSpace(dto.OutputRole)
	if outputRole == "" {
		outputRole = "final"
	}
	registerWork := true
	if dto.RegisterWork != nil {
		registerWork = *dto.RegisterWork
	}
	task := &model.AiTask{
		ID:             idgen.Next(),
		UserID:         userID,
		ProjectID:      dto.ProjectID,
		Handler:        dto.Handler,
		TargetType:     strings.ToLower(strings.TrimSpace(dto.TargetType)),
		ModelID:        m.ID,
		ModelName:      m.Name,
		Status:         statusProcessing,
		Progress:       5,
		Origin:         origin,
		SkillRunID:     dto.SkillRunID,
		SkillRunStepID: dto.SkillRunStepID,
		OutputRole:     outputRole,
		RegisterWork:   registerWork,
		Input:          string(normalizeInput(dto.Input)),
		CreateTime:     now,
		UpdateTime:     now,
	}
	if clientRequestID != "" {
		task.ClientRequestID = &clientRequestID
		task.ClientRequestHash = requestHash
	}

	// Charge the server-computed point cost up front (guarded against concurrent
	// overspend). The deduction is the authoritative gate — a balance below cost
	// rejects the generation before any task/row exists. cost==0 models are free.
	// The cost is persisted on the task so a crash-recovery sweep can refund the
	// exact amount; runTask refunds it on any non-success outcome too.
	cost, err := combineGenerationPointCost(resolveCost(m, dto.Input), referenceVideoCost)
	if err != nil {
		return nil, err
	}
	task.PointCost = int64(cost)
	if dto.SkillRunStepID != 0 {
		key := "skill-run-step:" + dto.SkillRunStepID.String()
		task.OrchestrationKey = &key
		created, err := s.createSkillRunTask(ctx, userID, dto, task, cost, m.Name, concurrentLimit)
		if err != nil {
			if errors.Is(err, points.ErrInsufficient) {
				return nil, errInsufficientPoints
			}
			if clientRequestID != "" {
				if existing, found, lookupErr := s.replayDirectTask(ctx, userID, clientRequestID, requestHash); lookupErr != nil || found {
					return existing, lookupErr
				}
			}
			return nil, err
		}
		if !created {
			vo := toTaskVO(task)
			return &vo, nil
		}
	} else {
		// The task row is the durable refund receipt. Charge and create it in one
		// transaction so a create failure cannot leave a deducted balance with no
		// row for the recovery reconciler to find.
		err := s.repo.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			if err := reserveGenerationSlot(tx, userID, concurrentLimit, now); err != nil {
				return err
			}
			if cost > 0 {
				if err := points.Consume(tx, userID, cost, "生成消耗："+m.Name, task.ID); err != nil {
					return err
				}
			}
			return tx.Create(task).Error
		})
		if err != nil {
			if errors.Is(err, points.ErrInsufficient) {
				return nil, errInsufficientPoints
			}
			// A concurrent retry can lose the unique-key race after the winning
			// transaction commits. Return that durable task instead of surfacing a
			// spurious 500 (this attempt's debit rolled back with the transaction).
			if clientRequestID != "" {
				if existing, found, lookupErr := s.replayDirectTask(ctx, userID, clientRequestID, requestHash); lookupErr != nil || found {
					return existing, lookupErr
				}
			}
			return nil, err
		}
	}
	// Usage is authoritative at the accepted server-side execution boundary.
	// SkillRun increments in its own creation transaction; internal pinned runs
	// do not carry skillId and therefore cannot double count here.
	if origin == "direct" && directSkillID != 0 {
		_ = s.repo.db.Model(&model.Skill{}).Where("id = ? AND status = 1", directSkillID).
			UpdateColumn("use_count", gorm.Expr("use_count + 1")).Error
	}
	s.writeTaskState(ctx, task)

	// Execute in the background; the HTTP request returns the PROCESSING task.
	taskCtx, cancelTask := context.WithCancel(context.Background())
	s.taskCancels.Store(task.ID, context.CancelFunc(cancelTask))
	go func() {
		defer s.taskCancels.Delete(task.ID)
		defer cancelTask()
		s.runTask(taskCtx, task.ID, gh, m, userID, dto, cost, tool)
	}()

	vo := toTaskVO(task)
	return &vo, nil
}

type projectOwnershipLookup func(context.Context, idgen.ID, idgen.ID) (bool, error)

func validateDirectProjectOwnership(
	ctx context.Context,
	userID idgen.ID,
	dto generateDTO,
	lookup projectOwnershipLookup,
) error {
	if dto.ProjectID == 0 || dto.SkillRunStepID != 0 {
		return nil
	}
	owned, err := lookup(ctx, dto.ProjectID, userID)
	if err != nil {
		return err
	}
	if !owned {
		return errProjectUnavailable
	}
	return nil
}

func directGenerationFingerprint(dto generateDTO) (string, error) {
	var input any = map[string]any{}
	if len(dto.Input) > 0 && strings.TrimSpace(string(dto.Input)) != "" {
		if err := json.Unmarshal(dto.Input, &input); err != nil {
			return "", err
		}
	}
	// The browser's duration is only a display estimate for video upscale. It
	// cannot make two otherwise identical, server-priced requests distinct.
	if strings.EqualFold(strings.TrimSpace(dto.Handler), "video_upscale") {
		if obj, ok := input.(map[string]any); ok {
			delete(obj, "duration")
		}
	}
	payload := struct {
		Handler    string   `json:"handler"`
		ModelID    string   `json:"modelId"`
		ProjectID  idgen.ID `json:"projectId"`
		Input      any      `json:"input"`
		EntryPoint string   `json:"entryPoint"`
		TargetType string   `json:"targetType"`
	}{
		Handler: strings.TrimSpace(dto.Handler), ModelID: strings.TrimSpace(dto.ModelID), ProjectID: dto.ProjectID,
		Input: input, EntryPoint: strings.ToLower(strings.TrimSpace(dto.EntryPoint)), TargetType: strings.ToLower(strings.TrimSpace(dto.TargetType)),
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(encoded)
	return fmt.Sprintf("%x", sum[:]), nil
}

func (s *service) replayDirectTask(ctx context.Context, userID idgen.ID, clientRequestID, requestHash string) (*AiTaskVO, bool, error) {
	var existing model.AiTask
	err := s.repo.db.WithContext(ctx).Unscoped().Where("user_id = ? AND client_request_id = ?", userID, clientRequestID).First(&existing).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	if existing.ClientRequestHash != requestHash {
		return nil, true, skillPlacementError{message: "clientRequestId was already used for a different request"}
	}
	vo := toTaskVO(&existing)
	return &vo, true, nil
}

// createSkillRunTask atomically fences the owning run, creates and charges one
// child task, and attaches it to the step attempt. If recovery submits the same
// attempt again, it returns the already attached task without another charge or
// provider invocation.
func (s *service) createSkillRunTask(ctx context.Context, userID idgen.ID, dto generateDTO, task *model.AiTask, cost int, modelName string, concurrentLimit int) (bool, error) {
	created := false
	err := s.repo.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Keep the global lock order run -> step, matching action/cancel paths.
		var run model.SkillRun
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Select("id", "user_id", "status", "revision", "worker_id").First(&run, "id = ?", dto.SkillRunID).Error; err != nil {
			return err
		}
		if run.UserID != userID || run.Status != model.SkillRunRunning ||
			run.Revision != dto.SkillRunRevision || run.WorkerID != dto.SkillRunWorkerID || strings.TrimSpace(dto.SkillRunWorkerID) == "" {
			return errors.New("skill run is no longer active")
		}
		var step model.SkillRunStep
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Select("id", "run_id", "status", "ai_task_id").
			First(&step, "id = ? AND run_id = ?", dto.SkillRunStepID, dto.SkillRunID).Error; err != nil {
			return err
		}
		if step.Status != model.SkillStepRunning {
			return errors.New("skill run step is no longer active")
		}

		var existing model.AiTask
		lookup := tx.Where("orchestration_key = ? OR skill_run_step_id = ?", *task.OrchestrationKey, dto.SkillRunStepID).
			Order("create_time ASC").First(&existing)
		if lookup.Error == nil {
			if existing.UserID != userID || existing.SkillRunID != dto.SkillRunID {
				return errors.New("skill run task correlation is invalid")
			}
			if step.AiTaskID != 0 && step.AiTaskID != existing.ID {
				return errors.New("skill run step is attached to another task")
			}
			if step.AiTaskID == 0 {
				result := tx.Model(&model.SkillRunStep{}).Where("id = ? AND ai_task_id = 0", step.ID).Update("ai_task_id", existing.ID)
				if result.Error != nil {
					return result.Error
				}
				if result.RowsAffected != 1 {
					return errors.New("skill run step changed while attaching task")
				}
			}
			if existing.OrchestrationKey == nil {
				if err := tx.Model(&model.AiTask{}).Where("id = ? AND orchestration_key IS NULL", existing.ID).
					Update("orchestration_key", *task.OrchestrationKey).Error; err != nil {
					return err
				}
				existing.OrchestrationKey = task.OrchestrationKey
			}
			*task = existing
			return nil
		}
		if !errors.Is(lookup.Error, gorm.ErrRecordNotFound) {
			return lookup.Error
		}
		if step.AiTaskID != 0 {
			return errors.New("skill run step task is unavailable")
		}
		if err := reserveGenerationSlot(tx, userID, concurrentLimit, task.CreateTime); err != nil {
			return err
		}

		// Task creation precedes the debit inside the same transaction. If either
		// write fails, both task and points ledger roll back together.
		if err := tx.Create(task).Error; err != nil {
			return err
		}
		if cost > 0 {
			if err := points.Consume(tx, userID, cost, "generation: "+modelName, task.ID); err != nil {
				return err
			}
		}
		result := tx.Model(&model.SkillRunStep{}).
			Where("id = ? AND run_id = ? AND status = ? AND ai_task_id = 0", step.ID, dto.SkillRunID, model.SkillStepRunning).
			Update("ai_task_id", task.ID)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errors.New("skill run step changed while attaching task")
		}
		created = true
		return nil
	})
	return created, err
}

// runTask performs the generation and persists the terminal state. It is run in
// a detached goroutine; errors are logged, not returned. tool is the preset op's
// pre-loaded ai_tools config (nil for base handlers / when the row is missing).
func (s *service) runTask(ctx context.Context, taskID idgen.ID, gh GenHandler, m *model.AiModel, userID idgen.ID, dto generateDTO, cost int, tool *model.AiTool) {
	// refund credits the up-front charge back on any non-success outcome
	// (failure / cancel / panic). It is single-shot: once a refund transaction
	// commits, later terminal paths are no-ops, so the user is never double-paid.
	refunded := false
	refund := func(reason string) {
		if cost <= 0 || refunded {
			return
		}
		if err := refundTaskOnce(s.repo.db, taskID, reason); err != nil {
			logger.L().Error("ai: refund failed", zap.String("taskId", taskID.String()), zap.Error(err))
			return
		}
		refunded = true
	}

	// Heartbeats cover both the semaphore queue and a long provider request.
	// The CAS also stops a worker whose task was cancelled/deleted by another
	// process. Local cancellation calls the same context immediately.
	if !s.heartbeatProcessingTask(ctx, taskID) {
		refund("generation cancelled refund")
		return
	}
	watchCtx, cancelWatch := context.WithCancel(context.Background())
	watchDone := make(chan struct{})
	go func() {
		defer close(watchDone)
		s.watchProcessingTask(watchCtx, taskID)
	}()
	var stopWatchOnce sync.Once
	stopWatch := func() {
		stopWatchOnce.Do(func() {
			cancelWatch()
			<-watchDone
		})
	}
	defer stopWatch()

	// Waiting for a generation slot must itself be cancellable; otherwise a
	// refunded/deleted queued task could later reach the provider.
	select {
	case s.sem <- struct{}{}:
		defer func() { <-s.sem }()
	case <-ctx.Done():
		refund("generation cancelled refund")
		return
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
	if !taskCanExecute(task) {
		refund("生成取消退款")
		return
	}

	// progress=30 is the durable provider-dispatch boundary. Cancellation before
	// this CAS is refundable; after it, the remote job may be irreversible and
	// the charge is retained to prevent cancel/refund abuse.
	started := s.repo.db.WithContext(ctx).Model(&model.AiTask{}).
		Where("id = ? AND status = ?", taskID, statusProcessing).
		Updates(map[string]any{"progress": 30, "update_time": time.Now(), "heartbeat_seq": gorm.Expr("heartbeat_seq + 1")})
	if started.Error != nil || started.RowsAffected != 1 {
		refund("generation cancelled refund")
		return
	}
	task.Progress = 30
	s.setProgress(ctx, taskID, 30)

	// 技能:客户端只传 skillId,模板由服务端拼到用户描述前面。拼接放在这里而不是
	// 客户端,是为了让落库的 input 保持用户原文——作品标题、日志、「重新编辑」
	// 读的都是它,客户端先拼好的话它们看到的全是技能模板开头。
	input := decodeInput(dto.Input)
	clipReshoot, clipReshootErr := s.prepareClipReshootProviderInput(ctx, userID, input)
	if clipReshootErr == nil && strings.TrimSpace(dto.PinnedSkillPrompt) != "" {
		delete(input, "skillId")
		input = applyPromptTemplate(input, strings.TrimSpace(dto.PinnedSkillPrompt))
	} else if clipReshootErr == nil {
		input = s.applySkill(input, gh)
	}
	promptErr := validateGenerationPromptSize(input)
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
	if clipReshootErr != nil {
		genErr = clipReshootErr
	} else if promptErr != nil {
		genErr = promptErr
	} else if gh.Name() == assistantChatHandler {
		// 画布 AI 助手:走 relay 文本对话,回复在 Meta["text"](无 URL 结果)。
		// 积分由 generate() 按模型定价预扣,随任务 PointCost 传入日志。
		res, genErr = s.runAssistantChat(ctx, task.UserID, m, input, task.PointCost)
	} else if gh.Name() == skillTextCompletionHandler {
		res, genErr = s.runSkillTextCompletion(ctx, task.UserID, m, input, task.PointCost)
	} else {
		res, genErr = gh.Execute(ctx, s.provider, req)
	}
	if genErr == nil && clipReshoot != nil && (res.ResultURL != "" || len(res.URLs) > 0) {
		res, genErr = s.composeClipReshootResult(ctx, userID, res, *clipReshoot)
	}
	// Stop and join the status watcher before finalizing. Otherwise its next
	// tick can observe our own terminal transition, cancel the shared provider
	// context, and make post-processing (work registration/audit) fail.
	stopWatch()
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
	if task.Status == statusSuccess && task.RegisterWork {
		s.registerWork(ctx, task, gh, m, userID, dto, res)
	}

	// Audit log row (best-effort).
	s.writeLog(ctx, task, gh, m, userID, dto, res, genErr, start, duration)
}

const taskHeartbeatInterval = 5 * time.Second

func taskCanExecute(task *model.AiTask) bool {
	return task != nil && task.Status == statusProcessing
}

func (s *service) heartbeatProcessingTask(ctx context.Context, taskID idgen.ID) bool {
	if ctx.Err() != nil {
		return false
	}
	result := s.repo.db.WithContext(ctx).Model(&model.AiTask{}).
		Where("id = ? AND status = ?", taskID, statusProcessing).
		Updates(map[string]any{"update_time": time.Now(), "heartbeat_seq": gorm.Expr("heartbeat_seq + 1")})
	if result.Error != nil {
		logger.L().Warn("ai: task heartbeat failed", zap.String("taskId", taskID.String()), zap.Error(result.Error))
		// A transient DB failure should not cancel a paid provider operation. The
		// stale sweeper uses a 50-minute cutoff, leaving ample time to recover.
		return true
	}
	return result.RowsAffected == 1
}

func (s *service) watchProcessingTask(ctx context.Context, taskID idgen.ID) {
	ticker := time.NewTicker(taskHeartbeatInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if !s.heartbeatProcessingTask(ctx, taskID) {
				if cancel, ok := s.taskCancels.Load(taskID); ok {
					cancel.(context.CancelFunc)()
				}
				return
			}
		}
	}
}

func (s *service) validateDirectSkillPlacement(ctx context.Context, dto *generateDTO, gh GenHandler) (idgen.ID, error) {
	if dto == nil || (strings.TrimSpace(dto.Origin) != "" && strings.TrimSpace(dto.Origin) != "direct") {
		return 0, nil
	}
	input := decodeInput(dto.Input)
	raw := strings.TrimSpace(strField(input, "skillId"))
	if raw == "" {
		return 0, nil
	}
	skillID, err := idgen.Parse(raw)
	if err != nil || skillID == 0 {
		return 0, skillPlacementError{message: "skillId is invalid"}
	}
	entryPoint := strings.ToLower(strings.TrimSpace(dto.EntryPoint))
	if entryPoint == "" {
		entryPoint = "studio"
	}
	validSurface := map[string]bool{"chat": true, "studio": true, "canvas": true}
	if !validSurface[entryPoint] {
		return 0, skillPlacementError{message: "entryPoint is invalid"}
	}
	targetType := strings.ToLower(strings.TrimSpace(dto.TargetType))
	if targetType == "" {
		targetType = "*"
	}
	if len(targetType) > 32 || strings.ContainsAny(targetType, " /\\\x00") {
		return 0, skillPlacementError{message: "targetType is invalid"}
	}
	var skill model.Skill
	if err := s.repo.db.WithContext(ctx).Where("id = ? AND status = 1", skillID).First(&skill).Error; err != nil {
		return 0, skillPlacementError{message: "skill is unavailable"}
	}
	if skill.CurrentVersionID == 0 {
		return 0, skillPlacementError{message: "skill has no published version"}
	}
	var version model.SkillVersion
	if err := s.repo.db.WithContext(ctx).Where("id = ? AND skill_id = ? AND status = ?", skill.CurrentVersionID, skill.ID, model.SkillVersionPublished).
		First(&version).Error; err != nil || version.Kind != model.SkillKindPreset {
		return 0, skillPlacementError{message: "only a published preset skill can be used by this endpoint"}
	}
	if !containsString(model.JSONStrings(version.EntryPoints, nil), entryPoint) {
		return 0, skillPlacementError{message: "skill is not available on this entry point"}
	}
	modality := skillOutputTypeOf(gh)
	if modality == "" || !presetSupportsOutput(&version, modality) {
		return 0, skillPlacementError{message: "skill output type does not match the generation handler"}
	}
	matched := false
	bindingDefaults := "{}"
	if strings.TrimSpace(version.BindingsJSON) != "" {
		var bindings []skillPlacementBinding
		if err := json.Unmarshal([]byte(version.BindingsJSON), &bindings); err != nil {
			return 0, skillPlacementError{message: "skill placement configuration is invalid"}
		}
		if binding := resolveSkillPlacement(bindings, entryPoint, targetType); binding != nil {
			matched = true
			if len(binding.Defaults) > 0 {
				bindingDefaults = string(binding.Defaults)
			}
		}
	} else {
		// Compatibility for a pre-migration version; startup backfill normally
		// fills BindingsJSON before requests are served.
		var binding model.SkillSurfaceBinding
		if err := s.repo.db.WithContext(ctx).
			Where("skill_id = ? AND surface = ? AND target_type IN ?", skill.ID, entryPoint, []string{"*", targetType}).
			Order(clause.Expr{SQL: "CASE WHEN target_type = ? THEN 0 ELSE 1 END, sort_order ASC, id ASC", Vars: []any{targetType}, WithoutParentheses: true}).First(&binding).Error; err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return 0, err
		} else if err == nil && binding.Enabled {
			matched = true
			bindingDefaults = binding.Defaults
		}
	}
	if !matched {
		return 0, skillPlacementError{message: "skill is not enabled for this target type"}
	}
	prompt, err := expandPublishedSkillPrompt(ctx, s.repo.db, &version)
	if err != nil {
		return 0, skillPlacementError{message: "skill prompt package is invalid"}
	}
	mergedInput, err := mergeSkillInput(version.DefaultParams, bindingDefaults, input)
	if err != nil {
		return 0, skillPlacementError{message: "skill default parameters are invalid"}
	}
	if _, hasPrompt := mergedInput["prompt"]; hasPrompt {
		renderedBytes := len(prompt)
		if userPrompt := strings.TrimSpace(strField(mergedInput, "prompt")); userPrompt != "" {
			renderedBytes += 2 + len(userPrompt)
		}
		if renderedBytes > maxRenderedSkillPromptBytes {
			return 0, skillPlacementError{message: "rendered skill prompt exceeds 1 MiB"}
		}
	}
	configuredModel := ""
	for _, candidate := range []string{
		version.ModelID,
		strField(input, "modelId"),
		dto.ModelID,
		strField(mergedInput, "modelId"),
	} {
		compatible, resolveErr := compatiblePresetModel(ctx, s.repo.db, candidate, modality)
		if resolveErr != nil {
			return 0, resolveErr
		}
		if compatible != "" {
			configuredModel = compatible
			break
		}
	}
	if configuredModel == "" {
		return 0, skillPlacementError{message: "no compatible model is available for this skill output"}
	}
	dto.ModelID = configuredModel
	mergedInput["modelId"] = configuredModel
	encodedInput, err := json.Marshal(mergedInput)
	if err != nil {
		return 0, skillPlacementError{message: "skill input is invalid"}
	}
	dto.Input = encodedInput
	dto.EntryPoint = entryPoint
	dto.TargetType = targetType
	dto.PinnedSkillPrompt = prompt
	return skill.ID, nil
}

func containsString(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

func validateGenerationPromptSize(input map[string]any) error {
	for _, key := range []string{"prompt", "systemPrompt"} {
		if value, ok := input[key].(string); ok && len(value) > maxRenderedSkillPromptBytes {
			return fmt.Errorf("rendered %s exceeds 1 MiB", key)
		}
	}
	return nil
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
		// Two CAS branches fence the provider-dispatch race. Queued work is
		// refundable. Once progress reaches 30, the remote job may already be
		// irreversible, so refunded=true records the charge as settled without
		// crediting it back (prevents cancel/refund abuse).
		nowT := time.Now()
		result := s.repo.db.WithContext(ctx).Model(&model.AiTask{}).
			Where("id = ? AND user_id = ? AND status = ? AND progress < ?", task.ID, userID, statusProcessing, 30).
			Updates(map[string]any{"status": statusCancelled, "progress": 100, "update_time": nowT, "complete_time": nowT})
		if result.Error != nil {
			return result.Error
		}
		nonRefundable := false
		if result.RowsAffected != 1 {
			result = s.repo.db.WithContext(ctx).Model(&model.AiTask{}).
				Where("id = ? AND user_id = ? AND status = ? AND progress >= ?", task.ID, userID, statusProcessing, 30).
				Updates(map[string]any{"status": statusCancelled, "progress": 100, "refunded": true, "update_time": nowT, "complete_time": nowT})
			if result.Error != nil {
				return result.Error
			}
			nonRefundable = result.RowsAffected == 1
		}
		if result.RowsAffected == 1 {
			task.Status = statusCancelled
			task.Progress = 100
			task.Refunded = nonRefundable
			task.UpdateTime = nowT
			task.CompleteTime = &nowT
		} else {
			// A terminal worker transition won the race; reload its authoritative
			// status before deciding whether any refund is due.
			task, err = s.repo.getTask(ctx, id)
			if err != nil {
				return err
			}
			if task == nil {
				return nil
			}
		}
	}
	if task.Status == statusCancelled {
		if cancel, ok := s.taskCancels.Load(id); ok {
			cancel.(context.CancelFunc)()
		}
	}
	if (task.Status == statusFailed || task.Status == statusCancelled) && task.PointCost > 0 && !task.Refunded {
		if err := refundTaskOnce(s.repo.db, task.ID, "generation terminal task refund"); err != nil {
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
	taskStates, _ := s.repo.taskLogStates(ctx, taskIDs)
	for i := range vos {
		if n, ok := names[vos[i].UserID]; ok {
			vos[i].UserName = n
		}
		if n, ok := pnames[vos[i].ProjectID]; ok {
			vos[i].ProjectName = n
		}
		if state, ok := taskStates[vos[i].TaskID]; ok {
			applyTaskLogState(&vos[i], state, isAdmin)
		}
	}
	return vos, total, nil
}

func applyTaskLogState(vo *AiGenerationLogVO, state taskLogState, isAdmin bool) {
	v := state.Status
	vo.TaskStatus = &v
	pointCost := state.PointCost
	vo.PointCost = &pointCost
	// Prefer the task-side reason for non-admin history, but pass it through the
	// public allowlist: tasks created before error redaction (and lifecycle
	// reconciliation rows) may still contain provider or internal text.
	if !isAdmin && state.ErrorMsg != "" {
		vo.ErrorMsg = publicGenerationFailureReason(state.ErrorMsg)
	}
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
	// Relay-backed text handlers log at the actual call site with their complete
	// request/response bodies and point cost. Mirroring them here would create a
	// second row for one paid call and inflate the model point leaderboard.
	if handlerLogsModelCallDirectly(gh.Name()) {
		return
	}
	// 不登记作品的模态(workTypeOf 返回空,如 3d/upscale/text)按自身 operation
	// 记场景——逐个特判的名单谁漏加谁就被错归进 image,音频当年就栽过这坑。
	scene := workTypeOf(gh.OperationType())
	if scene == "" {
		scene = gh.OperationType()
	}
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
		PointCost:      task.PointCost,
	})
}

func handlerLogsModelCallDirectly(handler string) bool {
	return handler == assistantChatHandler || handler == skillTextCompletionHandler
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
const (
	userFacingGenErr           = "系统异常，请联系客服"
	userFacingSafetyErr        = "内容未通过安全审核，请调整后重试"
	userFacingReferenceRiskErr = "参考图未通过安全审核，请更换参考图后重试"
	userFacingCopyrightErr     = "提交的音频或创作内容涉及版权限制，请更换音频素材，或调整歌词与描述后重试"
	userFacingCancelledErr     = "任务已取消，未生成结果"
)

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
		"prohibited content", "moderation", "nsfw", "flagged", "image_safety",
		"内容违规", "内容审核", "违规内容", "敏感词",
	}, userFacingSafetyErr},
	{[]string{
		"inputimagerisk", "input image risk",
	}, userFacingReferenceRiskErr},
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
		"unsupported aspect ratio", "invalid aspect ratio", "invalid aspect_ratio", "invalid aspect '",
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
	// Relay 数字业务码优先于旧的 msg 关键词分类。5001 + InputImageRisk
	// （参考图风控）、5002（安全审核）与 5009（版权限制）使用稳定的
	// 产品中文文案；5003（输入不合法）展示
	// Relay 给出的具体原因；其余业务码保持旧逻辑，继续按 msg 规则映射
	// 或落到系统异常兜底。
	var relayErr *relaymedia.UpstreamError
	if errors.As(err, &relayErr) {
		switch relayErr.Code {
		case "5001":
			low := strings.ToLower(relayErr.Message)
			if strings.Contains(low, "inputimagerisk") || strings.Contains(low, "input image risk") {
				return userFacingReferenceRiskErr
			}
		case "5002":
			return userFacingSafetyErr
		case "5009":
			return userFacingCopyrightErr
		case "5003":
			if message := strings.TrimSpace(relayErr.Message); message != "" {
				return relayDirectUserMessage(message)
			}
		}
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

// relayDirectUserMessage unwraps providers that serialize their own error
// envelope inside Relay's outer error.message, for example:
//
//	APIYI: 400 BAD_REQUEST {"error":{"message":"..."}}
//
// For Relay's direct-display invalid-input code (5003), the useful copy is the
// inner error.message. If no valid nested envelope is present, preserve the
// product contract by falling back to Relay's outer message.
func relayDirectUserMessage(message string) string {
	message = strings.TrimSpace(message)
	for offset, candidates := 0, 0; offset < len(message) && candidates < 16; candidates++ {
		relative := strings.IndexByte(message[offset:], '{')
		if relative < 0 {
			break
		}
		start := offset + relative
		var envelope struct {
			Error *struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		if err := json.NewDecoder(strings.NewReader(message[start:])).Decode(&envelope); err == nil && envelope.Error != nil {
			if inner := strings.TrimSpace(envelope.Error.Message); inner != "" {
				return truncateUserFacingMessage(inner)
			}
		}
		offset = start + 1
	}
	return truncateUserFacingMessage(message)
}

// ai_tasks.error_msg is varchar(1024). Relay owns the direct 5002/5003 copy, so
// cap it defensively without splitting a UTF-8 rune; otherwise an unexpectedly
// large upstream message can make the terminal task update fail and leave the
// frontend polling forever.
func truncateUserFacingMessage(message string) string {
	const maxRunes = 1024
	runes := []rune(message)
	if len(runes) <= maxRunes {
		return message
	}
	return string(runes[:maxRunes-1]) + "…"
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
