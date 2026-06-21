package ai

import (
	"context"
	"errors"

	"gorm.io/gorm"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

// repo is the AI domain's data-access layer over *gorm.DB.
type repo struct {
	db *gorm.DB
}

func newRepo(db *gorm.DB) *repo { return &repo{db: db} }

// ---- AiTask -------------------------------------------------------------

func (r *repo) createTask(ctx context.Context, t *model.AiTask) error {
	return r.db.WithContext(ctx).Create(t).Error
}

func (r *repo) updateTask(ctx context.Context, t *model.AiTask) error {
	return r.db.WithContext(ctx).Save(t).Error
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
	tx := r.db.WithContext(ctx).Model(&model.AiTask{}).Where("user_id = ?", userID)
	if q.Handler != "" {
		tx = tx.Where("handler = ?", q.Handler)
	}
	if q.Status != nil {
		tx = tx.Where("status = ?", *q.Status)
	}
	if q.ProjectID != 0 {
		tx = tx.Where("project_id = ?", q.ProjectID)
	}

	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var rows []model.AiTask
	if err := tx.Order("create_time DESC").Offset(offset).Limit(limit).Find(&rows).Error; err != nil {
		return nil, 0, err
	}
	return rows, total, nil
}

// ---- AiModel ------------------------------------------------------------

// listEnabledModels returns enabled models ordered for the catalog.
func (r *repo) listEnabledModels(ctx context.Context) ([]model.AiModel, error) {
	var rows []model.AiModel
	err := r.db.WithContext(ctx).
		Where("enabled = ?", true).
		Order("sort_order ASC, id ASC").
		Find(&rows).Error
	return rows, err
}

// findModel resolves a model by its upstream ModelID string first, then by its
// numeric primary key (the frontend sends AiModelVO.modelId, the upstream id).
func (r *repo) findModel(ctx context.Context, modelID string) (*model.AiModel, error) {
	if modelID == "" {
		return nil, nil
	}
	var m model.AiModel
	err := r.db.WithContext(ctx).First(&m, "model_id = ?", modelID).Error
	if err == nil {
		return &m, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	// Fall back to numeric primary key.
	if id, perr := idgen.Parse(modelID); perr == nil && id != 0 {
		err = r.db.WithContext(ctx).First(&m, "id = ?", id).Error
		if err == nil {
			return &m, nil
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

// taskStatuses returns id->status for the given task ids.
func (r *repo) taskStatuses(ctx context.Context, ids []idgen.ID) (map[idgen.ID]int, error) {
	out := map[idgen.ID]int{}
	if len(ids) == 0 {
		return out, nil
	}
	var rows []model.AiTask
	if err := r.db.WithContext(ctx).Select("id", "status").Where("id IN ?", ids).Find(&rows).Error; err != nil {
		return nil, err
	}
	for i := range rows {
		out[rows[i].ID] = rows[i].Status
	}
	return out, nil
}
