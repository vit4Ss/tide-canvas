package admin

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"tidecanvas/internal/app"
	"tidecanvas/internal/handler/studiotemplate"
	"tidecanvas/internal/middleware"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

func TestStudioTemplatesPublicationImportAndPermissions(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	pool, _ := db.DB()
	pool.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = pool.Close() })
	if err := db.AutoMigrate(&model.StudioTemplate{}, &model.AiTask{}, &model.MarketModel{}); err != nil {
		t.Fatal(err)
	}
	for _, row := range []model.MarketModel{
		{BaseModel: model.BaseModel{ID: 501}, ModelKey: "image-test", Name: "Image display name", Type: "image", Status: 1, Config: `{"modes":["i2i"],"ratios":["1:1"],"resolutions":["2k"]}`},
		{BaseModel: model.BaseModel{ID: 502}, ModelKey: "video-test", Name: "Video display name", Type: "video", Status: 1, Config: `{"modes":["omni_ref"],"durations":["5s"]}`},
	} {
		if err := db.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
	}
	r := gin.New()
	admin := r.Group("/admin", func(c *gin.Context) {
		if c.GetHeader("test-admin") == "yes" {
			c.Set(middleware.CtxRole, 9)
		}
		c.Set(middleware.CtxAdminPerms, map[string]bool{"admin.inspiration": true})
	})
	RegisterStudioTemplates(admin, &app.Deps{DB: db})
	pub := &studiotemplate.Handler{DB: db}
	r.GET("/public", pub.List(false))
	r.GET("/public/:id", pub.Get)
	call := func(method, path, body string, isAdmin bool) map[string]any {
		t.Helper()
		w := httptest.NewRecorder()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if isAdmin {
			req.Header.Set("test-admin", "yes")
		}
		r.ServeHTTP(w, req)
		var data map[string]any
		if err := json.Unmarshal(w.Body.Bytes(), &data); err != nil {
			t.Fatal(w.Body.String())
		}
		return data
	}
	body := `{"kind":"style","mediaType":"image","title":"Clay","prompt":"clay style","mode":"i2i","coverUrl":"https://cdn.example.test/cover.png","requirements":{"images":1},"options":{"aspectRatio":"1:1"},"status":0,"category":"Portrait"}`
	draft := call("POST", "/admin/studio-templates", body, true)
	if draft["success"] != true {
		t.Fatal(draft)
	}
	id := draft["data"].(map[string]any)["id"].(string)
	list := call("GET", "/public?kind=style&mediaType=image", "", false)
	if list["data"].(map[string]any)["total"] != float64(0) {
		t.Fatal("draft leaked")
	}
	if call("GET", "/public/"+id, "", false)["code"] != float64(404) {
		t.Fatal("draft accessible by id")
	}
	published := strings.Replace(body, `"status":0`, `"status":1`, 1)
	if result := call("PUT", "/admin/studio-templates/"+id, published, true); result["success"] != true {
		t.Fatal(result)
	}
	var pinned model.StudioTemplate
	if err := db.First(&pinned, "id = ?", id).Error; err != nil {
		t.Fatal(err)
	}
	if pinned.ModelKey != "image-test" || pinned.Options.Resolution != "2k" {
		t.Fatalf("publication did not pin recipe: %+v", pinned)
	}
	unsupported := strings.Replace(published, `"aspectRatio":"1:1"`, `"aspectRatio":"16:9"`, 1)
	if result := call("POST", "/admin/studio-templates", unsupported, true); result["success"] == true {
		t.Fatal("unsupported recipe published")
	}
	if result := call("POST", "/admin/studio-templates/check", body, true); result["success"] != true {
		t.Fatal(result)
	}
	emptyDraft := strings.Replace(body, `"prompt":"clay style"`, `"prompt":""`, 1)
	if result := call("POST", "/admin/studio-templates", emptyDraft, true); result["success"] != true {
		t.Fatal("incomplete draft could not be saved", result)
	}
	if result := call("POST", "/admin/studio-templates", strings.Replace(emptyDraft, `"status":0`, `"status":1`, 1), true); result["success"] == true {
		t.Fatal("empty recipe published")
	}
	list = call("GET", "/public?kind=style&mediaType=image", "", false)
	if list["data"].(map[string]any)["total"] != float64(1) {
		t.Fatal("publication not visible")
	}
	// Actual accepted generation increments uses; admin edits must preserve it.
	if err := db.Model(&model.StudioTemplate{}).Where("id = ?", id).UpdateColumn("uses", 1).Error; err != nil {
		t.Fatal(err)
	}
	if _, exposed := list["data"].(map[string]any)["records"].([]any)[0].(map[string]any)["prompt"]; exposed {
		t.Fatal("public template leaked prompt")
	}
	// Downlisting must write zero and preserve the real counter.
	if result := call("PUT", "/admin/studio-templates/"+id, body, true); result["success"] != true {
		t.Fatal(result)
	}
	var saved model.StudioTemplate
	if err := db.First(&saved, "id = ?", id).Error; err != nil {
		t.Fatal(err)
	}
	if saved.Status != 0 || saved.Uses != 1 || saved.Requirements.Images != 1 || saved.Options.AspectRatio != "1:1" {
		t.Fatalf("save lost typed fields/counter: %+v", saved)
	}
	invalid := strings.Replace(published, `https://cdn.example.test/cover.png`, `javascript:alert(1)`, 1)
	if call("POST", "/admin/studio-templates", invalid, true)["code"] != float64(400) {
		t.Fatal("unsafe media accepted")
	}
	video := strings.ReplaceAll(strings.ReplaceAll(published, `"mediaType":"image"`, `"mediaType":"video"`), `"mode":"i2i"`, `"mode":"i2v"`)
	if call("POST", "/admin/studio-templates", video, true)["code"] != float64(400) {
		t.Fatal("published video without preview")
	}
	if call("GET", "/admin/studio-templates/sources", "", false)["code"] != float64(403) {
		t.Fatal("curator without generation access could read private outputs")
	}
	task := model.AiTask{ID: idgen.Next(), UserID: idgen.Next(), Status: 1, Handler: "reference_to_video", Origin: "direct", ModelID: 502, ModelName: "Video display name", ResultUrl: "https://cdn.example.test/movie.mp4", Input: `{"prompt":"cinematic product shot","videoReferences":["https://private.example.test/customer.mp4"],"audioReferences":["https://private.example.test/sound.mp3"],"secret":"private-value","duration":5}`}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	importBody := `{"taskId":"` + task.ID.String() + `"}`
	if call("POST", "/admin/studio-templates/from-task", importBody, false)["code"] != float64(403) {
		t.Fatal("unauthorized import")
	}
	first := call("POST", "/admin/studio-templates/from-task", importBody, true)
	second := call("POST", "/admin/studio-templates/from-task", importBody, true)
	if first["success"] != true || second["success"] != true {
		t.Fatal(first, second)
	}
	row := first["data"].(map[string]any)
	if row["id"] != second["data"].(map[string]any)["id"] || row["status"] != float64(0) || row["kind"] != "inspiration" || row["mediaType"] != "video" {
		t.Fatal("import not draft/idempotent")
	}
	if row["modelKey"] != "video-test" {
		t.Fatalf("import used display name as model key: %v", row["modelKey"])
	}
	encoded, _ := json.Marshal(row)
	for _, secret := range []string{"private.example", "private-value", "sourceKey", "userId", "taskId"} {
		if strings.Contains(string(encoded), secret) {
			t.Fatalf("private source leaked: %s", encoded)
		}
	}
	req := row["requirements"].(map[string]any)
	if req["images"] != float64(0) || req["videos"] != float64(1) || req["audio"] != float64(1) {
		t.Fatalf("wrong source requirements: %v", req)
	}
	if call("GET", "/public/"+row["id"].(string), "", false)["code"] != float64(404) {
		t.Fatal("import auto-published")
	}
	if result := call("DELETE", "/admin/studio-templates/"+row["id"].(string), "", true); result["success"] != true {
		t.Fatal(result)
	}
	reimport := call("POST", "/admin/studio-templates/from-task", importBody, true)
	if reimport["success"] != true {
		t.Fatalf("deleted inspiration cannot be imported again: %v", reimport)
	}
	reimported := reimport["data"].(map[string]any)
	if reimported["id"] == row["id"] || reimported["status"] != float64(0) {
		t.Fatal("reimport did not create a fresh draft")
	}
	retryImport := call("POST", "/admin/studio-templates/from-task", importBody, true)
	if retryImport["data"].(map[string]any)["id"] != reimported["id"] {
		t.Fatal("reimport retry duplicated the draft")
	}
	for _, input := range []string{
		`{"prompt":"needs 17 images","imageUrls":["1","2","3","4","5","6","7","8","9","10","11","12","13","14","15","16","17"]}`,
		`{"prompt":"needs all four audio tracks","audio_urls":["a","b","c","d"]}`,
	} {
		source := task
		source.ID = idgen.Next()
		source.Input = input
		if err := db.Create(&source).Error; err != nil {
			t.Fatal(err)
		}
		result := call("POST", "/admin/studio-templates/from-task", `{"taskId":"`+source.ID.String()+`"}`, true)
		if result["success"] == true {
			t.Fatalf("import silently changed source recipe: %s", input)
		}
	}
	for _, duration := range []string{`4.5`, `"4.5s"`} {
		source := task
		source.ID = idgen.Next()
		source.Input = `{"prompt":"fractional clip","duration":` + duration + `}`
		if err := db.Create(&source).Error; err != nil {
			t.Fatal(err)
		}
		result := call("POST", "/admin/studio-templates/from-task", `{"taskId":"`+source.ID.String()+`"}`, true)
		if result["success"] != true {
			t.Fatal(result)
		}
		options := result["data"].(map[string]any)["options"].(map[string]any)
		if options["duration"] != 4.5 {
			t.Fatal("import lost actual duration", options)
		}
	}
	if result := call("DELETE", "/admin/studio-templates/"+id, "", true); result["success"] != true {
		t.Fatal(result)
	}
	if call("GET", "/public/"+id, "", false)["code"] != float64(404) {
		t.Fatal("deleted template visible")
	}
	if err := studiotemplate.SeedSamples(db); err != nil {
		t.Fatal(err)
	}
	var sample model.StudioTemplate
	if err := db.Where("source_key = ?", studiotemplate.SampleSourcePrefix+"clay-adventure").First(&sample).Error; err != nil {
		t.Fatal(err)
	}
	if result := call("DELETE", "/admin/studio-templates/"+sample.ID.String(), "", true); result["success"] != true {
		t.Fatal(result)
	}
	if err := studiotemplate.SeedSamples(db); err != nil {
		t.Fatal(err)
	}
	var count int64
	db.Model(&model.StudioTemplate{}).Where("source_key = ?", sample.SourceKey).Count(&count)
	if count != 0 {
		t.Fatal("admin-deleted built-in example reappeared after restart")
	}
}
