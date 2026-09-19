package skillrun

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"tidecanvas/internal/app"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/mcpconfig"
	"tidecanvas/internal/pkg/userkey"
)

func skillMCPTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	pool, _ := db.DB()
	pool.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = pool.Close() })
	if err := db.AutoMigrate(&model.User{}, &model.UserAPIKey{}, &model.Skill{}, &model.SkillVersion{}, &model.SkillFile{}, &model.SkillSurfaceBinding{}, &model.SkillRun{}, &model.SkillRunStep{}, &model.SkillRunArtifact{}, &model.SkillRunActionReceipt{}, &model.MCPSettings{}); err != nil {
		t.Fatal(err)
	}
	return db
}

func addMCPSkill(t *testing.T, db *gorm.DB, kind string) model.Skill {
	t.Helper()
	skill := model.Skill{Title: "Test " + kind, Kind: kind, Status: 1, MCPEnabled: true}
	if err := db.Create(&skill).Error; err != nil {
		t.Fatal(err)
	}
	v := model.SkillVersion{SkillID: skill.ID, Version: 1, Kind: kind, Status: model.SkillVersionPublished, PrimaryOutputType: "text", OutputTypes: `["text"]`, EntryPoints: `["canvas"]`, InputSchema: `{"type":"object"}`, BindingsJSON: `[]`, DefaultParams: `{"systemPrompt":"private-default"}`, PromptTemplate: "private-prompt", ManifestJSON: `{"steps":[{"key":"private-step","title":"private-workflow"}]}`}
	if err := db.Create(&v).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&v).Update("primary_file_path", "SKILL.md").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.SkillFile{SkillVersionID: v.ID, Path: "SKILL.md", Content: "---\nname: test-skill\ndescription: Test skill\n---\n\nprivate-prompt"}).Error; err != nil {
		t.Fatal(err)
	}
	skill.CurrentVersionID = v.ID
	if err := db.Model(&skill).Update("current_version_id", v.ID).Error; err != nil {
		t.Fatal(err)
	}
	return skill
}

func TestMCPSkillRunsReusePublishedKindsAndRequestIDs(t *testing.T) {
	db := skillMCPTestDB(t)
	svc := &service{db: db}
	for _, kind := range []string{"preset", "agent", "tool"} {
		skill := addMCPSkill(t, db, kind)
		dto := CreateDTO{MCP: true, SkillID: skill.ID.String(), EntryPoint: "mcp", ClientRequestID: "mcp:" + kind, Input: RunInput{Prompt: "user request"}}
		run, existed, err := svc.createRun(context.Background(), 42, dto)
		if err != nil || existed || run.EntryPoint != "mcp" || run.SkillVersionID != skill.CurrentVersionID {
			t.Fatalf("kind=%s run=%+v err=%v", kind, run, err)
		}
		replay, existed, err := svc.createRun(context.Background(), 42, dto)
		if err != nil || !existed || replay.ID != run.ID {
			t.Fatalf("replay created another run: %+v %v", replay, err)
		}
		dto.Input.Prompt = "changed"
		if _, _, err := svc.createRun(context.Background(), 42, dto); err == nil {
			t.Fatal("request ID accepted changed inputs")
		}
		dto.ClientRequestID += "-next"
		dto.MCP = false
		if _, _, err := svc.createRun(context.Background(), 42, dto); err == nil {
			t.Fatal("native caller enabled MCP through entryPoint")
		}
		dto.MCP = true
		if err := db.Model(&skill).Update("mcp_enabled", false).Error; err != nil {
			t.Fatal(err)
		}
		if _, _, err := svc.createRun(context.Background(), 42, dto); err == nil {
			t.Fatal("disabled skill accepted new run")
		}
	}
}

func TestMCPAdmissionRechecksExposureAfterInputValidation(t *testing.T) {
	for _, change := range []string{"mcp_enabled", "status", "current_version_id"} {
		t.Run(change, func(t *testing.T) {
			db := skillMCPTestDB(t)
			skill := addMCPSkill(t, db, "agent")
			changed := false
			// Deterministically model an admin closing/publishing after the first
			// availability check, but before admission writes its task transaction.
			if err := db.Callback().Query().After("gorm:query").Register("test:exposure_changed", func(tx *gorm.DB) {
				if changed || tx.Statement.Table != "skill_file" {
					return
				}
				changed = true
				var value any = false
				if change == "status" {
					value = 0
				}
				if change == "current_version_id" {
					value = skill.CurrentVersionID + 1
				}
				if err := db.Model(&model.Skill{}).Where("id = ?", skill.ID).Update(change, value).Error; err != nil {
					t.Fatal(err)
				}
			}); err != nil {
				t.Fatal(err)
			}
			svc := &service{db: db}
			_, _, err := svc.createRun(context.Background(), 42, CreateDTO{MCP: true, SkillID: skill.ID.String(), EntryPoint: "mcp", ClientRequestID: "mcp:closing", Input: RunInput{Prompt: "review"}})
			if !changed || err == nil {
				t.Fatalf("a stale exposure/version admitted a task: changed=%v err=%v", changed, err)
			}
			var count int64
			if err := db.Model(&model.SkillRun{}).Count(&count).Error; err != nil || count != 0 {
				t.Fatal("rejected admission persisted a task")
			}
			var current model.Skill
			if err := db.First(&current, "id = ?", skill.ID).Error; err != nil || current.UseCount != 0 {
				t.Fatal("rejected admission incremented usage")
			}
		})
	}
}

func TestMCPRetryCannotRaceAnExposureDisable(t *testing.T) {
	db := skillMCPTestDB(t)
	skill := addMCPSkill(t, db, "agent")
	run := model.SkillRun{UserID: 42, SkillID: skill.ID, SkillVersionID: skill.CurrentVersionID, EntryPoint: "mcp", Status: model.SkillRunFailed}
	if err := db.Create(&run).Error; err != nil {
		t.Fatal(err)
	}
	changed := false
	if err := db.Callback().Query().After("gorm:query").Register("test:disable_before_action", func(tx *gorm.DB) {
		if changed || tx.Statement.Table != "skill" {
			return
		}
		changed = true
		if err := db.Model(&model.Skill{}).Where("id = ?", skill.ID).Update("mcp_enabled", false).Error; err != nil {
			t.Fatal(err)
		}
	}); err != nil {
		t.Fatal(err)
	}
	svc := &service{db: db}
	revision := run.StateRevision
	err := svc.applyAction(context.Background(), &run, ActionDTO{Action: "retry", ClientRequestID: "retry-after-disable", ExpectedRevision: &revision})
	if !changed || err == nil {
		t.Fatalf("retry raced disable: changed=%v err=%v", changed, err)
	}
	var current model.SkillRun
	if err := db.First(&current, "id = ?", run.ID).Error; err != nil || current.Status != model.SkillRunFailed || current.StateRevision != revision {
		t.Fatal("disabled skill was requeued")
	}
	var count int64
	if err := db.Model(&model.SkillRunActionReceipt{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatal("rejected retry persisted a receipt")
	}
}

func TestMCPSkillAPIRequiresOwnKeyAndHidesPrivateExecution(t *testing.T) {
	db := skillMCPTestDB(t)
	keys, err := userkey.New(db, "skill-mcp-test-secret")
	if err != nil {
		t.Fatal(err)
	}
	credentials := map[idgen.ID]string{}
	for _, uid := range []idgen.ID{42, 43} {
		if err := db.Create(&model.User{ID: uid, Username: uid.String(), Email: uid.String() + "@test", Status: 1, Points: 100}).Error; err != nil {
			t.Fatal(err)
		}
		key, err := keys.Ensure(context.Background(), uid)
		if err != nil {
			t.Fatal(err)
		}
		credentials[uid], err = keys.Reveal(context.Background(), uid, key.Revision)
		if err != nil {
			t.Fatal(err)
		}
	}
	skill := addMCPSkill(t, db, "agent")
	svc := &service{db: db}
	run, _, err := svc.createRun(context.Background(), 42, CreateDTO{MCP: true, SkillID: skill.ID.String(), EntryPoint: "mcp", ClientRequestID: "mcp:test-1", Input: RunInput{Prompt: "user request"}})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(run).Updates(map[string]any{"status": model.SkillRunSucceeded, "progress": 100}).Error; err != nil {
		t.Fatal(err)
	}
	for _, artifact := range []model.SkillRunArtifact{
		{RunID: run.ID, Type: "text", Role: "intermediate", Text: "private-plan"},
		{RunID: run.ID, Type: "text", Role: "final", Text: "public result", IsFinal: true, Metadata: `{"secret":"private-metadata"}`},
	} {
		if err := db.Create(&artifact).Error; err != nil {
			t.Fatal(err)
		}
	}
	h := &handler{svc: svc}
	router := gin.New()
	h.registerMCPRoutes(router.Group("/api"), &app.Deps{DB: db, UserKeys: keys})
	base := "/api/open/v1/mcp/skills/" + skill.ID.String()
	request := func(method, path, key, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+key)
		req.Header.Set("Content-Type", "application/json")
		out := httptest.NewRecorder()
		router.ServeHTTP(out, req)
		return out
	}
	if request("GET", base, "invalid", "").Code != 401 {
		t.Fatal("invalid key accepted")
	}
	for _, path := range []string{base, base + "/runs/" + run.ID.String()} {
		out := request("GET", path, credentials[42], "")
		if out.Code != 200 || !strings.Contains(out.Body.String(), `"success":true`) || strings.Contains(out.Body.String(), "private-") {
			t.Fatalf("unsafe public response: %s", out.Body.String())
		}
	}
	for _, path := range []string{base + "/runs/" + run.ID.String(), "/api/open/v1/mcp/skills/999/runs/" + run.ID.String()} {
		out := request("GET", path, credentials[43], "")
		if !strings.Contains(out.Body.String(), `"code":404`) {
			t.Fatalf("foreign run exposed: %s", out.Body.String())
		}
	}
	out := request("POST", base+"/runs", credentials[42], `{"clientRequestId":"test-1","input":{"prompt":"user request"}}`)
	if !strings.Contains(out.Body.String(), `"success":true`) {
		t.Fatalf("replay failed: %s", out.Body.String())
	}
	var count int64
	db.Model(&model.SkillRun{}).Count(&count)
	if count != 1 {
		t.Fatalf("duplicate run count=%d", count)
	}
	if request("POST", base+"/runs", credentials[42], `{"clientRequestId":"test-1","userId":"43","input":{"prompt":"user request"}}`).Code != 400 {
		t.Fatal("caller-controlled owner accepted")
	}
	native, err := svc.toVO(run)
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(native)
	if strings.Contains(string(encoded), "private-") {
		t.Fatalf("native history leaks private content: %s", encoded)
	}
	if err := db.AutoMigrate(&model.AiTask{}); err != nil {
		t.Fatal(err)
	}
	queued, _, err := svc.createRun(context.Background(), 42, CreateDTO{MCP: true, SkillID: skill.ID.String(), EntryPoint: "mcp", ClientRequestID: "mcp:cancel-queued", Input: RunInput{Prompt: "queued request"}})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&skill).Update("mcp_enabled", false).Error; err != nil {
		t.Fatal(err)
	}
	ownerInfo := request("GET", base, credentials[42], "")
	if !strings.Contains(ownerInfo.Body.String(), `"enabled":false`) || strings.Contains(ownerInfo.Body.String(), "private-") {
		t.Fatalf("closed Skill owner metadata=%s", ownerInfo.Body.String())
	}
	if request("GET", base, credentials[43], "").Code != 404 {
		t.Fatal("closed skill revealed metadata to someone with no accepted run")
	}
	if !strings.Contains(request("POST", base+"/runs", credentials[42], `{"clientRequestId":"test-2","input":{"prompt":"user request"}}`).Body.String(), `"code":404`) {
		t.Fatal("disabled skill accepted")
	}
	if !strings.Contains(request("GET", base+"/runs/"+run.ID.String(), credentials[42], "").Body.String(), "public result") {
		t.Fatal("disabled skill lost accepted result")
	}
	for i := 0; i < 2; i++ {
		cancel := request("POST", base+"/runs/"+queued.ID.String()+"/actions", credentials[42], `{"action":"cancel","expectedRevision":0,"clientRequestId":"cancel-once"}`)
		if cancel.Code != 200 || !strings.Contains(cancel.Body.String(), `"status":"cancelled"`) {
			t.Fatalf("owner cannot cancel closed Skill task: %s", cancel.Body.String())
		}
	}
	var receipts int64
	if err := db.Model(&model.SkillRunActionReceipt{}).Where("run_id = ? AND client_request_id = ?", queued.ID, "cancel-once").Count(&receipts).Error; err != nil || receipts != 1 {
		t.Fatalf("cancel replay was not idempotent: %d %v", receipts, err)
	}
	retryClosed := request("POST", base+"/runs/"+queued.ID.String()+"/actions", credentials[42], `{"action":"retry","expectedRevision":1,"clientRequestId":"retry-closed"}`)
	if retryClosed.Code != 404 {
		t.Fatalf("closed Skill resumed: %s", retryClosed.Body.String())
	}
	settings := mcpconfig.Defaults()
	settings.Enabled = false
	if _, err := mcpconfig.Save(context.Background(), db, settings, 0); err != nil {
		t.Fatal(err)
	}
	if request("GET", base, credentials[42], "").Code != 403 {
		t.Fatal("global off ignored")
	}
}

func TestMCPPublicInputKeepsUserPromptAndRemovesPrivateDefaults(t *testing.T) {
	raw := `{"prompt":"user request","parameters":{"quality":"high","systemPrompt":"private-default"},"assets":[{"type":"image","url":"https://cdn.test/image.png"}]}`
	got := string(mcpPublicGenerationInput(raw))
	if strings.Contains(got, "private-") || !strings.Contains(got, "user request") || !strings.Contains(got, "https://cdn.test/image.png") {
		t.Fatal(got)
	}
}

func TestMCPRejectsMalformedSavedSkillBeforeCreatingRun(t *testing.T) {
	db := skillMCPTestDB(t)
	skill := addMCPSkill(t, db, "agent")
	if err := db.Model(&model.SkillFile{}).Where("skill_version_id = ?", skill.CurrentVersionID).Update("content", "This is not a standard Skill").Error; err != nil {
		t.Fatal(err)
	}
	svc := &service{db: db}
	if run, _, err := svc.createRun(context.Background(), 42, CreateDTO{MCP: true, EntryPoint: "mcp", SkillID: skill.ID.String(), ClientRequestID: "bad-format", Input: RunInput{Prompt: "run"}}); err == nil || run != nil || !strings.Contains(err.Error(), "格式校验") {
		t.Fatalf("invalid saved Skill accepted: %+v %v", run, err)
	}
	h := &handler{svc: svc}
	out := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(out)
	c.Request = httptest.NewRequest("GET", "/skill", nil)
	c.Params = gin.Params{{Key: "skillId", Value: skill.ID.String()}}
	h.mcpSkill(c)
	if out.Code != 400 || !strings.Contains(out.Body.String(), "格式校验") {
		t.Fatal(out.Body.String())
	}
	var count int64
	db.Model(&model.SkillRun{}).Count(&count)
	if count != 0 {
		t.Fatal("invalid skill created a run")
	}
}

func TestMCPApprovalDoesNotDiscloseInternalPlanningArtifacts(t *testing.T) {
	for _, test := range []struct {
		name, role       string
		promote, visible bool
	}{
		{"internal planning", "intermediate", false, false},
		{"explicit draft", "draft", false, true},
		{"promoted draft", "intermediate", true, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			db := skillMCPTestDB(t)
			skill := addMCPSkill(t, db, "agent")
			manifest, _ := json.Marshal(agentManifest{Steps: []agentStep{{Key: "draft", Type: "text", OutputRole: test.role}, {Key: "approve", Type: "approval", PromotePrevious: test.promote}}})
			if err := db.Model(&model.SkillVersion{}).Where("id = ?", skill.CurrentVersionID).Update("manifest_json", string(manifest)).Error; err != nil {
				t.Fatal(err)
			}
			run := model.SkillRun{UserID: 42, SkillID: skill.ID, SkillVersionID: skill.CurrentVersionID, EntryPoint: "mcp", Status: model.SkillRunWaitingConfirmation, CurrentStep: "approve", PendingAction: `{"type":"confirmation","message":"Review the result"}`}
			if err := db.Create(&run).Error; err != nil {
				t.Fatal(err)
			}
			prior := model.SkillRunStep{RunID: run.ID, StepKey: "draft", Sequence: 0, Type: "text", Status: model.SkillStepSucceeded}
			waiting := model.SkillRunStep{RunID: run.ID, StepKey: "approve", Sequence: 1, Type: "approval", Status: model.SkillStepWaiting}
			for _, step := range []*model.SkillRunStep{&prior, &waiting} {
				if err := db.Create(step).Error; err != nil {
					t.Fatal(err)
				}
			}
			for _, artifact := range []model.SkillRunArtifact{
				{RunID: run.ID, StepID: prior.ID, Role: test.role, Type: "text", Text: "preceding-step-content"},
				{RunID: run.ID, Role: "final", Type: "text", IsFinal: true, Text: "owned-final"},
				{RunID: run.ID + 1, Role: "final", Type: "text", IsFinal: true, Text: "foreign-final"},
			} {
				if err := db.Create(&artifact).Error; err != nil {
					t.Fatal(err)
				}
			}
			// Publishing another version must not change the old run's disclosure policy.
			newVersion := model.SkillVersion{SkillID: skill.ID, Version: 2, Kind: "agent", Status: model.SkillVersionPublished, ManifestJSON: `{"steps":[]}`}
			if err := db.Create(&newVersion).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.Model(&skill).Update("current_version_id", newVersion.ID).Error; err != nil {
				t.Fatal(err)
			}
			out := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(out)
			c.Request = httptest.NewRequest("GET", "/run", nil)
			(&handler{svc: &service{db: db}}).writeMCPRun(c, &run)
			body := out.Body.String()
			if out.Code != 200 || strings.Contains(body, "preceding-step-content") != test.visible || !strings.Contains(body, "owned-final") || strings.Contains(body, "foreign-final") {
				t.Fatalf("unexpected artifact visibility: %s", body)
			}
		})
	}
}
