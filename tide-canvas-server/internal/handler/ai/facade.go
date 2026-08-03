package ai

import (
	"context"
	"encoding/json"
	"errors"

	"gorm.io/gorm"

	"tidecanvas/internal/app"
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
