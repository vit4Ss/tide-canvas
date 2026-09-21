package ai

import (
	"context"
	"encoding/json"
	"errors"

	"gorm.io/gorm"

	"tidecanvas/internal/app"
	"tidecanvas/internal/handler/points"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

const (
	TaskProcessing = statusProcessing
	TaskSuccess    = statusSuccess
	TaskFailed     = statusFailed
	TaskCancelled  = statusCancelled
)

// GenerationCommand is the internal contract used by SkillRun. Orchestration
// metadata is persisted on AiTask and never forwarded to an upstream provider.
type GenerationCommand struct {
	IsAPICall         bool
	PublicInput       json.RawMessage
	ProjectID         idgen.ID
	Handler           string
	ModelID           string
	Input             map[string]any
	Origin            string
	SkillRunID        idgen.ID
	SkillRunStepID    idgen.ID
	SkillRunRevision  int64
	SkillRunWorkerID  string
	OutputRole        string
	RegisterWork      bool
	PinnedSkillPrompt string
}

type TaskSnapshot struct {
	ID           idgen.ID
	UserID       idgen.ID
	Status       int
	Progress     int
	PointCost    int64
	ResultURL    string
	ResultMeta   string
	ErrorMessage string
}

// Provider execution continues to use dto.Input. Only the explicitly supplied
// user input is persisted into user-visible tasks/history for private Skills.
func persistedGenerationInput(dto generateDTO) json.RawMessage {
	if dto.SkillRunID != 0 {
		if len(dto.PublicInput) > 0 {
			return normalizeInput(dto.PublicInput)
		}
		// Never fall back to a private workflow prompt for public history.
		return json.RawMessage(`{}`)
	}
	return normalizeInput(dto.Input)
}

// GenerationFacade exposes the existing task/model/points/provider pipeline to
// in-process orchestrators without making an HTTP loopback call.
type GenerationFacade struct{ svc *service }

func NewGenerationFacade(d *app.Deps) *GenerationFacade {
	return &GenerationFacade{svc: newService(d)}
}

func (f *GenerationFacade) Submit(ctx context.Context, userID idgen.ID, cmd GenerationCommand) (idgen.ID, error) {
	if f == nil || f.svc == nil {
		return 0, errors.New("generation facade is unavailable")
	}
	raw, err := json.Marshal(cmd.Input)
	if err != nil {
		return 0, err
	}
	registerWork := cmd.RegisterWork
	vo, err := f.svc.generate(ctx, userID, generateDTO{
		IsAPICall: cmd.IsAPICall, PublicInput: cmd.PublicInput,
		Handler: cmd.Handler, ModelID: cmd.ModelID, ProjectID: cmd.ProjectID,
		Input: raw, Origin: cmd.Origin, SkillRunID: cmd.SkillRunID,
		SkillRunStepID: cmd.SkillRunStepID, SkillRunRevision: cmd.SkillRunRevision,
		SkillRunWorkerID: cmd.SkillRunWorkerID, OutputRole: cmd.OutputRole,
		RegisterWork: &registerWork, PinnedSkillPrompt: cmd.PinnedSkillPrompt,
	})
	if err != nil {
		return 0, err
	}
	return vo.ID, nil
}

func (f *GenerationFacade) Get(ctx context.Context, userID, taskID idgen.ID) (*TaskSnapshot, error) {
	t, err := f.svc.repo.getTask(ctx, taskID)
	if err != nil {
		return nil, err
	}
	if t == nil {
		return nil, errTaskNotFound
	}
	if t.UserID != userID {
		return nil, errTaskForbidden
	}
	return &TaskSnapshot{ID: t.ID, UserID: t.UserID, Status: t.Status,
		Progress: t.Progress, PointCost: t.PointCost, ResultURL: t.ResultUrl,
		ResultMeta: t.ResultMeta, ErrorMessage: t.ErrorMsg}, nil
}

func (f *GenerationFacade) Cancel(ctx context.Context, userID, taskID idgen.ID) error {
	return f.svc.cancelTask(ctx, userID, taskID)
}

// RefundFailedSkillRun compensates successful child calls when the parent
// workflow fails before delivering a final result. Each task ID is its own
// durable refund key, so retries and multiple workers cannot credit twice.
func (f *GenerationFacade) RefundFailedSkillRun(ctx context.Context, runID idgen.ID) error {
	if f == nil || f.svc == nil || f.svc.repo == nil || f.svc.repo.db == nil || runID == 0 {
		return errors.New("generation facade is unavailable")
	}
	db := f.svc.repo.db.WithContext(ctx)
	var run model.SkillRun
	if err := db.Select("id", "user_id", "status").First(&run, "id = ?", runID).Error; err != nil {
		return err
	}
	if run.Status != model.SkillRunFailed {
		return nil
	}
	var tasks []model.AiTask
	if err := db.Unscoped().Select("id", "user_id", "status", "point_cost", "refunded").
		Where("skill_run_id = ? AND user_id = ? AND status = ? AND point_cost > 0", runID, run.UserID, statusSuccess).
		Find(&tasks).Error; err != nil {
		return err
	}
	refundErrors := make([]error, 0)
	for i := range tasks {
		if tasks[i].Refunded {
			continue
		}
		if err := points.Refund(db, run.UserID, int(tasks[i].PointCost), "技能执行失败退款", tasks[i].ID); err != nil {
			refundErrors = append(refundErrors, err)
		}
	}
	var remaining int64
	if err := db.Unscoped().Model(&model.AiTask{}).
		Where("skill_run_id = ? AND user_id = ? AND status = ? AND point_cost > 0 AND refunded = ?", runID, run.UserID, statusSuccess, false).
		Select("COALESCE(SUM(point_cost), 0)").Scan(&remaining).Error; err != nil {
		refundErrors = append(refundErrors, err)
	} else if err := db.Model(&model.SkillRun{}).Where("id = ? AND status = ?", runID, model.SkillRunFailed).
		Update("point_cost", remaining).Error; err != nil {
		refundErrors = append(refundErrors, err)
	}
	return errors.Join(refundErrors...)
}

// PromoteTask finalizes a successful draft task after explicit workflow
// approval. It is safe to call repeatedly during crash recovery.
func (f *GenerationFacade) PromoteTask(ctx context.Context, userID, taskID idgen.ID) error {
	if f == nil || f.svc == nil {
		return errors.New("generation facade is unavailable")
	}
	return f.svc.promoteTask(ctx, userID, taskID)
}

// PromoteTaskTx participates in the caller's completion transaction so work
// registration, task visibility and SkillRun success become observable together.
func (f *GenerationFacade) PromoteTaskTx(ctx context.Context, tx *gorm.DB, userID, taskID idgen.ID) error {
	if f == nil || f.svc == nil || tx == nil {
		return errors.New("generation facade is unavailable")
	}
	return f.svc.promoteTaskTx(ctx, tx, userID, taskID)
}
