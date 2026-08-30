package admin

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"tidecanvas/internal/app"
	"tidecanvas/internal/middleware"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

var testHosts = []string{"cdn.example.com", "bucket.oss-cn-shanghai.aliyuncs.com"}

func TestGenerationDetailOmitsEmptyRawBodies(t *testing.T) {
	body, err := json.Marshal(GenerationDetailVO{})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(body), "requestBody") || strings.Contains(string(body), "responseBody") {
		t.Fatalf("empty raw bodies must be omitted from non-admin JSON: %s", body)
	}
}

func TestRefundGenerationIsAdminOnlyAndExactlyOnce(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:g7_generation_refund?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("get sql db: %v", err)
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.User{}, &model.AiTask{}, &model.AiGenerationLog{}, &model.ModelCallLog{}, &model.PointRecord{}, &model.PointRefundReceipt{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	const userID idgen.ID = 7101
	const adminID idgen.ID = 7102
	const taskID idgen.ID = 7103
	const logID idgen.ID = 7104
	now := time.Now()
	if err := db.Create(&model.User{ID: userID, Username: "refund-target", Email: "refund-target@example.test", Points: 100, Status: 1}).Error; err != nil {
		t.Fatalf("create target: %v", err)
	}
	if err := db.Create(&model.User{ID: adminID, Username: "refund-admin", Email: "refund-admin@example.test", Role: middleware.AdminRole, Status: 1}).Error; err != nil {
		t.Fatalf("create admin: %v", err)
	}
	if err := db.Create(&model.AiTask{ID: taskID, UserID: userID, Status: 1, PointCost: 12, Refunded: true, CreateTime: now}).Error; err != nil {
		t.Fatalf("create task: %v", err)
	}
	if err := db.Create(&model.AiGenerationLog{ID: 7105, TaskID: taskID, UserID: userID, UpstreamTaskID: "remote-refund-1", CreateTime: now}).Error; err != nil {
		t.Fatalf("create generation log: %v", err)
	}
	if err := db.Create(&model.ModelCallLog{BaseModel: model.BaseModel{ID: logID, CreateTime: now}, UserID: userID, Scene: "image", Model: "model-a", Success: 1, PointCost: 12, Refunded: true, UpstreamTaskID: "remote-refund-1"}).Error; err != nil {
		t.Fatalf("create call log: %v", err)
	}
	var markerRecord model.ModelCallLog
	if err := db.First(&markerRecord, "id = ?", logID).Error; err != nil {
		t.Fatalf("load marker record: %v", err)
	}
	if generationRefundedForRecord(db, &markerRecord) {
		t.Fatal("settled marker without receipt/ledger was misreported as refunded")
	}

	// An operator token must not be able to invoke the refund action.
	operatorRecorder := httptest.NewRecorder()
	operatorCtx, _ := gin.CreateTestContext(operatorRecorder)
	operatorCtx.Set(middleware.CtxUserID, userID)
	operatorCtx.Set(middleware.CtxRole, 0)
	operatorCtx.Params = gin.Params{{Key: "id", Value: logID.String()}}
	refundGeneration(operatorCtx, &app.Deps{DB: db})
	if operatorRecorder.Code != 403 {
		t.Fatalf("operator status = %d, want 403", operatorRecorder.Code)
	}

	gin.SetMode(gin.TestMode)
	// A legacy synchronous row with no billing ref/upstream task is deliberately
	// not refundable: its amount alone cannot prove which debit to reverse.
	const unlinkedLogID idgen.ID = 7106
	if err := db.Create(&model.ModelCallLog{BaseModel: model.BaseModel{ID: unlinkedLogID, CreateTime: now}, UserID: userID, Scene: "chat", Model: "legacy-text", Success: 1, PointCost: 9}).Error; err != nil {
		t.Fatalf("create unlinked call log: %v", err)
	}
	unlinkedRecorder := httptest.NewRecorder()
	unlinkedCtx, _ := gin.CreateTestContext(unlinkedRecorder)
	unlinkedCtx.Set(middleware.CtxUserID, adminID)
	unlinkedCtx.Set(middleware.CtxRole, middleware.AdminRole)
	unlinkedCtx.Params = gin.Params{{Key: "id", Value: unlinkedLogID.String()}}
	refundGeneration(unlinkedCtx, &app.Deps{DB: db})
	if unlinkedRecorder.Code != 409 {
		t.Fatalf("unlinked legacy refund status = %d, want 409; body=%s", unlinkedRecorder.Code, unlinkedRecorder.Body.String())
	}

	call := func(recordID idgen.ID) *httptest.ResponseRecorder {
		recorder := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(recorder)
		ctx.Set(middleware.CtxUserID, adminID)
		ctx.Set(middleware.CtxRole, middleware.AdminRole)
		ctx.Params = gin.Params{{Key: "id", Value: recordID.String()}}
		refundGeneration(ctx, &app.Deps{DB: db})
		return recorder
	}
	first := call(logID)
	if first.Code != 200 {
		t.Fatalf("first refund status = %d, body=%s", first.Code, first.Body.String())
	}
	second := call(logID)
	if second.Code != 200 {
		t.Fatalf("idempotent refund status = %d, body=%s", second.Code, second.Body.String())
	}

	var user model.User
	if err := db.First(&user, "id = ?", userID).Error; err != nil {
		t.Fatalf("load target: %v", err)
	}
	if user.Points != 112 {
		t.Fatalf("target points = %d, want 112", user.Points)
	}
	var task model.AiTask
	if err := db.First(&task, "id = ?", taskID).Error; err != nil {
		t.Fatalf("load task: %v", err)
	}
	if !task.Refunded {
		t.Fatal("task was not marked refunded")
	}
	var record model.ModelCallLog
	if err := db.First(&record, "id = ?", logID).Error; err != nil {
		t.Fatalf("load call log: %v", err)
	}
	if !record.Refunded {
		t.Fatal("call log was not marked refunded")
	}
	var ledgerCount, receiptCount int64
	if err := db.Model(&model.PointRecord{}).Where("user_id = ? AND change_type = ? AND amount = ?", userID, "refund", 12).Count(&ledgerCount).Error; err != nil {
		t.Fatalf("count refund ledger: %v", err)
	}
	if err := db.Model(&model.PointRefundReceipt{}).Where("ref_id = ?", taskID).Count(&receiptCount).Error; err != nil {
		t.Fatalf("count refund receipt: %v", err)
	}
	if ledgerCount != 1 || receiptCount != 1 {
		t.Fatalf("refund counts = ledger %d receipt %d, want 1/1", ledgerCount, receiptCount)
	}

	// New synchronous text calls carry a standalone billing ref even though no
	// AiTask exists; that exact debit can be safely refunded too.
	const syncLogID idgen.ID = 7107
	const syncBillingRef idgen.ID = 7108
	if err := db.Create(&model.ModelCallLog{BaseModel: model.BaseModel{ID: syncLogID, CreateTime: now}, UserID: userID, Scene: "chat", Model: "text-model", Success: 1, PointCost: 7, BillingRefID: syncBillingRef}).Error; err != nil {
		t.Fatalf("create sync call log: %v", err)
	}
	if recorder := call(syncLogID); recorder.Code != 200 {
		t.Fatalf("sync refund status = %d, body=%s", recorder.Code, recorder.Body.String())
	}
	if err := db.First(&user, "id = ?", userID).Error; err != nil {
		t.Fatalf("reload target after sync refund: %v", err)
	}
	if user.Points != 119 {
		t.Fatalf("target points after sync refund = %d, want 119", user.Points)
	}
	var syncLedger int64
	if err := db.Model(&model.PointRecord{}).Where("user_id = ? AND change_type = ? AND amount = ? AND ref_id = ?", userID, "refund", 7, syncBillingRef).Count(&syncLedger).Error; err != nil {
		t.Fatalf("count sync refund ledger: %v", err)
	}
	if syncLedger != 1 {
		t.Fatalf("sync refund ledger count = %d, want 1", syncLedger)
	}
}

// chat 落库的是顶层 messages 数组,当前轮 user 挂 image_url + file 附件。
func TestParseRequestChatWithAttachments(t *testing.T) {
	body := `[
		{"role":"system","content":"你是助手"},
		{"role":"user","content":"之前的问题"},
		{"role":"user","content":[
			{"type":"text","text":"总结这两个附件"},
			{"type":"image_url","image_url":{"url":"https://cdn.example.com/canvas/uploads/pic.png"}},
			{"type":"file","file":{"filename":"报告.pdf","file_data":"data:…(base64 omitted, 12345 bytes)"}}
		]}
	]`
	got := parseRequestBody(body, testHosts)
	if got.Prompt != "总结这两个附件" {
		t.Errorf("prompt: %q", got.Prompt)
	}
	if len(got.Inputs) != 2 {
		t.Fatalf("inputs: %+v", got.Inputs)
	}
	if got.Inputs[0].Kind != "image" || got.Inputs[0].URL == "" {
		t.Errorf("image input: %+v", got.Inputs[0])
	}
	if got.Inputs[1].Kind != "file" || got.Inputs[1].Name != "报告.pdf" {
		t.Errorf("file input: %+v", got.Inputs[1])
	}
}

// 生成类请求:prompt 主字段、标量参数进网格、参考图进输入素材。
func TestParseRequestGeneration(t *testing.T) {
	body := `{
		"model":"seedance-2.0","prompt":"西部荒原,骑马的人","duration":12,"ratio":"16:9",
		"resolution":"720p","face_grid":false,"stream":true,"api_key":"sk-secret",
		"images":["https://bucket.oss-cn-shanghai.aliyuncs.com/canvas/uploads/ref.jpg"]
	}`
	got := parseRequestBody(body, testHosts)
	if got.Prompt != "西部荒原,骑马的人" {
		t.Errorf("prompt: %q", got.Prompt)
	}
	params := map[string]string{}
	for _, p := range got.Params {
		params[p.Key] = p.Value
	}
	if params["ratio"] != "16:9" || params["duration"] != "12" || params["resolution"] != "720p" || params["face_grid"] != "false" {
		t.Errorf("params: %+v", got.Params)
	}
	if _, denied := params["api_key"]; denied {
		t.Errorf("api_key must not leak into params")
	}
	if _, denied := params["prompt"]; denied {
		t.Errorf("prompt must not duplicate into params")
	}
	if len(got.Inputs) != 1 || got.Inputs[0].Kind != "image" {
		t.Errorf("inputs: %+v", got.Inputs)
	}
}

func TestParseRequestSeparatesImageVideoAndAudioInputs(t *testing.T) {
	body := `{
		"prompt":"多模态参考",
		"references":["https://cdn.example.com/ref.avif"],
		"videoReferences":["https://cdn.example.com/ref.mp4?token=x"],
		"audioReferences":["https://cdn.example.com/ref.aac", "https://cdn.example.com/ref.flac"]
	}`
	got := parseRequestBody(body, testHosts)
	if len(got.Inputs) != 4 {
		t.Fatalf("inputs: %+v", got.Inputs)
	}
	counts := map[string]int{}
	for _, input := range got.Inputs {
		counts[input.Kind]++
	}
	if counts["image"] != 1 || counts["video"] != 1 || counts["audio"] != 2 {
		t.Fatalf("input kind counts = %+v; inputs=%+v", counts, got.Inputs)
	}
}

func TestParseRequestUsesFieldAndPathForExtensionlessMedia(t *testing.T) {
	body := `{
		"image_urls":["https://media.external.test/opaque-image?id=1"],
		"video_urls":["https://media.external.test/opaque-video?id=2"],
		"audio_urls":["https://media.external.test/opaque-audio?id=3"],
		"legacy":"https://cdn.example.com/canvas/uploads/video/opaque-id"
	}`
	got := parseRequestBody(body, testHosts)
	counts := map[string]int{}
	for _, input := range got.Inputs {
		counts[input.Kind]++
	}
	if len(got.Inputs) != 4 || counts["image"] != 1 || counts["video"] != 2 || counts["audio"] != 1 {
		t.Fatalf("extensionless inputs classified incorrectly: counts=%+v inputs=%+v", counts, got.Inputs)
	}
}

func TestParseRequestUsesAssetObjectMetadataForOpaqueURL(t *testing.T) {
	body := `{"references":[
		{"url":"https://media.external.test/opaque-1","kind":"video","name":"clip"},
		{"url":"https://media.external.test/opaque-2","mimeType":"audio/mpeg","name":"voice"}
	]}`
	got := parseRequestBody(body, testHosts)
	counts := map[string]int{}
	for _, input := range got.Inputs {
		counts[input.Kind]++
	}
	if len(got.Inputs) != 2 || counts["video"] != 1 || counts["audio"] != 1 {
		t.Fatalf("object metadata ignored: counts=%+v inputs=%+v", counts, got.Inputs)
	}
}

func TestParseRequestDoesNotApplyTopLevelTypeToUnrelatedURL(t *testing.T) {
	got := parseRequestBody(`{
		"type":"video",
		"callback":"https://external.example.test/callback/opaque"
	}`, testHosts)
	if len(got.Inputs) != 0 {
		t.Fatalf("unrelated callback leaked into input assets: %+v", got.Inputs)
	}
}

// eventlog 截断的请求体(非法 JSON)退回正则提取。
func TestParseRequestTruncated(t *testing.T) {
	body := `[{"role":"user","content":[{"type":"text","text":"分析这份文件"},` +
		`{"type":"file","file":{"filename":"数据表.xlsx","file_data":"data:application/vnd;base64,AAAA` +
		"…(truncated)"
	got := parseRequestBody(body, testHosts)
	if got.Prompt != "分析这份文件" {
		t.Errorf("prompt: %q", got.Prompt)
	}
	found := false
	for _, a := range got.Inputs {
		if a.Kind == "file" && a.Name == "数据表.xlsx" {
			found = true
		}
	}
	if !found {
		t.Errorf("truncated file attachment must survive: %+v", got.Inputs)
	}
}

// 文本场景的响应是裸文本回复,不是 JSON。
func TestParseResponsePlainReply(t *testing.T) {
	got := parseResponseBody("chat", "这是助手的回复内容。", testHosts)
	if got.Reply != "这是助手的回复内容。" {
		t.Errorf("reply: %q", got.Reply)
	}
	if len(got.Results) != 0 {
		t.Errorf("results should be empty: %+v", got.Results)
	}
}

// OpenAI 形态响应:choices[0].message.content → Reply。
func TestParseResponseChoicesReply(t *testing.T) {
	body := `{"choices":[{"message":{"role":"assistant","content":"优化后的提示词"}}],"usage":{}}`
	got := parseResponseBody("optimize", body, testHosts)
	if got.Reply != "优化后的提示词" {
		t.Errorf("reply: %q", got.Reply)
	}
}

// 生成类响应:任意嵌套里的媒体 URL → Results。
func TestParseResponseMediaURL(t *testing.T) {
	body := `{"data":[{"url":"https://cdn.example.com/canvas/uploads/out.mp4","b64":null}]}`
	got := parseResponseBody("video", body, testHosts)
	if len(got.Results) != 1 || got.Results[0].Kind != "video" {
		t.Errorf("results: %+v", got.Results)
	}
}

// 本站 CDN/签名播放地址可能没有 .mp3 后缀，结果类型应以生成场景兜底，
// 否则管理端会把音频 URL 塞进 <img> 而不是 <audio>。
func TestParseResponseExtensionlessAudioURL(t *testing.T) {
	body := `{"data":[{"url":"https://cdn.example.com/canvas/uploads/gen/playback?id=audio-1"}]}`
	got := parseResponseBody("audio", body, testHosts)
	if len(got.Results) != 1 || got.Results[0].Kind != "audio" {
		t.Fatalf("results: %+v", got.Results)
	}
}

func TestResultKindPrefersExplicitExtensionOverScene(t *testing.T) {
	if got := resultKindForURL("audio", "https://cdn.example.com/cover.jpeg"); got != "image" {
		t.Fatalf("kind = %q, want image", got)
	}
	if got := resultKindForURL("audio", "https://cdn.example.com/play?id=1"); got != "audio" {
		t.Fatalf("kind = %q, want audio", got)
	}
}

func TestResolveUpstreamResultUsesAudioKindForExtensionlessTracks(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:g7_audio_preview?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("get sql db: %v", err)
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.AiTask{}, &model.AiGenerationLog{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	const taskID idgen.ID = 7201
	if err := db.Create(&model.AiTask{
		ID:         taskID,
		ResultUrl:  "https://cdn.example.com/canvas/uploads/gen/play?id=audio-main",
		ResultMeta: `{"urls":["https://cdn.example.com/canvas/uploads/gen/play?id=audio-track"],"tracks":[{"url":"https://cdn.example.com/canvas/uploads/gen/play?id=audio-track","title":"测试曲目"}]}`,
		CreateTime: time.Now(),
	}).Error; err != nil {
		t.Fatalf("create task: %v", err)
	}
	if err := db.Create(&model.AiGenerationLog{
		ID: 7202, TaskID: taskID, UpstreamTaskID: "up-audio-preview", CreateTime: time.Now(),
	}).Error; err != nil {
		t.Fatalf("create generation log: %v", err)
	}

	got := resolveUpstreamResult(db, "up-audio-preview", "audio")
	if len(got) != 2 {
		t.Fatalf("results: %+v", got)
	}
	if got[0].Name != "测试曲目" {
		t.Fatalf("track title was lost during URL de-duplication: %+v", got)
	}
	for _, asset := range got {
		if asset.Kind != "audio" {
			t.Fatalf("asset kind = %q, want audio: %+v", asset.Kind, asset)
		}
	}
}

// 生成类响应截断行:正则兜底媒体 URL。
func TestParseResponseTruncatedMedia(t *testing.T) {
	body := `{"data":[{"url":"https://cdn.example.com/canvas/uploads/out.png","revised_prompt":"很长的描…(truncated)`
	got := parseResponseBody("image", body, testHosts)
	if len(got.Results) != 1 || !strings.HasSuffix(got.Results[0].URL, "out.png") {
		t.Errorf("results: %+v", got.Results)
	}
}
