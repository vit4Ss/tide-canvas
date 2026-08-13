package ai

import (
	"strings"
	"testing"

	"tidecanvas/internal/model"
)

// GET /api/ai/logs 只挂 JWTAuth,画布「历史」面板把 errorMsg 直接渲染给用户。
// 这组用例钉住:普通用户拿不到任何上游原文,且话术与任务失败同源。
func TestRedactForUser(t *testing.T) {
	const (
		rawOpenAI = `{"error":{"message":"Your request was rejected by the safety system. ` +
			`If you believe this is an error, contact us at help.openai.com and include ` +
			`the request ID e04b5e0d-02da-4649-b0ff-23b97c91fc5a.","code":400,` +
			`"metadata":{"provider_name":"OpenAI"}}}`
		relayURL = "https://relay.internal.example.com/v1/images/generations"
	)
	cost := 0.042

	vo := AiGenerationLogVO{
		ErrorMsg:       rawOpenAI,
		RequestURL:     relayURL,
		RequestBody:    `{"model":"gpt-image-1","prompt":"..."}`,
		InputParams:    `{"prompt":"用户自己的提示词"}`,
		ResponseBody:   rawOpenAI,
		UpstreamTaskID: "task_abc123",
		Cost:           &cost,
		Model:          "gpt-image-1",
		HttpStatus:     400,
		DurationMs:     1200,
	}
	vo.redactForUser()

	if vo.ErrorMsg != "内容未通过安全审核，请调整后重试" {
		t.Errorf("errorMsg not mapped to the shared wording: %q", vo.ErrorMsg)
	}
	for name, got := range map[string]string{
		"requestUrl":     vo.RequestURL,
		"requestBody":    vo.RequestBody,
		"responseBody":   vo.ResponseBody,
		"upstreamTaskId": vo.UpstreamTaskID,
	} {
		if got != "" {
			t.Errorf("%s must be cleared for non-admins, got %q", name, got)
		}
	}
	if vo.Cost != nil {
		t.Errorf("cost (上游成本) must not reach users, got %v", *vo.Cost)
	}
	if vo.InputParams != `{"prompt":"用户自己的提示词"}` {
		t.Errorf("the owner's input params must survive redaction, got %q", vo.InputParams)
	}

	// 兜底:整个 VO 里不得残留任何供应商/内部标识。
	for _, leak := range []string{
		"openai", "help.openai.com", "e04b5e0d", "relay.internal", "safety system",
	} {
		if strings.Contains(strings.ToLower(vo.ErrorMsg+vo.RequestURL+vo.RequestBody+
			vo.ResponseBody+vo.UpstreamTaskID), leak) {
			t.Errorf("leaked %q after redaction", leak)
		}
	}

	// 用户自己看得懂的展示字段不受影响。
	if vo.Model != "gpt-image-1" || vo.HttpStatus != 400 || vo.DurationMs != 1200 {
		t.Error("display fields must survive redaction")
	}
}

// 未命中输入类规则的系统故障,脱敏后也必须是统一话术,不能漏出上游细节。
func TestRedactForUserSystemError(t *testing.T) {
	vo := AiGenerationLogVO{ErrorMsg: "relaymedia: HTTP 402: insufficient balance for key sk-xxx"}
	vo.redactForUser()
	if vo.ErrorMsg != userFacingGenErr {
		t.Errorf("got %q, want %q", vo.ErrorMsg, userFacingGenErr)
	}
}

// 成功记录没有 errorMsg,不该被塞进一条假的失败话术。
func TestRedactForUserKeepsEmptyError(t *testing.T) {
	vo := AiGenerationLogVO{ResultURL: "https://cdn.example.com/a.png"}
	vo.redactForUser()
	if vo.ErrorMsg != "" {
		t.Errorf("empty errorMsg must stay empty, got %q", vo.ErrorMsg)
	}
	if vo.ResultURL == "" {
		t.Error("resultUrl must survive: 用户要靠它看自己的产出")
	}
}

func TestUserHistoryReusesTaskFacingRelayMessage(t *testing.T) {
	vo := AiGenerationLogVO{ErrorMsg: "relaymedia: code 5002: raw audit copy"}
	vo.redactForUser()
	applyTaskLogState(&vo, taskLogState{
		Status:    statusFailed,
		ErrorMsg:  "参考素材无法读取，请重新上传后重试",
		PointCost: 840,
	}, false)

	if vo.ErrorMsg != "参考素材无法读取，请重新上传后重试" {
		t.Fatalf("history error = %q, want persisted task-facing Relay message", vo.ErrorMsg)
	}
	if vo.TaskStatus == nil || *vo.TaskStatus != statusFailed {
		t.Fatalf("history task status was not populated: %#v", vo.TaskStatus)
	}
	if vo.PointCost == nil || *vo.PointCost != 840 {
		t.Fatalf("history point cost was not populated: %#v", vo.PointCost)
	}
}

func TestPublicTaskVOAlwaysSanitizesPersistedFailureText(t *testing.T) {
	tests := []struct {
		name   string
		status int
		raw    string
		want   string
	}{
		{name: "legacy provider detail", status: statusFailed, raw: "relay HTTP 502 https://internal.example key=sk-secret", want: userFacingGenErr},
		{name: "stale task lifecycle", status: statusFailed, raw: "generation interrupted (server restart)", want: userFacingGenErr},
		{name: "known safe reason", status: statusFailed, raw: "参考素材无法读取，请重新上传后重试", want: "参考素材无法读取，请重新上传后重试"},
		{name: "cancelled", status: statusCancelled, raw: "generation cancelled by skill run", want: userFacingCancelledErr},
		{name: "success ignores stale error", status: statusSuccess, raw: "should not leave the server", want: ""},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			vo := toTaskVO(&model.AiTask{Status: tc.status, ErrorMsg: tc.raw})
			if vo.ErrorMsg != tc.want {
				t.Fatalf("errorMsg = %q, want %q", vo.ErrorMsg, tc.want)
			}
		})
	}
}

func TestGenerationPromptExcerptOnlyReturnsUserPrompt(t *testing.T) {
	raw := `{"systemPrompt":"internal workflow instruction","messages":[{"role":"system","content":"secret"},{"role":"user","content":[{"type":"text","text":"请生成一段雨夜街景"},{"type":"image_url","image_url":{"url":"https://example.com/ref.png"}}]}]}`
	if got := generationPromptExcerpt(raw, 200); got != "请生成一段雨夜街景" {
		t.Fatalf("prompt excerpt = %q", got)
	}
	if got := generationPromptExcerpt(`{"systemPrompt":"internal only"}`, 200); got != "" {
		t.Fatalf("system prompt must not be returned, got %q", got)
	}
	if got := generationPromptExcerpt(`{"prompt":"一二三四五六"}`, 4); got != "一二三四…" {
		t.Fatalf("unicode excerpt = %q", got)
	}
}

func TestLogListVOExposesExcerptButNotCompleteInput(t *testing.T) {
	vo := toLogVO(&model.AiGenerationLog{
		InputParams: `{"prompt":"可见摘要","systemPrompt":"internal instruction","token":"secret"}`,
	})
	if vo.Prompt != "可见摘要" {
		t.Fatalf("prompt = %q", vo.Prompt)
	}
	if vo.InputParams != "" {
		t.Fatalf("complete input must not be returned by list VO: %q", vo.InputParams)
	}
}
