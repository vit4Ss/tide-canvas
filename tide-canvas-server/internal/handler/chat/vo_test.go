package chat

import (
	"testing"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

func TestToMessageTaskVOIncludesStableModelRowID(t *testing.T) {
	task := &model.AiTask{
		ID:        idgen.ID(101),
		ModelID:   idgen.ID(202),
		ModelName: "renamed model",
	}

	got := toMessageTaskVO(task)
	if got == nil || got.ModelID != task.ModelID {
		t.Fatalf("model id = %v, want %v", got, task.ModelID)
	}
}

func TestTasksByIDsLoadsModelIdentityForHistory(t *testing.T) {
	db := openPersistTurnTestDB(t)
	task := &model.AiTask{
		ID:        idgen.ID(301),
		UserID:    idgen.ID(302),
		ModelID:   idgen.ID(303),
		ModelName: "historical model",
	}
	if err := db.Create(task).Error; err != nil {
		t.Fatalf("create task: %v", err)
	}

	got, err := newRepo(db).tasksByIDs([]idgen.ID{task.ID}, task.UserID)
	if err != nil {
		t.Fatalf("load tasks: %v", err)
	}
	loaded := got[task.ID]
	if loaded == nil || loaded.ModelID != task.ModelID || loaded.ModelName != task.ModelName {
		t.Fatalf("model identity = %#v, want id=%v name=%q", loaded, task.ModelID, task.ModelName)
	}
}
