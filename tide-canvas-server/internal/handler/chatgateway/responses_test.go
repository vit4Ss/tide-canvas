package chatgateway

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"tidecanvas/internal/model"
)

// A Codex turn: instructions, a history with a tool round-trip, function
// tools and a hosted tool, reasoning settings. The provider must receive the
// chat request it expects and nothing it cannot take.
func TestAResponsesRequestBecomesTheChatRequestTheProviderExpects(t *testing.T) {
	var raw map[string]any
	if err := json.Unmarshal([]byte(`{
	  "model": "flowinglight/test-model", "instructions": "You are Codex.", "stream": true, "store": false,
	  "input": [
	    {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "list files"}]},
	    {"type": "reasoning", "summary": [], "encrypted_content": "opaque"},
	    {"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": "Sure."}]},
	    {"type": "function_call", "name": "shell", "arguments": "{\"cmd\":[\"ls\"]}", "call_id": "call_1"},
	    {"type": "function_call_output", "call_id": "call_1", "output": "a.txt\nb.txt"},
	    {"role": "user", "content": "thanks"}
	  ],
	  "tools": [
	    {"type": "function", "name": "shell", "description": "Run a command", "strict": false, "parameters": {"type": "object", "properties": {"cmd": {"type": "array"}}}},
	    {"type": "web_search"}
	  ],
	  "tool_choice": "auto", "parallel_tool_calls": false,
	  "reasoning": {"effort": "medium", "summary": "auto"}, "max_output_tokens": 500,
	  "include": ["reasoning.encrypted_content"], "prompt_cache_key": "session-1"
	}`), &raw); err != nil {
		t.Fatal(err)
	}
	body, req, err := chatBodyFromResponses(raw)
	if err != nil {
		t.Fatal(err)
	}
	if !req.stream {
		t.Fatal("stream flag lost")
	}
	messages, _ := body["messages"].([]any)
	if len(messages) != 5 {
		t.Fatalf("messages = %d, want system, user, assistant, tool, user: %v", len(messages), messages)
	}
	roles := []string{}
	for _, raw := range messages {
		roles = append(roles, raw.(map[string]any)["role"].(string))
	}
	if strings.Join(roles, ",") != "system,user,assistant,tool,user" {
		t.Fatalf("roles = %v", roles)
	}
	if messages[0].(map[string]any)["content"] != "You are Codex." || messages[1].(map[string]any)["content"] != "list files" {
		t.Fatalf("instructions or text content mangled: %v", messages[:2])
	}
	assistant := messages[2].(map[string]any)
	calls, _ := assistant["tool_calls"].([]any)
	if assistant["content"] != "Sure." || len(calls) != 1 {
		t.Fatalf("the call was not attached to its assistant turn: %v", assistant)
	}
	call := calls[0].(map[string]any)
	fn := call["function"].(map[string]any)
	if call["id"] != "call_1" || call["type"] != "function" || fn["name"] != "shell" || fn["arguments"] != `{"cmd":["ls"]}` {
		t.Fatalf("tool call mangled: %v", call)
	}
	tool := messages[3].(map[string]any)
	if tool["tool_call_id"] != "call_1" || tool["content"] != "a.txt\nb.txt" {
		t.Fatalf("tool result mangled: %v", tool)
	}
	tools, _ := body["tools"].([]any)
	if len(tools) != 1 {
		t.Fatalf("hosted tool was not dropped, or the function tool was: %v", tools)
	}
	chatTool := tools[0].(map[string]any)["function"].(map[string]any)
	if chatTool["name"] != "shell" || chatTool["description"] != "Run a command" || chatTool["parameters"] == nil {
		t.Fatalf("function tool mangled: %v", chatTool)
	}
	if _, ok := chatTool["strict"]; ok {
		t.Fatal("strict=false was forwarded; only true is meaningful and some providers reject the field")
	}
	if body["tool_choice"] != "auto" || body["parallel_tool_calls"] != false {
		t.Fatalf("tool settings lost: %v %v", body["tool_choice"], body["parallel_tool_calls"])
	}
	if body["max_completion_tokens"] != float64(500) || body["reasoning_effort"] != "medium" {
		t.Fatalf("limits lost: %v %v", body["max_completion_tokens"], body["reasoning_effort"])
	}
	for _, key := range []string{"input", "instructions", "store", "include", "prompt_cache_key", "reasoning", "max_output_tokens"} {
		if _, ok := body[key]; ok {
			t.Fatalf("Responses-only field %q reached the chat body", key)
		}
	}
}

func TestStoredConversationsAreRefusedNotSilentlyLost(t *testing.T) {
	_, _, err := chatBodyFromResponses(map[string]any{"model": "m", "input": "hi", "previous_response_id": "resp_1"})
	if err == nil || !strings.Contains(err.Error(), "previous_response_id") {
		t.Fatalf("err = %v", err)
	}
}

// The provider's chat stream: commentary, one tool call in two pieces, usage.
const chatStreamWithToolCall = "data: {\"id\":\"chatcmpl-1\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"Let me\"}}]}\n\n" +
	"data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\" look.\"}}]}\n\n" +
	"data: {\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_9\",\"type\":\"function\",\"function\":{\"name\":\"shell\",\"arguments\":\"{\\\"cmd\\\":\"}}]}}]}\n\n" +
	"data: {\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"[\\\"ls\\\"]}\"}}]}}]}\n\n" +
	"data: {\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"tool_calls\"}]}\n\n" +
	"data: {\"choices\":[],\"usage\":{\"prompt_tokens\":100,\"completion_tokens\":50,\"total_tokens\":150,\"prompt_tokens_details\":{\"cached_tokens\":20},\"completion_tokens_details\":{\"reasoning_tokens\":0}}}\n\n" +
	"data: [DONE]\n\n"

type sseEvent struct {
	kind string
	data map[string]any
}

func responsesEvents(t *testing.T, body string) []sseEvent {
	t.Helper()
	var events []sseEvent
	for _, block := range strings.Split(body, "\n\n") {
		var event sseEvent
		for _, line := range strings.Split(block, "\n") {
			if strings.HasPrefix(line, "event:") {
				event.kind = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
			}
			if strings.HasPrefix(line, "data:") {
				if err := json.Unmarshal([]byte(strings.TrimSpace(strings.TrimPrefix(line, "data:"))), &event.data); err != nil {
					t.Fatalf("invalid event data %q: %v", line, err)
				}
			}
		}
		if event.data != nil {
			if event.kind == "" {
				event.kind, _ = event.data["type"].(string)
			}
			events = append(events, event)
		}
	}
	return events
}

func TestAResponsesStreamCarriesTextToolCallUsageAndOneCharge(t *testing.T) {
	var received map[string]any
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &received)
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, chatStreamWithToolCall)
	}))
	defer upstream.Close()
	f := setup(t, upstream.URL)
	request := `{"model":"flowinglight/test-model","instructions":"Be brief.","input":"list files","stream":true,` +
		`"tools":[{"type":"function","name":"shell","parameters":{"type":"object","properties":{}}}]}`
	w := f.request("POST", "/api/integrations/v1/responses", request, f.apiKey, nil)
	if w.Code != 200 {
		t.Fatalf("responses call failed: %d %s", w.Code, w.Body.String())
	}
	if w.Header().Get("X-Billing-Mode") != "token" {
		t.Fatal("billing headers missing")
	}
	// The provider saw a chat request, not the Responses one.
	if received["input"] != nil || received["messages"] == nil || received["stream"] != true || received["model"] != "test-model" {
		t.Fatalf("provider received %v", received)
	}
	if options, _ := received["stream_options"].(map[string]any); options["include_usage"] != true {
		t.Fatalf("usage not requested from the provider: %v", received["stream_options"])
	}

	events := responsesEvents(t, w.Body.String())
	if len(events) == 0 || events[0].kind != "response.created" {
		t.Fatalf("stream does not start with response.created: %+v", events)
	}
	responseID, _ := events[0].data["response"].(map[string]any)["id"].(string)
	if !strings.HasPrefix(responseID, "resp_") {
		t.Fatalf("response id = %q", responseID)
	}
	var text strings.Builder
	var doneItems []map[string]any
	var completed map[string]any
	for i, event := range events {
		switch event.kind {
		case "response.output_text.delta":
			delta, _ := event.data["delta"].(string)
			text.WriteString(delta)
		case "response.output_item.done":
			item, _ := event.data["item"].(map[string]any)
			doneItems = append(doneItems, item)
		case "response.completed":
			completed, _ = event.data["response"].(map[string]any)
			if i != len(events)-1 {
				t.Fatalf("response.completed is not the last event: %+v", events[i+1:])
			}
		case "response.failed":
			t.Fatalf("stream failed: %v", event.data)
		}
	}
	if text.String() != "Let me look." {
		t.Fatalf("streamed text = %q", text.String())
	}
	if len(doneItems) != 2 || doneItems[0]["type"] != "message" || doneItems[1]["type"] != "function_call" {
		t.Fatalf("done items = %v", doneItems)
	}
	content, _ := doneItems[0]["content"].([]any)
	if len(content) != 1 || content[0].(map[string]any)["type"] != "output_text" || content[0].(map[string]any)["text"] != "Let me look." {
		t.Fatalf("message item = %v", doneItems[0])
	}
	if doneItems[1]["call_id"] != "call_9" || doneItems[1]["name"] != "shell" || doneItems[1]["arguments"] != `{"cmd":["ls"]}` {
		t.Fatalf("function call item = %v", doneItems[1])
	}
	if completed == nil {
		t.Fatal("no response.completed")
	}
	if completed["id"] != responseID {
		t.Fatalf("completed id %v differs from created id %v", completed["id"], responseID)
	}
	usage, _ := completed["usage"].(map[string]any)
	cached, _ := usage["input_tokens_details"].(map[string]any)
	if usage["input_tokens"] != float64(100) || usage["output_tokens"] != float64(50) || usage["total_tokens"] != float64(150) || cached["cached_tokens"] != float64(20) {
		t.Fatalf("usage = %v", usage)
	}
	output, _ := completed["output"].([]any)
	if len(output) != 2 {
		t.Fatalf("completed output = %v", output)
	}
	billing, _ := completed["billing"].(map[string]any)
	if billing["mode"] != "token" || billing["status"] != "success" {
		t.Fatalf("billing = %v", billing)
	}

	// One reservation, settled once, at the chat pricing: a fraction of a
	// point rounded up to a whole one, hold released.
	var user model.User
	if err := f.s.d.DB.First(&user, "id = ?", f.user.ID).Error; err != nil {
		t.Fatal(err)
	}
	if user.PointBalance() != 19 || user.PointHeldMicros != 0 {
		t.Fatalf("balance=%v held=%d, want one whole point charged and nothing held", user.PointBalance(), user.PointHeldMicros)
	}
	var rows []model.ModelGatewayRequest
	f.s.d.DB.Find(&rows)
	if len(rows) != 1 || rows[0].Status != "success" || rows[0].InputTokens != 100 || rows[0].OutputTokens != 50 {
		t.Fatalf("ledger rows = %+v", rows)
	}
}

func TestAProviderObjectionEndsAResponsesStreamAsAFinalFailure(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(400)
		fmt.Fprint(w, `{"error":{"message":"This model does not support tools","type":"invalid_request_error"}}`)
	}))
	defer upstream.Close()
	f := setup(t, upstream.URL)
	w := f.request("POST", "/api/integrations/v1/responses", `{"model":"test-model","input":"hi","stream":true}`, f.apiKey, nil)
	if w.Code != 200 {
		t.Fatalf("a streaming failure must arrive in-stream: %d %s", w.Code, w.Body.String())
	}
	events := responsesEvents(t, w.Body.String())
	last := events[len(events)-1]
	if last.kind != "response.failed" {
		t.Fatalf("last event = %s, want response.failed: %+v", last.kind, events)
	}
	response, _ := last.data["response"].(map[string]any)
	detail, _ := response["error"].(map[string]any)
	if detail["code"] != "invalid_prompt" || !strings.Contains(detail["message"].(string), "does not support tools") || detail["upstream_status"] != float64(400) {
		t.Fatalf("error = %v", detail)
	}
	var user model.User
	f.s.d.DB.First(&user, "id = ?", f.user.ID)
	if user.PointBalance() != 20 || user.PointHeldMicros != 0 {
		t.Fatalf("a refused call was charged: balance=%v held=%d", user.PointBalance(), user.PointHeldMicros)
	}
}

func TestANonStreamingResponsesCallReturnsTheResponseObject(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, okWithUsage)
	}))
	defer upstream.Close()
	f := setup(t, upstream.URL)
	w := f.request("POST", "/api/integrations/v1/responses", `{"model":"test-model","input":[{"role":"user","content":[{"type":"input_text","text":"hi"}]}]}`, f.apiKey, nil)
	if w.Code != 200 {
		t.Fatalf("call failed: %d %s", w.Code, w.Body.String())
	}
	result := jsonMap(t, w)
	if result["object"] != "response" || result["status"] != "completed" {
		t.Fatalf("result = %v", result)
	}
	output, _ := result["output"].([]any)
	if len(output) != 1 {
		t.Fatalf("output = %v", output)
	}
	message := output[0].(map[string]any)
	content, _ := message["content"].([]any)
	if message["type"] != "message" || message["role"] != "assistant" || len(content) != 1 || content[0].(map[string]any)["text"] != "ok" {
		t.Fatalf("message = %v", message)
	}
	usage, _ := result["usage"].(map[string]any)
	if usage["input_tokens"] != float64(100) || usage["output_tokens"] != float64(100) {
		t.Fatalf("usage = %v", usage)
	}
	if billing, _ := result["billing"].(map[string]any); billing["mode"] != "token" {
		t.Fatalf("billing = %v", result["billing"])
	}
	if w.Header().Get("X-Point-Cost") == "" {
		t.Fatal("non-streaming call did not report its cost header")
	}
}

// A retried Responses call with the same idempotency key is answered from the
// stored chat frames, in Responses form, without a second charge.
func TestAResponsesReplayIsServedFromTheStoredResultWithoutASecondCharge(t *testing.T) {
	var calls int
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, chatStreamWithToolCall)
	}))
	defer upstream.Close()
	f := setup(t, upstream.URL)
	request := `{"model":"test-model","input":"list files","stream":true}`
	headers := map[string]string{"Idempotency-Key": "codex-turn-1"}
	first := f.request("POST", "/api/integrations/v1/responses", request, f.apiKey, headers)
	if first.Code != 200 {
		t.Fatalf("first call failed: %d %s", first.Code, first.Body.String())
	}
	second := f.request("POST", "/api/integrations/v1/responses", request, f.apiKey, headers)
	if second.Code != 200 || second.Header().Get("X-Idempotent-Replay") != "true" || second.Header().Get("Content-Type") != "text/event-stream" {
		t.Fatalf("replay = %d %v %s", second.Code, second.Header(), second.Body.String())
	}
	if calls != 1 {
		t.Fatalf("the provider was called %d times", calls)
	}
	events := responsesEvents(t, second.Body.String())
	if events[0].kind != "response.created" || events[len(events)-1].kind != "response.completed" {
		t.Fatalf("replay stream is not framed created…completed: %+v", events)
	}
	var text strings.Builder
	var done int
	for _, event := range events {
		if event.kind == "response.output_text.delta" {
			text.WriteString(event.data["delta"].(string))
		}
		if event.kind == "response.output_item.done" {
			done++
		}
	}
	if text.String() != "Let me look." || done != 2 {
		t.Fatalf("replay lost content: text=%q items=%d", text.String(), done)
	}
	var user model.User
	f.s.d.DB.First(&user, "id = ?", f.user.ID)
	if user.PointBalance() != 19 || user.PointHeldMicros != 0 {
		t.Fatalf("replay charged again: balance=%v held=%d", user.PointBalance(), user.PointHeldMicros)
	}
}
