package ai

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"

	"tidecanvas/internal/app"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/cache"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/logger"
	"tidecanvas/internal/pkg/relaychat"
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
}

func newService(d *app.Deps) *service {
	return &service{
		repo:         newRepo(d.DB),
		rdb:          d.RDB,
		registry:     newHandlerRegistry(),
		provider:     newStubProviderClient(),
		relay:        relaychat.New(d.Cfg.Relay.BaseURL, d.Cfg.Relay.APIKey),
		systemPrompt: d.Cfg.LLM.SystemPrompt,
	}
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

// ---- generate -----------------------------------------------------------

// errNoHandler / errNoModel let the HTTP layer map to specific business codes.
var (
	errNoHandler = errors.New("handler not found")
	errNoModel   = errors.New("model unavailable")
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
	if err := s.repo.createTask(ctx, task); err != nil {
		return nil, err
	}
	s.writeTaskState(ctx, task)

	// Execute in the background; the HTTP request returns the PROCESSING task.
	go s.runTask(context.Background(), task.ID, gh, m, userID, dto)

	vo := toTaskVO(task)
	return &vo, nil
}

// runTask performs the generation and persists the terminal state. It is run in
// a detached goroutine; errors are logged, not returned.
func (s *service) runTask(ctx context.Context, taskID idgen.ID, gh GenHandler, m *model.AiModel, userID idgen.ID, dto generateDTO) {
	start := time.Now()

	// Re-load the task so a cancellation that landed between create and run is
	// respected.
	task, err := s.repo.getTask(ctx, taskID)
	if err != nil || task == nil {
		logger.L().Warn("ai: runTask load failed", zap.String("taskId", taskID.String()), zap.Error(err))
		return
	}
	if task.Status == statusCancelled {
		return
	}

	s.setProgress(ctx, taskID, 30)

	input := decodeInput(dto.Input)
	req := GenerateRequest{
		Handler:  dto.Handler,
		Model:    m,
		Provider: nil, // resolved by a real provider client; stub ignores it
		Input:    input,
	}

	res, genErr := gh.Execute(ctx, s.provider, req)
	duration := time.Since(start).Milliseconds()

	// Persist terminal task state.
	end := time.Now()
	task.UpdateTime = end
	task.CompleteTime = end
	if genErr != nil || res.ResultURL == "" {
		task.Status = statusFailed
		task.Progress = 100
		task.ErrorMsg = errMessage(genErr)
	} else {
		task.Status = statusSuccess
		task.Progress = 100
		task.ResultUrl = res.ResultURL
		task.ResultMeta = buildResultMeta(res)
	}
	if err := s.repo.updateTask(ctx, task); err != nil {
		logger.L().Error("ai: persist task result failed", zap.String("taskId", taskID.String()), zap.Error(err))
	}
	s.writeTaskState(ctx, task)

	// Audit log row (best-effort).
	s.writeLog(ctx, task, gh, m, userID, dto, res, genErr, duration)
}

// cancelTask marks a still-processing task as cancelled.
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
		task.Status = statusCancelled
		task.UpdateTime = time.Now()
		task.CompleteTime = time.Now()
		if err := s.repo.updateTask(ctx, task); err != nil {
			return err
		}
		s.writeTaskState(ctx, task)
	}
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

// gridSplit is a server-side image grid splitter. Real pixel slicing requires
// decoding the upstream image; in this phase no upstream image processing is
// wired, so it returns an explicit error. The frontend has its own client-side
// canvas slicer (lib/image-slice.ts) as the primary path, so this endpoint is a
// best-effort fallback only.
func (s *service) gridSplit(ctx context.Context, dto gridSplitDTO) ([]string, error) {
	_ = ctx
	if dto.ImageURL == "" || dto.Rows <= 0 || dto.Cols <= 0 {
		return nil, errBadGridSplit
	}
	return nil, errGridSplitUnavailable
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
		vos = append(vos, toLogVO(&rows[i]))
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

func (s *service) writeLog(ctx context.Context, task *model.AiTask, gh GenHandler, m *model.AiModel, userID idgen.ID, dto generateDTO, res GenerateResult, genErr error, durationMs int64) {
	success := 1
	errMsg := ""
	if genErr != nil || res.ResultURL == "" {
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
