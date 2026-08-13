package ai

import (
	"reflect"
	"strings"
	"testing"
	"time"

	"gorm.io/driver/mysql"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"tidecanvas/internal/model"
)

func TestVisibleTaskHistoryScopeKeepsFailedFinalSkillRunTasks(t *testing.T) {
	db, err := gorm.Open(mysql.New(mysql.Config{DSN: "gorm:gorm@tcp(localhost:9911)/gorm?charset=utf8mb4&parseTime=True&loc=Local", SkipInitializeWithVersion: true}),
		&gorm.Config{DryRun: true, DisableAutomaticPing: true})
	if err != nil {
		t.Fatal(err)
	}
	sql := db.ToSQL(func(tx *gorm.DB) *gorm.DB {
		return visibleTaskHistoryScope(tx.Model(&model.AiTask{}).Where("user_id = ?", 7)).Find(&[]model.AiTask{})
	})
	for _, fragment := range []string{
		"origin = 'direct'",
		"origin = 'skill_run'",
		"output_role = 'final' AND (register_work = true OR status = 2)",
	} {
		if !strings.Contains(sql, fragment) {
			t.Fatalf("history scope SQL is missing %q: %s", fragment, sql)
		}
	}
}

func TestVisibleTaskHistoryScopeTruthTable(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE TABLE ai_tasks (
		id INTEGER PRIMARY KEY,
		origin TEXT,
		output_role TEXT NOT NULL,
		register_work INTEGER NOT NULL,
		status INTEGER NOT NULL
	)`).Error; err != nil {
		t.Fatal(err)
	}
	rows := []struct {
		id           int
		origin       string
		outputRole   string
		registerWork bool
		status       int
	}{
		{1, "direct", "final", false, statusFailed},
		{2, "skill_run", "final", false, statusFailed},
		{3, "skill_run", "final", true, statusSuccess},
		{4, "skill_run", "final", false, statusSuccess},
		{5, "skill_run", "intermediate", false, statusFailed},
		{6, "skill_run", "final", false, statusCancelled},
	}
	for _, row := range rows {
		if err := db.Exec(
			"INSERT INTO ai_tasks (id, origin, output_role, register_work, status) VALUES (?, ?, ?, ?, ?)",
			row.id, row.origin, row.outputRole, row.registerWork, row.status,
		).Error; err != nil {
			t.Fatal(err)
		}
	}
	var ids []int
	if err := visibleTaskHistoryScope(db.Table("ai_tasks")).Order("id").Pluck("id", &ids).Error; err != nil {
		t.Fatal(err)
	}
	if want := []int{1, 2, 3}; !reflect.DeepEqual(ids, want) {
		t.Fatalf("visible task ids = %v, want %v", ids, want)
	}
}

func TestVisibleUserLogScopeMatchesTaskHistoryTruthTable(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	for _, statement := range []string{
		`CREATE TABLE ai_tasks (
			id INTEGER PRIMARY KEY,
			origin TEXT,
			output_role TEXT NOT NULL,
			register_work INTEGER NOT NULL,
			status INTEGER NOT NULL
		)`,
		"CREATE TABLE ai_generation_logs (id INTEGER PRIMARY KEY, task_id INTEGER NOT NULL)",
	} {
		if err := db.Exec(statement).Error; err != nil {
			t.Fatal(err)
		}
	}
	tasks := []struct {
		id           int
		origin       string
		outputRole   string
		registerWork bool
		status       int
	}{
		{2, "direct", "final", false, statusFailed},
		{3, "skill_run", "final", false, statusFailed},
		{4, "skill_run", "intermediate", false, statusFailed},
		{5, "skill_run", "final", false, statusSuccess},
		{6, "skill_run", "final", true, statusSuccess},
	}
	for _, task := range tasks {
		if err := db.Exec(
			"INSERT INTO ai_tasks (id, origin, output_role, register_work, status) VALUES (?, ?, ?, ?, ?)",
			task.id, task.origin, task.outputRole, task.registerWork, task.status,
		).Error; err != nil {
			t.Fatal(err)
		}
	}
	// id=1 deliberately references no task: historical audit rows whose task was
	// already deleted remain part of the user's history.
	for id := 1; id <= 6; id++ {
		if err := db.Exec("INSERT INTO ai_generation_logs (id, task_id) VALUES (?, ?)", id, id).Error; err != nil {
			t.Fatal(err)
		}
	}
	var ids []int
	if err := visibleUserLogScope(db.Table("ai_generation_logs")).Order("id").Pluck("id", &ids).Error; err != nil {
		t.Fatal(err)
	}
	if want := []int{1, 2, 3, 6}; !reflect.DeepEqual(ids, want) {
		t.Fatalf("visible log ids = %v, want %v", ids, want)
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
	q := taskQuery{NoProject: true, ExcludeTools: true, ExcludeCaptures: true}
	sql := db.ToSQL(func(tx *gorm.DB) *gorm.DB {
		return applyTaskListFilters(tx.Model(&model.AiTask{}), 7, q).
			Order(taskListOrder(q)).Offset(20).Limit(20).Find(&[]model.AiTask{})
	})
	for _, fragment := range []string{"NOT ((handler =", "outpaint", "expand", "image_to_image", "JSON_VALID", "COALESCE(JSON_UNQUOTE", "$.toolKey", "inpaint", capturedFrameHandler, "project_id = 0", "LIMIT 20 OFFSET 20"} {
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
	if got := strings.Count(predicate, "COALESCE(JSON_UNQUOTE"); got != len(model.CanonicalAiTools) {
		t.Fatalf("NULL-safe toolKey comparisons = %d, want %d: %s", got, len(model.CanonicalAiTools), predicate)
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

func TestTaggedToolTaskPredicateTruthTable(t *testing.T) {
	predicate, args := taggedToolTaskPredicate()
	// SQLite's JSON_EXTRACT already returns an unquoted scalar and names IF as
	// IIF. The remaining expression has the same NULL/boolean semantics as MySQL,
	// which lets this regression test execute the generated predicate locally.
	sqlitePredicate := strings.ReplaceAll(predicate, "JSON_UNQUOTE(", "(")
	sqlitePredicate = strings.ReplaceAll(sqlitePredicate, "IF(", "IIF(")

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("CREATE TABLE ai_tasks (id INTEGER PRIMARY KEY, handler TEXT NOT NULL, input TEXT)").Error; err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		name         string
		handler      string
		input        string
		wantTagged   int
		wantInStudio int
	}{
		{name: "ordinary shared handler", handler: "image_to_image", input: `{"prompt":"edit"}`, wantInStudio: 1},
		{name: "canonical tool", handler: "image_to_image", input: `{"toolKey":"inpaint"}`, wantTagged: 1},
		{name: "mismatched marker", handler: "image_to_image", input: `{"toolKey":"expand"}`, wantInStudio: 1},
		{name: "malformed legacy input", handler: "image_to_image", input: `{`, wantInStudio: 1},
	}
	for index, tc := range tests {
		id := index + 1
		if err := db.Exec("INSERT INTO ai_tasks (id, handler, input) VALUES (?, ?, ?)", id, tc.handler, tc.input).Error; err != nil {
			t.Fatal(err)
		}
		var truth struct {
			Tagged        int `gorm:"column:tagged"`
			StudioVisible int `gorm:"column:studio_visible"`
		}
		queryArgs := append([]any{}, args...)
		queryArgs = append(queryArgs, args...)
		queryArgs = append(queryArgs, id)
		query := "SELECT (" + sqlitePredicate + ") AS tagged, NOT (" + sqlitePredicate + ") AS studio_visible FROM ai_tasks WHERE id = ?"
		if err := db.Raw(query, queryArgs...).Scan(&truth).Error; err != nil {
			t.Fatalf("%s: %v", tc.name, err)
		}
		if truth.Tagged != tc.wantTagged || truth.StudioVisible != tc.wantInStudio {
			t.Fatalf("%s: tagged/studio = %d/%d, want %d/%d", tc.name, truth.Tagged, truth.StudioVisible, tc.wantTagged, tc.wantInStudio)
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
	for _, handler := range []string{"text_to_image", "image_to_image", capturedFrameHandler, "outpaint", "remove_bg", "upscale", "remove_object", "relight"} {
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

func TestTaskMediaHandlersIncludesUserVisibleTextRuns(t *testing.T) {
	got := strings.Join(taskMediaHandlers("text"), ",")
	for _, handler := range []string{assistantChatHandler, skillTextCompletionHandler} {
		if !strings.Contains(got, handler) {
			t.Fatalf("text handler list is missing %q: %s", handler, got)
		}
	}
}

func TestUserLogFiltersKeepCallerScopeBeforePagination(t *testing.T) {
	db, err := gorm.Open(mysql.New(mysql.Config{DSN: "gorm:gorm@tcp(localhost:9911)/gorm?charset=utf8mb4&parseTime=True&loc=Local", SkipInitializeWithVersion: true}),
		&gorm.Config{DryRun: true, DisableAutomaticPing: true})
	if err != nil {
		t.Fatal(err)
	}
	zero := 0
	q := logQuery{
		UserID: 999, MediaType: "video", Keyword: "雨夜", Success: &zero,
		StartDate: "2026-08-01", EndDate: "2026-08-12",
	}
	sql := db.ToSQL(func(tx *gorm.DB) *gorm.DB {
		return applyLogListFilters(tx.Model(&model.AiGenerationLog{}), 7, false, q).
			Order("create_time DESC").Offset(20).Limit(20).Find(&[]model.AiGenerationLog{})
	})
	for _, fragment := range []string{
		"user_id = 7", "handler_name IN", "reference_to_video", "input_params LIKE", "success = 0",
		"NOT EXISTS", "origin = 'skill_run'", "t.output_role = 'final' AND (t.register_work = true OR t.status = 2)",
		"create_time >=", "create_time <", "LIMIT 20 OFFSET 20",
	} {
		if !strings.Contains(sql, fragment) {
			t.Fatalf("user log query SQL is missing %q: %s", fragment, sql)
		}
	}
	if strings.Contains(sql, "user_id = 999") {
		t.Fatalf("caller-scoped logs must ignore a forged userId filter: %s", sql)
	}
}

func TestAdminLogFiltersKeepAuditScope(t *testing.T) {
	db, err := gorm.Open(mysql.New(mysql.Config{DSN: "gorm:gorm@tcp(localhost:9911)/gorm?charset=utf8mb4&parseTime=True&loc=Local", SkipInitializeWithVersion: true}),
		&gorm.Config{DryRun: true, DisableAutomaticPing: true})
	if err != nil {
		t.Fatal(err)
	}
	sql := db.ToSQL(func(tx *gorm.DB) *gorm.DB {
		return applyLogListFilters(tx.Model(&model.AiGenerationLog{}), 7, true, logQuery{UserID: 999}).Find(&[]model.AiGenerationLog{})
	})
	if !strings.Contains(sql, "user_id = 999") {
		t.Fatalf("admin log query lost its explicit user filter: %s", sql)
	}
	for _, unexpected := range []string{"NOT EXISTS", "register_work", "user_id = 7"} {
		if strings.Contains(sql, unexpected) {
			t.Fatalf("admin audit scope unexpectedly contains %q: %s", unexpected, sql)
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
