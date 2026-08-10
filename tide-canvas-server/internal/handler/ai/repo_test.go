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

func TestAssetTaskFiltersRunBeforePagination(t *testing.T) {
	db, err := gorm.Open(mysql.New(mysql.Config{DSN: "gorm:gorm@tcp(localhost:9911)/gorm?charset=utf8mb4&parseTime=True&loc=Local", SkipInitializeWithVersion: true}),
		&gorm.Config{DryRun: true, DisableAutomaticPing: true})
	if err != nil {
		t.Fatal(err)
	}
	q := taskQuery{MediaType: "video", AssetOnly: true, OrderDirection: "asc"}
	sql := db.ToSQL(func(tx *gorm.DB) *gorm.DB {
		return applyTaskListFilters(tx.Model(&model.AiTask{}), 7, q).
			Order(taskListOrder(q)).Offset(24).Limit(24).Find(&[]model.AiTask{})
	})
	for _, fragment := range []string{
		"handler IN",
		"reference_to_video",
		"status NOT IN (2,3)",
		"ORDER BY create_time ASC",
		"LIMIT 24 OFFSET 24",
	} {
		if !strings.Contains(sql, fragment) {
			t.Fatalf("asset task query SQL is missing %q: %s", fragment, sql)
		}
	}
}

func TestTaskMediaHandlersIncludeEveryVideoMode(t *testing.T) {
	got := strings.Join(taskMediaHandlers("video"), ",")
	for _, handler := range []string{"text_to_video", "image_to_video", "start_end_to_video", "reference_to_video"} {
		if !strings.Contains(got, handler) {
			t.Fatalf("video handler list is missing %q: %s", handler, got)
		}
	}
}

func TestTaskMediaHandlersIncludes3DGeneration(t *testing.T) {
	got := taskMediaHandlers("3d")
	if len(got) != 1 || got[0] != "generate_3d" {
		t.Fatalf("3d handlers = %v", got)
	}
}

func TestTaskMediaHandlersIncludesVideoUpscale(t *testing.T) {
	got := taskMediaHandlers("upscale")
	if len(got) != 1 || got[0] != "video_upscale" {
		t.Fatalf("upscale handlers = %v", got)
	}
}

// 「工具作品」桶收可归因到智能工具的 handler(含只有工具入口的视频超分);
// 局部重绘复用创作台的通用图生图,无法与普通图生图区分,必须排除在外。
func TestTaskMediaHandlersToolBucket(t *testing.T) {
	handlers := taskMediaHandlers("tool")
	got := strings.Join(handlers, ",")
	for _, handler := range []string{"outpaint", "remove_bg", "upscale", "remove_object", "relight", "video_upscale"} {
		if !strings.Contains(got, handler) {
			t.Fatalf("tool bucket is missing %q: %s", handler, got)
		}
	}
	if strings.Contains(got, "image_to_image") {
		t.Fatalf("tool bucket must not contain the shared image_to_image handler: %s", got)
	}
	seen := map[string]bool{}
	for _, h := range handlers {
		if seen[h] {
			t.Fatalf("tool bucket has a duplicate handler %q: %s", h, got)
		}
		seen[h] = true
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
