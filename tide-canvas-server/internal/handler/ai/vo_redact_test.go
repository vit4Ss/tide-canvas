package ai

import (
	"strings"
	"testing"
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
		Status:   statusFailed,
		ErrorMsg: "请调整图片内容后重试",
	}, false)

	if vo.ErrorMsg != "请调整图片内容后重试" {
		t.Fatalf("history error = %q, want persisted task-facing Relay message", vo.ErrorMsg)
	}
	if vo.TaskStatus == nil || *vo.TaskStatus != statusFailed {
		t.Fatalf("history task status was not populated: %#v", vo.TaskStatus)
	}
}
