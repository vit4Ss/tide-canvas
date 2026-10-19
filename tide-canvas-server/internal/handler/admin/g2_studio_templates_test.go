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
	if err := db.AutoMigrate(&model.StudioTemplate{}, &model.AiTask{}); err != nil {
		t.Fatal(err)
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
	r.POST("/public/:id/use", pub.Use)
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
	if call("POST", "/public/"+id+"/use", "", false)["code"] != float64(404) {
		t.Fatal("draft use counter accepted")
	}
	published := strings.Replace(body, `"status":0`, `"status":1`, 1)
	if result := call("PUT", "/admin/studio-templates/"+id, published, true); result["success"] != true {
		t.Fatal(result)
	}
	list = call("GET", "/public?kind=style&mediaType=image", "", false)
	if list["data"].(map[string]any)["total"] != float64(1) {
		t.Fatal("publication not visible")
	}
	if call("POST", "/public/"+id+"/use", "", false)["success"] != true {
		t.Fatal("use failed")
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
	task := model.AiTask{ID: idgen.Next(), UserID: idgen.Next(), Status: 1, Handler: "reference_to_video", Origin: "direct", ModelName: "video-test", ResultUrl: "https://cdn.example.test/movie.mp4", Input: `{"prompt":"cinematic product shot","videoReferences":["https://private.example.test/customer.mp4"],"audioReferences":["https://private.example.test/sound.mp3"],"secret":"private-value","duration":5}`}
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
