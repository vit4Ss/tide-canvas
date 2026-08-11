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

func TestStudioHistoryExcludesToolTasksBeforePagination(t *testing.T) {
	db, err := gorm.Open(mysql.New(mysql.Config{DSN: "gorm:gorm@tcp(localhost:9911)/gorm?charset=utf8mb4&parseTime=True&loc=Local", SkipInitializeWithVersion: true}),
		&gorm.Config{DryRun: true, DisableAutomaticPing: true})
	if err != nil {
		t.Fatal(err)
	}
	q := taskQuery{NoProject: true, ExcludeTools: true}
	sql := db.ToSQL(func(tx *gorm.DB) *gorm.DB {
		return applyTaskListFilters(tx.Model(&model.AiTask{}), 7, q).
			Order(taskListOrder(q)).Offset(20).Limit(20).Find(&[]model.AiTask{})
	})
	for _, fragment := range []string{"NOT ((handler =", "outpaint", "expand", "image_to_image", "JSON_VALID", "$.toolKey", "inpaint", "project_id = 0", "LIMIT 20 OFFSET 20"} {
		if !strings.Contains(sql, fragment) {
			t.Fatalf("studio history SQL is missing %q: %s", fragment, sql)
		}
	}
	if strings.Contains(sql, "handler IN") {
		t.Fatalf("studio history must not classify untagged legacy rows by handler: %s", sql)
	}
}

func TestToolHistoryIncludesOnlyTaggedCanonicalTasksWithResults(t *testing.T) {
	db, err := gorm.Open(mysql.New(mysql.Config{DSN: "gorm:gorm@tcp(localhost:9911)/gorm?charset=utf8mb4&parseTime=True&loc=Local", SkipInitializeWithVersion: true}),
		&gorm.Config{DryRun: true, DisableAutomaticPing: true})
	if err != nil {
		t.Fatal(err)
	}
	q := taskQuery{MediaType: "tool", AssetOnly: true}
	sql := db.ToSQL(func(tx *gorm.DB) *gorm.DB {
		return applyTaskListFilters(tx.Model(&model.AiTask{}), 7, q).Find(&[]model.AiTask{})
	})
	for _, fragment := range []string{"outpaint", "expand", "image_to_image", "JSON_EXTRACT", "$.toolKey", "inpaint", "result_url", "result_meta", "$.urls[0]"} {
		if !strings.Contains(sql, fragment) {
			t.Fatalf("tool history SQL is missing %q: %s", fragment, sql)
		}
	}
	if strings.Contains(sql, "handler IN") {
		t.Fatalf("tool history must not include untagged tasks by handler: %s", sql)
	}
}

func TestTaggedToolTaskPredicateUsesEveryCanonicalPair(t *testing.T) {
	predicate, args := taggedToolTaskPredicate()
	if !strings.Contains(predicate, "JSON_VALID") || !strings.Contains(predicate, "JSON_EXTRACT") {
		t.Fatalf("tagged tool predicate must parse valid JSON exactly: %s", predicate)
	}
	if len(args) != len(model.CanonicalAiTools)*2 {
		t.Fatalf("tagged pairs = %d args, want %d: %#v", len(args), len(model.CanonicalAiTools)*2, args)
	}
	for i := range model.CanonicalAiTools {
		tool := &model.CanonicalAiTools[i]
		if args[i*2] != tool.Handler || args[i*2+1] != tool.Key {
			t.Fatalf("pair %d = %#v/%#v, want %s/%s", i, args[i*2], args[i*2+1], tool.Handler, tool.Key)
		}
	}
	for _, unsafe := range []string{"text_to_image", "toolKey\":%", "LIKE"} {
		if strings.Contains(predicate, unsafe) {
			t.Fatalf("tagged tool predicate contains unsafe fragment %q: %s", unsafe, predicate)
		}
	}
}

func TestTaskMediaHandlersIncludeEveryVideoMode(t *testing.T) {
	got := strings.Join(taskMediaHandlers("video"), ",")
	for _, handler := range []string{"text_to_video", "image_to_video", "start_end_to_video", "reference_to_video", "video_upscale"} {
		if !strings.Contains(got, handler) {
			t.Fatalf("video handler list is missing %q: %s", handler, got)
		}
	}
}

func TestTaskMediaHandlersIncludeEveryImageTool(t *testing.T) {
	handlers := taskMediaHandlers("image")
	got := strings.Join(handlers, ",")
	for _, handler := range []string{"text_to_image", "image_to_image", "outpaint", "remove_bg", "upscale", "remove_object", "relight"} {
		if !strings.Contains(got, handler) {
			t.Fatalf("image handler list is missing %q: %s", handler, got)
		}
	}
	seen := map[string]bool{}
	for _, handler := range handlers {
		if seen[handler] {
			t.Fatalf("image handler list contains duplicate %q: %s", handler, got)
		}
		seen[handler] = true
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
