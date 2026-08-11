package ai

import (
	"context"
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

// repo is the AI domain's data-access layer over *gorm.DB.
type repo struct {
	db *gorm.DB
}

func newRepo(db *gorm.DB) *repo { return &repo{db: db} }

func projectOwnershipScope(db *gorm.DB, projectID, userID idgen.ID) *gorm.DB {
	return db.Model(&model.Project{}).Where("id = ? AND owner_id = ?", projectID, userID)
}

func (r *repo) projectOwnedBy(ctx context.Context, projectID, userID idgen.ID) (bool, error) {
	var count int64
	err := projectOwnershipScope(r.db.WithContext(ctx), projectID, userID).Count(&count).Error
	return count > 0, err
}

// textModel returns the market model used for prompt optimization: the listed
// text model flagged as the AI-optimization primary if any, else any listed text
// model. nil when none is configured. The full row (not just model_key) is
// returned so the caller can charge the model's configured point price.
func (r *repo) textModel() *model.MarketModel {
	const base = "type = ? AND status = 1 AND model_key <> ''"
	var m model.MarketModel
	if err := r.db.Where(base, "text").
		Where("config LIKE ?", `%"aiOptimizePrimary":true%`).
		Order("update_time DESC").First(&m).Error; err == nil && m.ModelKey != "" {
		return &m
	}
	if err := r.db.Where(base, "text").Order("update_time DESC").First(&m).Error; err == nil {
		return &m
	}
	return nil
}

// ---- AiTask -------------------------------------------------------------

func (r *repo) createTask(ctx context.Context, t *model.AiTask) error {
	return r.db.WithContext(ctx).Create(t).Error
}

func (r *repo) updateTask(ctx context.Context, t *model.AiTask) error {
	return r.db.WithContext(ctx).Save(t).Error
}

// finalizeTask writes terminal state (status/progress/result/error/timestamps)
// only if the row is still in `fromStatus` (Processing). This makes the terminal
// transition atomic so a concurrent cancel/delete can never be overwritten by a
// blind full-row Save. Returns whether a row was actually updated.
func (r *repo) finalizeTask(ctx context.Context, t *model.AiTask, fromStatus int) (bool, error) {
	res := r.db.WithContext(ctx).Model(&model.AiTask{}).
		Where("id = ? AND status = ?", t.ID, fromStatus).
		Updates(map[string]any{
			"status":        t.Status,
			"progress":      t.Progress,
			"result_url":    t.ResultUrl,
			"result_meta":   t.ResultMeta,
			"error_msg":     t.ErrorMsg,
			"update_time":   t.UpdateTime,
			"complete_time": t.CompleteTime,
		})
	if res.Error != nil {
		return false, res.Error
	}
	return res.RowsAffected > 0, nil
}

// sweepStaleTasks fails tasks left in Processing past the cutoff — orphaned when
// the process crashed/restarted mid-generation (their detached goroutine died,
// so nothing will ever write their terminal state and the frontend would poll
// forever). Returns the number of rows reconciled.
func (r *repo) sweepStaleTasks(ctx context.Context, fromStatus, toStatus int, before time.Time, errMsg string) (int64, error) {
	terminalAt := time.Now()
	res := r.db.WithContext(ctx).Model(&model.AiTask{}).
		Where("status = ? AND update_time < ?", fromStatus, before).
		Updates(staleTaskTerminalUpdates(toStatus, errMsg, terminalAt))
	return res.RowsAffected, res.Error
}

func staleTaskTerminalUpdates(toStatus int, errMsg string, terminalAt time.Time) map[string]any {
	return map[string]any{
		"status":        toStatus,
		"progress":      100,
		"error_msg":     errMsg,
		"update_time":   terminalAt,
		"complete_time": terminalAt,
	}
}

// deleteTask removes a task row by id (used by the user-facing 删除 in 生成记录).
func (r *repo) deleteTask(ctx context.Context, id idgen.ID) error {
	return r.db.WithContext(ctx).Delete(&model.AiTask{}, "id = ?", id).Error
}

// staleProcessingTasks lists tasks still Processing past the cutoff, selecting
// only the fields the crash-recovery refund needs (id / user / charged cost).
func (r *repo) staleProcessingTasks(ctx context.Context, fromStatus int, before time.Time) ([]model.AiTask, error) {
	var rows []model.AiTask
	err := r.db.WithContext(ctx).
		Select("id", "user_id", "point_cost").
		Where("status = ? AND update_time < ?", fromStatus, before).
		Find(&rows).Error
	return rows, err
}

// getTask fetches a task by id. Returns (nil, nil) when not found.
func (r *repo) getTask(ctx context.Context, id idgen.ID) (*model.AiTask, error) {
	var t model.AiTask
	err := r.db.WithContext(ctx).First(&t, "id = ?", id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &t, nil
}

// listTasks returns a page of the user's tasks filtered by the query.
func (r *repo) listTasks(ctx context.Context, userID idgen.ID, q taskQuery, offset, limit int) ([]model.AiTask, int64, error) {
	tx := applyTaskListFilters(r.db.WithContext(ctx).Model(&model.AiTask{}), userID, q)

	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var rows []model.AiTask
	if err := tx.Order(taskListOrder(q)).Offset(offset).Limit(limit).Find(&rows).Error; err != nil {
		return nil, 0, err
	}
	return rows, total, nil
}

func applyTaskListFilters(tx *gorm.DB, userID idgen.ID, q taskQuery) *gorm.DB {
	tx = visibleTaskHistoryScope(tx.Where("user_id = ?", userID))
	if q.Handler != "" {
		tx = tx.Where("handler = ?", q.Handler)
	}
	if q.MediaType != "" {
		if strings.EqualFold(strings.TrimSpace(q.MediaType), "tool") {
			tx = toolTaskScope(tx)
		} else {
			handlers := taskMediaHandlers(q.MediaType)
			if len(handlers) == 0 {
				tx = tx.Where("1 = 0")
			} else {
				tx = tx.Where("handler IN ?", handlers)
			}
		}
	}
	if q.ExcludeTools {
		tx = excludeToolTaskScope(tx)
	}
	if q.ExcludeCaptures {
		tx = tx.Where("handler <> ?", capturedFrameHandler)
	}
	if q.AssetCategory != "" {
		switch strings.ToLower(strings.TrimSpace(q.AssetCategory)) {
		case "character", "scene":
			tx = tx.Where("target_type = ?", strings.ToLower(strings.TrimSpace(q.AssetCategory)))
		case "general":
			tx = tx.Where("COALESCE(target_type, '') NOT IN ?", []string{"character", "scene"})
		default:
			tx = tx.Where("1 = 0")
		}
	}
	if q.AssetOnly {
		tx = tx.Where("status NOT IN ?", []int{statusFailed, statusCancelled})
		if strings.EqualFold(strings.TrimSpace(q.MediaType), "tool") {
			tx = tx.Where(usableToolResultPredicate)
		}
	}
	if q.Status != nil {
		tx = tx.Where("status = ?", *q.Status)
	}
	if q.NoProject {
		tx = tx.Where("project_id = 0")
	} else if q.ProjectID != 0 {
		tx = tx.Where("project_id = ?", q.ProjectID)
	}
	tx = applyDateRange(tx, "create_time", q.StartDate, q.EndDate)
	return tx
}

// toolTaskScope includes only requests carrying an exact canonical handler +
// input.toolKey pair. Handlers are capabilities shared by /tools and Studio's
// per-result toolbar, so handler-only attribution would move Studio work into
// 工具作品 after refresh.
func toolTaskScope(tx *gorm.DB) *gorm.DB {
	predicate, args := taggedToolTaskPredicate()
	return tx.Where("("+predicate+")", args...)
}

// excludeToolTaskScope is the exact inverse surface policy used by Studio.
// Untagged legacy rows stay visible: old data must not be guessed from handler.
func excludeToolTaskScope(tx *gorm.DB) *gorm.DB {
	predicate, args := taggedToolTaskPredicate()
	return tx.Where("NOT ("+predicate+")", args...)
}

// taggedToolTaskPredicate validates attribution against the canonical
// registry. JSON extraction accepts historical whitespace/key ordering while an
// exact value comparison rejects partial, unrelated and mismatched keys.
func taggedToolTaskPredicate() (string, []any) {
	parts := make([]string, 0, len(model.CanonicalAiTools))
	args := make([]any, 0, len(model.CanonicalAiTools)*2)
	for i := range model.CanonicalAiTools {
		tool := &model.CanonicalAiTools[i]
		parts = append(parts, "(handler = ? AND JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(COALESCE(input, '')), input, '{}'), '$.toolKey')) = ?)")
		args = append(args, tool.Handler, tool.Key)
	}
	if len(parts) == 0 {
		return "1 = 0", nil
	}
	return strings.Join(parts, " OR "), args
}

// Asset-only tool queries must never paginate blank cards. result_url is the
// normal single-result path; result_meta.urls[0] retains compatibility with
// historical multi-result tasks.
const usableToolResultPredicate = "(NULLIF(TRIM(COALESCE(result_url, '')), '') IS NOT NULL OR NULLIF(TRIM(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(COALESCE(result_meta, '')), result_meta, '{}'), '$.urls[0]')), '')), '') IS NOT NULL)"

func taskMediaHandlers(mediaType string) []string {
	switch strings.ToLower(strings.TrimSpace(mediaType)) {
	case "image":
		return mergeHandlerNames(
			[]string{"text_to_image", "image_to_image", capturedFrameHandler},
			toolMediaHandlerNames(model.AiToolTypeImage),
		)
	case "video":
		return mergeHandlerNames(
			[]string{"text_to_video", "image_to_video", "start_end_to_video", "reference_to_video"},
			toolMediaHandlerNames(model.AiToolTypeVideo),
		)
	case "audio":
		return []string{"text_to_audio"}
	case "3d":
		return []string{"generate_3d"}
	case "upscale":
		return []string{"video_upscale"}
	default:
		return nil
	}
}

// mergeHandlerNames preserves display/query order while preventing a shared
// tool handler (currently image_to_image) from appearing twice in an IN list.
func mergeHandlerNames(groups ...[]string) []string {
	seen := map[string]bool{}
	out := make([]string, 0)
	for _, group := range groups {
		for _, handler := range group {
			if handler == "" || seen[handler] {
				continue
			}
			seen[handler] = true
			out = append(out, handler)
		}
	}
	return out
}

func taskListOrder(q taskQuery) string {
	if strings.EqualFold(strings.TrimSpace(q.OrderDirection), "asc") {
		return "create_time ASC"
	}
	return "create_time DESC"
}

func visibleTaskHistoryScope(tx *gorm.DB) *gorm.DB {
	// Orchestration planning/draft tasks are internal implementation details.
	// A SkillRun task appears in ordinary generation history only after it has
	// been explicitly promoted to a final, registered output.
	return tx.Where("(origin IS NULL OR origin = '' OR origin = 'direct') OR (origin = 'skill_run' AND register_work = ? AND output_role = ?)", true, "final")
}

// applyDateRange 追加 create_time 范围筛选:startDate 当天 00:00 起;endDate
// 纯日期(≤10 字符)按次日 00:00 前(含当天),带时间部分按该时刻前。
// 解析不了的输入静默忽略(筛选项,不该 400)。
func applyDateRange(tx *gorm.DB, column, startDate, endDate string) *gorm.DB {
	if t := parseFlexDate(startDate); !t.IsZero() {
		tx = tx.Where(column+" >= ?", t)
	}
	if t := parseFlexDate(endDate); !t.IsZero() {
		end := t
		if len(strings.TrimSpace(endDate)) <= 10 {
			end = t.Add(24 * time.Hour)
		}
		tx = tx.Where(column+" < ?", end)
	}
	return tx
}

// parseFlexDate 解析 YYYY-MM-DD / RFC3339 / 常见日期时间,失败返回零值。
func parseFlexDate(s string) time.Time {
	s = strings.TrimSpace(s)
	if s == "" {
		return time.Time{}
	}
	for _, layout := range []string{time.RFC3339, "2006-01-02 15:04:05", "2006-01-02T15:04:05", "2006-01-02"} {
		if t, err := time.ParseInLocation(layout, s, time.Local); err == nil {
			return t
		}
	}
	return time.Time{}
}

// ---- AiModel (sourced from market_model) --------------------------------
//
// The catalog the canvas reads (/api/ai/models) and the model the generate
// pipeline resolves both come from market_model — the single source of truth the
// relay sync (handler/admin/relay_sync.go) and 模型管理 GUI populate. The legacy
// ai_models table is no longer consulted. Rows are adapted to the AiModel shape
// the rest of the AI domain (VO + provider) already speaks via marketToAiModel.

// marketModelListed is market_model.Status for an 已上架 (listed) model.
const marketModelListed = 1

// listEnabledModels returns the listed market models adapted to AiModel, ordered
// for the catalog (most-used first). The frontend filters by type client-side.
func (r *repo) listEnabledModels(ctx context.Context) ([]model.AiModel, error) {
	var rows []model.MarketModel
	if err := r.db.WithContext(ctx).
		Where("status = ?", marketModelListed).
		Order("use_count DESC, id ASC").
		Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]model.AiModel, 0, len(rows))
	for i := range rows {
		out = append(out, marketToAiModel(&rows[i]))
	}
	return out, nil
}

// findModel resolves a listed market model by its upstream model_key first (the
// frontend sends AiModelVO.modelId, which we map to market_model.model_key),
// then by numeric primary key. Returns (nil, nil) when not found.
func (r *repo) findModel(ctx context.Context, modelID string) (*model.AiModel, error) {
	if modelID == "" {
		return nil, nil
	}
	var m model.MarketModel
	err := r.db.WithContext(ctx).
		First(&m, "model_key = ? AND status = ?", modelID, marketModelListed).Error
	if err == nil {
		am := marketToAiModel(&m)
		return &am, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	// Fall back to numeric primary key.
	if id, perr := idgen.Parse(modelID); perr == nil && id != 0 {
		err = r.db.WithContext(ctx).
			First(&m, "id = ? AND status = ?", id, marketModelListed).Error
		if err == nil {
			am := marketToAiModel(&m)
			return &am, nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
	}
	return nil, nil
}

// ---- AiHandler ----------------------------------------------------------

// listEnabledHandlers returns enabled handlers ordered for the catalog.
func (r *repo) listEnabledHandlers(ctx context.Context) ([]model.AiHandler, error) {
	var rows []model.AiHandler
	err := r.db.WithContext(ctx).
		Where("enabled = ?", true).
		Order("sort_order ASC, id ASC").
		Find(&rows).Error
	return rows, err
}

// findHandler resolves a handler by its handlerName. Returns (nil, nil) when
// not found.
func (r *repo) findHandler(ctx context.Context, name string) (*model.AiHandler, error) {
	if name == "" {
		return nil, nil
	}
	var h model.AiHandler
	err := r.db.WithContext(ctx).First(&h, "handler_name = ?", name).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &h, nil
}

// ---- AiTool ---------------------------------------------------------------

// findToolByHandler resolves an ai_tools row by its registry handler name.
// Returns (nil, nil) when not found — 生成链路以内建默认值兜底（resilience）。
func (r *repo) findToolByHandler(ctx context.Context, handler string) (*model.AiTool, error) {
	if handler == "" {
		return nil, nil
	}
	var t model.AiTool
	err := r.db.WithContext(ctx).First(&t, "handler = ?", handler).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &t, nil
}

// findToolByKey resolves the policy row for an exact independent tool request.
// Key lookup avoids ambiguity when multiple tools reuse the same capability.
func (r *repo) findToolByKey(ctx context.Context, key string) (*model.AiTool, error) {
	if key == "" {
		return nil, nil
	}
	var t model.AiTool
	err := r.db.WithContext(ctx).First(&t, "`key` = ?", key).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &t, nil
}

// listSiteTools returns the tools shown on the public site（启用且有独立工具页
// /tools/<key> + 首页卡片），ordered for the catalog.
func (r *repo) listSiteTools(ctx context.Context) ([]model.AiTool, error) {
	var rows []model.AiTool
	err := r.db.WithContext(ctx).
		Where("enabled = ? AND show_page = ?", true, true).
		Order("sort_order ASC, create_time ASC").
		Find(&rows).Error
	return rows, err
}

// ---- AiGenerationLog ----------------------------------------------------

func (r *repo) createLog(ctx context.Context, l *model.AiGenerationLog) error {
	return r.db.WithContext(ctx).Create(l).Error
}

// listLogs returns a page of generation logs filtered by the query, scoped to
// the user unless they are an admin (adminScope=true lifts the user filter).
func (r *repo) listLogs(ctx context.Context, userID idgen.ID, adminScope bool, q logQuery, offset, limit int) ([]model.AiGenerationLog, int64, error) {
	tx := r.db.WithContext(ctx).Model(&model.AiGenerationLog{})
	if !adminScope {
		tx = tx.Where("user_id = ?", userID)
	} else if q.UserID != 0 {
		tx = tx.Where("user_id = ?", q.UserID)
	}
	if q.TaskID != 0 {
		tx = tx.Where("task_id = ?", q.TaskID)
	}
	if q.ProjectID != 0 {
		tx = tx.Where("project_id = ?", q.ProjectID)
	}
	if q.HandlerName != "" {
		tx = tx.Where("handler_name = ?", q.HandlerName)
	}
	if q.OperationType != "" {
		tx = tx.Where("operation_type = ?", q.OperationType)
	}
	if q.Success != nil {
		tx = tx.Where("success = ?", *q.Success)
	}

	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var rows []model.AiGenerationLog
	if err := tx.Order("create_time DESC").Offset(offset).Limit(limit).Find(&rows).Error; err != nil {
		return nil, 0, err
	}
	return rows, total, nil
}

// ---- association helpers (log VO enrichment) ----------------------------

// userNames returns id->username for the given user ids.
func (r *repo) userNames(ctx context.Context, ids []idgen.ID) (map[idgen.ID]string, error) {
	out := map[idgen.ID]string{}
	if len(ids) == 0 {
		return out, nil
	}
	var rows []model.User
	if err := r.db.WithContext(ctx).Select("id", "username", "nickname").Where("id IN ?", ids).Find(&rows).Error; err != nil {
		return nil, err
	}
	for i := range rows {
		name := rows[i].Nickname
		if name == "" {
			name = rows[i].Username
		}
		out[rows[i].ID] = name
	}
	return out, nil
}

// projectNames returns id->name for the given project ids.
func (r *repo) projectNames(ctx context.Context, ids []idgen.ID) (map[idgen.ID]string, error) {
	out := map[idgen.ID]string{}
	if len(ids) == 0 {
		return out, nil
	}
	var rows []model.Project
	if err := r.db.WithContext(ctx).Select("id", "name").Where("id IN ?", ids).Find(&rows).Error; err != nil {
		return nil, err
	}
	for i := range rows {
		out[rows[i].ID] = rows[i].Name
	}
	return out, nil
}

type taskLogState struct {
	ID       idgen.ID
	Status   int
	ErrorMsg string
}

// taskLogStates returns the terminal display fields needed to enrich user-facing
// generation history without exposing the raw provider error kept in audit logs.
func (r *repo) taskLogStates(ctx context.Context, ids []idgen.ID) (map[idgen.ID]taskLogState, error) {
	out := map[idgen.ID]taskLogState{}
	if len(ids) == 0 {
		return out, nil
	}
	var rows []taskLogState
	if err := r.db.WithContext(ctx).Model(&model.AiTask{}).
		Select("id", "status", "error_msg").Where("id IN ?", ids).Find(&rows).Error; err != nil {
		return nil, err
	}
	for i := range rows {
		out[rows[i].ID] = rows[i]
	}
	return out, nil
}
