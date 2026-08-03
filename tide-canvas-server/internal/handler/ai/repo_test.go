package ai

import (
	"strings"
	"testing"
	"time"

	"gorm.io/driver/mysql"
	"gorm.io/gorm"

	"tidecanvas/internal/model"
)

func TestVisibleTaskHistoryScopeHidesInternalSkillRunTasks(t *testing.T) {
	db, err := gorm.Open(mysql.New(mysql.Config{DSN: "gorm:gorm@tcp(localhost:9911)/gorm?charset=utf8mb4&parseTime=True&loc=Local", SkipInitializeWithVersion: true}),
		&gorm.Config{DryRun: true, DisableAutomaticPing: true})
	if err != nil {
		t.Fatal(err)
	}
	sql := db.ToSQL(func(tx *gorm.DB) *gorm.DB {
		return visibleTaskHistoryScope(tx.Model(&model.AiTask{}).Where("user_id = ?", 7)).Find(&[]model.AiTask{})
	})
	for _, fragment := range []string{"origin = 'direct'", "origin = 'skill_run'", "register_work = true", "output_role = 'final'"} {
		if !strings.Contains(sql, fragment) {
			t.Fatalf("history scope SQL is missing %q: %s", fragment, sql)
		}
	}
}

func TestStaleTaskTerminalUpdatesUseActualCompletionTime(t *testing.T) {
	terminalAt := time.Date(2026, 8, 2, 20, 30, 0, 0, time.UTC)
	updates := staleTaskTerminalUpdates(statusFailed, "interrupted", terminalAt)
	if updates["status"] != statusFailed || updates["progress"] != 100 || updates["error_msg"] != "interrupted" {
		t.Fatalf("unexpected terminal fields: %#v", updates)
	}
	if updates["update_time"] != terminalAt || updates["complete_time"] != terminalAt {
		t.Fatalf("stale task timestamps do not use completion time: %#v", updates)
	}
}
