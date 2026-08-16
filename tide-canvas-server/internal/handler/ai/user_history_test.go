package ai

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

func TestUserHistorySummaryIsAnExplicitAllowlist(t *testing.T) {
	now := time.Date(2026, 8, 12, 12, 0, 0, 0, time.Local)
	log := &model.AiGenerationLog{
		ID: 11, TaskID: 22, UserID: 33, ProjectID: 44,
		HandlerName: "reference_to_video", OperationType: "video", Model: "Video Model",
		InputParams: `{"prompt":"用户提示词","systemPrompt":"internal-secret"}`,
		RequestUrl:  "https://relay.internal/v1/generate", RequestBody: "raw-request-secret",
		ResponseBody: "raw-response-secret", UpstreamTaskID: "upstream-secret",
		HttpStatus: 502, ErrorMsg: "provider-secret", Cost: "0.42", Success: 1,
		ResultUrl: "https://cdn.example.com/result.mp4", DurationMs: 1200, CreateTime: now,
	}
	vo := toUserHistoryVO(log, &taskLogState{Status: statusSuccess, PointCost: 8})
	payload, err := json.Marshal(vo)
	if err != nil {
		t.Fatal(err)
	}
	lower := strings.ToLower(string(payload))
	for _, forbidden := range []string{
		"taskid", "userid", "projectid", "handler", "operation", "request", "response",
		"httpstatus", "upstream", "errormsg", "relay.internal", "provider-secret",
		"raw-request-secret", "raw-response-secret", "internal-secret",
	} {
		if strings.Contains(lower, strings.ToLower(forbidden)) {
			t.Fatalf("public summary leaked %q: %s", forbidden, payload)
		}
	}
}

func TestUserHistoryDetailDropsTaskAndAuditInternals(t *testing.T) {
	complete := time.Date(2026, 8, 12, 12, 1, 0, 0, time.Local)
	log := &model.AiGenerationLog{
		ID: 11, TaskID: 22, UserID: 33, ProjectID: 44,
		HandlerName: "reference_to_video", OperationType: "video", Model: "Video Model",
		InputParams: `{"prompt":"列表提示词"}`,
		RequestUrl:  "https://relay.internal/v1/generate", RequestBody: "raw-request-secret",
		ResponseBody: "raw-response-secret", UpstreamTaskID: "upstream-secret",
		HttpStatus: 500, ErrorMsg: "provider-secret", Cost: "0.42", Success: 0,
		DurationMs: 2400, CreateTime: complete.Add(-time.Minute),
	}
	task := &model.AiTask{
		ID: 22, UserID: 33, ProjectID: 44, Handler: "reference_to_video",
		ModelID: 55, ModelName: "Video Model", Status: statusFailed, PointCost: 12,
		ErrorMsg: "task-internal-secret", CompleteTime: &complete,
		Input: `{
			"prompt":"用户完整提示词",
			"systemPrompt":"system-secret",
			"clientRequestId":"request-id-secret",
			"sourceImage":"https://cdn.example.com/ref.png",
			"videoReferences":["https://cdn.example.com/ref.mp4"],
			"callbackUrl":"https://internal.example/callback",
			"resolution":"1080p"
		}`,
		ResultUrl:  "https://cdn.example.com/result.mp4",
		ResultMeta: `{"urls":["https://cdn.example.com/result.mp4"],"providerTaskId":"meta-secret","text":""}`,
	}

	vo := toUserHistoryDetail(log, task)
	payload, err := json.Marshal(vo)
	if err != nil {
		t.Fatal(err)
	}
	lower := strings.ToLower(string(payload))
	for _, forbidden := range []string{
		"taskid", "userid", "projectid", "handler", "operation", "request", "response",
		"httpstatus", "upstream", "errormsg", "provider", "system-secret", "request-id-secret",
		"callback", "internal.example", "task-internal-secret", "raw-request-secret", "raw-response-secret",
		"meta-secret",
	} {
		if strings.Contains(lower, strings.ToLower(forbidden)) {
			t.Fatalf("public detail leaked %q: %s", forbidden, payload)
		}
	}
	if len(vo.InputAssets) != 2 || vo.InputAssets[0].Kind != "image" || vo.InputAssets[1].Kind != "video" {
		t.Fatalf("safe input assets not grouped correctly: %#v", vo.InputAssets)
	}
	if len(vo.Parameters) != 1 || vo.Parameters[0].Key != "resolution" || vo.Parameters[0].Value != "1080p" {
		t.Fatalf("safe parameters = %#v", vo.Parameters)
	}
	if vo.FailureReason != userFacingGenErr {
		t.Fatalf("unsafe legacy task error must fail closed, got %q", vo.FailureReason)
	}
}

func TestPublicHistoryFailureReasonIsUsefulButNeverRaw(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want string
	}{
		{name: "known product copy", raw: "参考素材无法读取，请重新上传后重试", want: "参考素材无法读取，请重新上传后重试"},
		{name: "legacy safety error", raw: "provider 400: content policy violation; request_id=secret", want: userFacingSafetyErr},
		{name: "Gemini image safety", raw: "relaymedia: code 5001: Gemini returned text only: unknown finish reason: [IMAGE_SAFETY]", want: userFacingSafetyErr},
		{name: "internal provider detail", raw: "relay HTTP 502 https://internal.example key=sk-secret", want: userFacingGenErr},
		{name: "empty", raw: "", want: userFacingGenErr},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := publicGenerationFailureReason(tc.raw); got != tc.want {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
		})
	}
}

func TestUserHistoryUsesClassifiedAuditReasonForLegacyGenericTask(t *testing.T) {
	log := &model.AiGenerationLog{
		Success:  0,
		ErrorMsg: "relaymedia: code 5001: Gemini returned text only: unknown finish reason: [IMAGE_SAFETY]",
	}
	task := &model.AiTask{Status: statusFailed, ErrorMsg: userFacingGenErr}

	detail := toUserHistoryDetail(log, task)
	if detail.FailureReason != userFacingSafetyErr {
		t.Fatalf("failure reason = %q, want %q", detail.FailureReason, userFacingSafetyErr)
	}
}

func TestPublicInputAssetsIgnoresURLsOutsideAllowedFields(t *testing.T) {
	assets := publicInputAssets(`{
		"prompt":"visit https://prompt.example/secret",
		"systemPrompt":"https://system.example/secret",
		"messages":[{"role":"system","content":"https://message.example/secret"}],
		"sourceImage":"https://cdn.example.com/allowed.png"
	}`)
	if len(assets) != 1 || assets[0].URL != "https://cdn.example.com/allowed.png" {
		t.Fatalf("assets = %#v", assets)
	}
}

func TestUserHistoryDetailOwnershipUsesOpaqueRecordID(t *testing.T) {
	vo := UserGenerationHistoryVO{ID: idgen.ID(123), MediaType: "image", Model: "M"}
	payload, err := json.Marshal(vo)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(payload), "taskId") {
		t.Fatalf("task id must not appear in history summary: %s", payload)
	}
}
