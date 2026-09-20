package chatgateway

// responses.go serves the OpenAI Responses API on top of the Chat Completions
// providers this gateway is configured with.
//
// Codex speaks only Responses — wire_api = "chat" was removed from it in early
// 2026 — while third-party providers and relays overwhelmingly speak Chat
// Completions. So the request is translated into a chat request, the
// provider's chat stream is translated back into Responses events as it
// arrives, and billing runs on the very same reservation row and the very same
// stored chat frames as /chat/completions. The ledger does not know which
// dialect the client spoke.

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/tokenbilling"
)

// responsesRequest is what the translation keeps of the client's request
// beyond the chat body it produced.
type responsesRequest struct {
	stream bool
}

func (s *service) responses(c *gin.Context) {
	raw, ok := s.decodeBody(c)
	if !ok {
		return
	}
	body, req, err := chatBodyFromResponses(raw)
	if err != nil {
		gatewayError(c, 400, "invalid_request", err.Error())
		return
	}
	call := s.prepare(c, body, req.stream)
	if call == nil {
		return
	}
	enc := newResponsesEncoder(c, call)
	if !call.fresh {
		enc.replay()
		return
	}
	if call.stream {
		enc.begin()
	}
	enc.finish(s.run(c, call, enc.frame, enc.heartbeat))
}

// chatBodyFromResponses translates a Responses request into the chat request
// the provider will receive. It carries over what a chat provider can act on
// and drops what only OpenAI's hosted runtime could — stored state, hosted
// tools, opaque reasoning — rather than refusing a request over fields that
// change with every Codex release.
func chatBodyFromResponses(raw map[string]any) (map[string]any, *responsesRequest, error) {
	req := &responsesRequest{}
	req.stream, _ = raw["stream"].(bool)
	if previous, _ := raw["previous_response_id"].(string); previous != "" {
		return nil, nil, errors.New("previous_response_id 不受支持：本网关不保存对话，请把完整历史放进 input")
	}
	body := map[string]any{}
	if model, ok := raw["model"]; ok {
		body["model"] = model
	}
	messages := []any{}
	if instructions, _ := raw["instructions"].(string); strings.TrimSpace(instructions) != "" {
		messages = append(messages, map[string]any{"role": "system", "content": instructions})
	}
	var err error
	if messages, err = appendInputMessages(messages, raw["input"]); err != nil {
		return nil, nil, err
	}
	body["messages"] = messages
	if tools := chatToolsFromResponses(raw["tools"]); len(tools) > 0 {
		body["tools"] = tools
		if choice := chatToolChoice(raw["tool_choice"]); choice != nil {
			body["tool_choice"] = choice
		}
		if parallel, ok := raw["parallel_tool_calls"].(bool); ok {
			body["parallel_tool_calls"] = parallel
		}
	}
	if value, ok := raw["max_output_tokens"]; ok && value != nil {
		body["max_completion_tokens"] = value
	}
	for _, key := range []string{"temperature", "top_p"} {
		if value, ok := raw[key]; ok && value != nil {
			body[key] = value
		}
	}
	if reasoning, ok := raw["reasoning"].(map[string]any); ok {
		if effort, _ := reasoning["effort"].(string); effort != "" {
			body["reasoning_effort"] = effort
		}
	}
	if text, ok := raw["text"].(map[string]any); ok {
		if format, ok := text["format"].(map[string]any); ok {
			switch format["type"] {
			case "json_schema":
				schema := map[string]any{"name": format["name"], "schema": format["schema"]}
				if strict, ok := format["strict"].(bool); ok {
					schema["strict"] = strict
				}
				if description, ok := format["description"]; ok {
					schema["description"] = description
				}
				body["response_format"] = map[string]any{"type": "json_schema", "json_schema": schema}
			case "json_object":
				body["response_format"] = map[string]any{"type": "json_object"}
			}
		}
	}
	return body, req, nil
}

func appendInputMessages(messages []any, input any) ([]any, error) {
	switch v := input.(type) {
	case nil:
		return messages, nil
	case string:
		return append(messages, map[string]any{"role": "user", "content": v}), nil
	case []any:
		for _, raw := range v {
			item, ok := raw.(map[string]any)
			if !ok {
				return nil, errors.New("input 中的每一项必须是对象")
			}
			var err error
			if messages, err = appendInputItem(messages, item); err != nil {
				return nil, err
			}
		}
		return messages, nil
	}
	return nil, errors.New("input 必须是字符串或数组")
}

// appendInputItem maps one Responses input item onto the chat message list.
// Messages, function calls and their outputs are what a chat provider can use;
// everything else (reasoning items, hosted tool calls, item references) is
// skipped, since no chat provider could take it and the conversation still
// reads correctly without it.
func appendInputItem(messages []any, item map[string]any) ([]any, error) {
	kind, _ := item["type"].(string)
	if kind == "" && item["role"] != nil {
		kind = "message"
	}
	switch kind {
	case "message":
		role, _ := item["role"].(string)
		switch role {
		case "user", "assistant", "system":
		case "developer":
			role = "system"
		default:
			return nil, fmt.Errorf("不支持的消息角色 %q", role)
		}
		content, err := chatContent(item["content"], role == "user")
		if err != nil {
			return nil, err
		}
		return append(messages, map[string]any{"role": role, "content": content}), nil
	case "function_call":
		callID, _ := item["call_id"].(string)
		if callID == "" {
			callID, _ = item["id"].(string)
		}
		name, _ := item["name"].(string)
		if callID == "" || name == "" {
			return nil, errors.New("function_call 需要 call_id 和 name")
		}
		toolCall := map[string]any{"id": callID, "type": "function", "function": map[string]any{"name": name, "arguments": argumentsString(item["arguments"])}}
		// Calls issued in one assistant turn — after its commentary, or one
		// after another — belong to one assistant message.
		if n := len(messages); n > 0 {
			if last, ok := messages[n-1].(map[string]any); ok && last["role"] == "assistant" {
				calls, _ := last["tool_calls"].([]any)
				last["tool_calls"] = append(calls, toolCall)
				return messages, nil
			}
		}
		return append(messages, map[string]any{"role": "assistant", "content": "", "tool_calls": []any{toolCall}}), nil
	case "function_call_output":
		callID, _ := item["call_id"].(string)
		if callID == "" {
			return nil, errors.New("function_call_output 需要 call_id")
		}
		return append(messages, map[string]any{"role": "tool", "tool_call_id": callID, "content": toolOutputText(item["output"])}), nil
	}
	return messages, nil
}

// chatContent turns Responses content into chat content. Text-only content
// collapses to a plain string, which every provider takes; an array is kept
// only when there is an image to carry, and only a user message may carry one.
func chatContent(value any, allowImages bool) (any, error) {
	switch v := value.(type) {
	case nil:
		return "", nil
	case string:
		return v, nil
	case []any:
		var text strings.Builder
		parts := []any{}
		images := false
		for _, raw := range v {
			part, ok := raw.(map[string]any)
			if !ok {
				return nil, errors.New("content 中的每一项必须是对象")
			}
			switch part["type"] {
			case "input_text", "output_text", "text", "summary_text":
				t, _ := part["text"].(string)
				text.WriteString(t)
				parts = append(parts, map[string]any{"type": "text", "text": t})
			case "refusal":
				t, _ := part["refusal"].(string)
				text.WriteString(t)
				parts = append(parts, map[string]any{"type": "text", "text": t})
			case "input_image":
				url := imageURL(part)
				if !allowImages || url == "" {
					continue
				}
				image := map[string]any{"url": url}
				if detail, _ := part["detail"].(string); detail != "" {
					image["detail"] = detail
				}
				parts = append(parts, map[string]any{"type": "image_url", "image_url": image})
				images = true
			case "input_file":
				return nil, errors.New("对话接口不支持 input_file 附件，请改为文本或图片")
			}
		}
		if images {
			return parts, nil
		}
		return text.String(), nil
	}
	return nil, errors.New("content 必须是字符串或数组")
}

func imageURL(part map[string]any) string {
	switch v := part["image_url"].(type) {
	case string:
		return v
	case map[string]any:
		url, _ := v["url"].(string)
		return url
	}
	return ""
}

// argumentsString is the function arguments as the JSON string chat expects.
// Responses carries them as a string too, but a client may hand over the
// object it parsed.
func argumentsString(value any) string {
	switch v := value.(type) {
	case nil:
		return "{}"
	case string:
		return v
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return "{}"
	}
	return string(raw)
}

// toolOutputText flattens a function result to the text a tool message holds.
func toolOutputText(value any) string {
	switch v := value.(type) {
	case nil:
		return ""
	case string:
		return v
	case []any:
		var text strings.Builder
		for _, raw := range v {
			if part, ok := raw.(map[string]any); ok {
				if t, ok := part["text"].(string); ok {
					text.WriteString(t)
				}
			}
		}
		return text.String()
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return ""
	}
	return string(raw)
}

// chatToolsFromResponses keeps the function tools. Hosted tool types
// (web_search, local_shell, custom…) have no chat equivalent and are dropped;
// Codex only sends those for models it knows to support them.
func chatToolsFromResponses(value any) []any {
	raw, _ := value.([]any)
	tools := []any{}
	for _, item := range raw {
		tool, ok := item.(map[string]any)
		if !ok || tool["type"] != "function" {
			continue
		}
		name, _ := tool["name"].(string)
		if name == "" {
			continue
		}
		fn := map[string]any{"name": name}
		if description, ok := tool["description"]; ok && description != nil {
			fn["description"] = description
		}
		if parameters, ok := tool["parameters"]; ok && parameters != nil {
			fn["parameters"] = parameters
		} else {
			fn["parameters"] = map[string]any{"type": "object", "properties": map[string]any{}}
		}
		if strict, _ := tool["strict"].(bool); strict {
			fn["strict"] = true
		}
		tools = append(tools, map[string]any{"type": "function", "function": fn})
	}
	return tools
}

func chatToolChoice(value any) any {
	switch v := value.(type) {
	case string:
		switch v {
		case "auto", "none", "required":
			return v
		}
	case map[string]any:
		if name, _ := v["name"].(string); v["type"] == "function" && name != "" {
			return map[string]any{"type": "function", "function": map[string]any{"name": name}}
		}
	}
	return nil
}

// responsesEncoder turns the provider's chat stream into Responses events and
// the settled result into a Responses object. Output items appear in the order
// the provider produced them: reasoning, then the message and function calls.
type responsesEncoder struct {
	c         *gin.Context
	call      *call
	id        string
	created   int64
	sequence  int
	connected bool
	items     []*responseItem
	message   *responseItem
	reasoning *responseItem
	tools     map[int]*responseItem // by the provider's tool_calls index
}

type responseItem struct {
	kind   string // "reasoning" | "message" | "function_call"
	id     string
	index  int
	open   bool
	text   strings.Builder // summary text, message text or call arguments
	callID string
	name   string
}

func newResponsesEncoder(c *gin.Context, call *call) *responsesEncoder {
	return &responsesEncoder{c: c, call: call, id: "resp_" + idgen.Next().String(), created: time.Now().Unix(), connected: true, tools: map[int]*responseItem{}}
}

// event writes one Responses SSE event. Every payload carries its type and a
// sequence number, as the reference server's do; the event name is repeated in
// the SSE event field for parsers that key on it.
func (e *responsesEncoder) event(kind string, payload gin.H) {
	if !e.call.stream || !e.connected {
		return
	}
	payload["type"] = kind
	payload["sequence_number"] = e.sequence
	e.sequence++
	raw, _ := json.Marshal(payload)
	e.connected = writeGatewaySSE(e.c, "event: "+kind+"\ndata: "+string(raw)+"\n\n")
}

func (e *responsesEncoder) heartbeat() {
	if !e.call.stream || !e.connected {
		return
	}
	e.connected = writeGatewaySSE(e.c, ": heartbeat\n\n")
}

func (e *responsesEncoder) begin() {
	e.c.Header("Content-Type", "text/event-stream")
	e.c.Header("X-Accel-Buffering", "no")
	e.c.Status(200)
	e.event("response.created", gin.H{"response": e.response("in_progress", nil)})
	e.event("response.in_progress", gin.H{"response": e.response("in_progress", nil)})
}

// frame takes one chat SSE frame ("data: {…}\n\n") and emits the Responses
// deltas it contains.
func (e *responsesEncoder) frame(wire string) {
	data := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(wire), "data:"))
	var f map[string]any
	if json.Unmarshal([]byte(data), &f) != nil || f["error"] != nil {
		return
	}
	choices, _ := f["choices"].([]any)
	if len(choices) == 0 {
		return
	}
	choice, _ := choices[0].(map[string]any)
	delta, _ := choice["delta"].(map[string]any)
	if text, ok := delta["reasoning_content"].(string); ok && text != "" {
		e.reasoningDelta(text)
	}
	if text, ok := delta["content"].(string); ok && text != "" {
		e.textDelta(text)
	}
	if calls, ok := delta["tool_calls"].([]any); ok {
		for _, raw := range calls {
			if call, ok := raw.(map[string]any); ok {
				index, _ := call["index"].(float64)
				e.toolDelta(int(index), call)
			}
		}
	}
}

// feed replays stored chat frames through frame.
func (e *responsesEncoder) feed(frames string) {
	for _, line := range strings.Split(frames, "\n") {
		if strings.HasPrefix(line, "data:") {
			e.frame(line)
		}
	}
}

// open starts an output item. Items of another kind still open are finished
// first: a chat stream says "reasoning, then text, then calls" by changing
// which delta it sends, and Responses says it with output_item.done.
func (e *responsesEncoder) open(kind string) *responseItem {
	for _, item := range e.items {
		if item.open && item.kind != kind {
			e.close(item)
		}
	}
	prefix := map[string]string{"reasoning": "rs_", "message": "msg_", "function_call": "fc_"}[kind]
	item := &responseItem{kind: kind, id: prefix + idgen.Next().String(), index: len(e.items), open: true}
	e.items = append(e.items, item)
	return item
}

func (e *responsesEncoder) reasoningDelta(text string) {
	if e.reasoning == nil || !e.reasoning.open {
		e.reasoning = e.open("reasoning")
		item := e.reasoning
		e.event("response.output_item.added", gin.H{"output_index": item.index, "item": gin.H{"type": "reasoning", "id": item.id, "summary": []any{}}})
		e.event("response.reasoning_summary_part.added", gin.H{"item_id": item.id, "output_index": item.index, "summary_index": 0, "part": gin.H{"type": "summary_text", "text": ""}})
	}
	item := e.reasoning
	item.text.WriteString(text)
	e.event("response.reasoning_summary_text.delta", gin.H{"item_id": item.id, "output_index": item.index, "summary_index": 0, "delta": text})
}

func (e *responsesEncoder) textDelta(text string) {
	if e.message == nil || !e.message.open {
		e.message = e.open("message")
		item := e.message
		e.event("response.output_item.added", gin.H{"output_index": item.index, "item": gin.H{"type": "message", "id": item.id, "role": "assistant", "status": "in_progress", "content": []any{}}})
		e.event("response.content_part.added", gin.H{"item_id": item.id, "output_index": item.index, "content_index": 0, "part": gin.H{"type": "output_text", "text": "", "annotations": []any{}}})
	}
	item := e.message
	item.text.WriteString(text)
	e.event("response.output_text.delta", gin.H{"item_id": item.id, "output_index": item.index, "content_index": 0, "delta": text, "logprobs": []any{}})
}

func (e *responsesEncoder) toolDelta(index int, call map[string]any) {
	item := e.tools[index]
	fresh := item == nil || !item.open
	if fresh {
		item = e.open("function_call")
		e.tools[index] = item
	}
	if id, _ := call["id"].(string); id != "" {
		item.callID = id
	}
	fn, _ := call["function"].(map[string]any)
	if name, _ := fn["name"].(string); name != "" {
		item.name += name
	}
	if fresh {
		e.event("response.output_item.added", gin.H{"output_index": item.index, "item": gin.H{"type": "function_call", "id": item.id, "call_id": item.callID, "name": item.name, "arguments": "", "status": "in_progress"}})
	}
	if args, _ := fn["arguments"].(string); args != "" {
		item.text.WriteString(args)
		e.event("response.function_call_arguments.delta", gin.H{"item_id": item.id, "output_index": item.index, "delta": args})
	}
}

func (e *responsesEncoder) close(item *responseItem) {
	if !item.open {
		return
	}
	item.open = false
	text := item.text.String()
	switch item.kind {
	case "reasoning":
		e.event("response.reasoning_summary_text.done", gin.H{"item_id": item.id, "output_index": item.index, "summary_index": 0, "text": text})
		e.event("response.reasoning_summary_part.done", gin.H{"item_id": item.id, "output_index": item.index, "summary_index": 0, "part": gin.H{"type": "summary_text", "text": text}})
	case "message":
		e.event("response.output_text.done", gin.H{"item_id": item.id, "output_index": item.index, "content_index": 0, "text": text, "logprobs": []any{}})
		e.event("response.content_part.done", gin.H{"item_id": item.id, "output_index": item.index, "content_index": 0, "part": gin.H{"type": "output_text", "text": text, "annotations": []any{}}})
	case "function_call":
		e.event("response.function_call_arguments.done", gin.H{"item_id": item.id, "output_index": item.index, "arguments": text})
	}
	e.event("response.output_item.done", gin.H{"output_index": item.index, "item": e.itemJSON(item)})
}

func (e *responsesEncoder) itemJSON(item *responseItem) gin.H {
	text := item.text.String()
	switch item.kind {
	case "reasoning":
		return gin.H{"type": "reasoning", "id": item.id, "summary": []any{gin.H{"type": "summary_text", "text": text}}}
	case "message":
		return gin.H{"type": "message", "id": item.id, "role": "assistant", "status": "completed", "content": []any{gin.H{"type": "output_text", "text": text, "annotations": []any{}}}}
	}
	return gin.H{"type": "function_call", "id": item.id, "call_id": item.callID, "name": item.name, "arguments": text, "status": "completed"}
}

// response is the Responses object for what has been received so far.
func (e *responsesEncoder) response(status string, out *completion) gin.H {
	output := make([]any, 0, len(e.items))
	for _, item := range e.items {
		output = append(output, e.itemJSON(item))
	}
	resp := gin.H{"id": e.id, "object": "response", "created_at": e.created, "status": status, "model": e.call.modelName, "output": output}
	if out != nil {
		if usage := responsesUsage(out.usage); usage != nil {
			resp["usage"] = usage
		}
	}
	if e.call.row.BillingMode == "token" {
		resp["billing"] = billingInfo(e.call.row)
	}
	return resp
}

// responsesUsage restates the provider's chat usage in Responses terms.
func responsesUsage(value any) gin.H {
	if value == nil {
		return nil
	}
	usage, err := tokenbilling.ParseUsage(value)
	if err != nil {
		return nil
	}
	return gin.H{
		"input_tokens": usage.Input, "input_tokens_details": gin.H{"cached_tokens": usage.Cached},
		"output_tokens": usage.Output, "output_tokens_details": gin.H{"reasoning_tokens": usage.Reasoning},
		"total_tokens": usage.Input + usage.Output,
	}
}

// failed is the Responses object for a call that did not complete, with the
// error in the shape clients classify on.
func (e *responsesEncoder) failed(code, message string, upstreamStatus int, out *completion) gin.H {
	resp := e.response("failed", out)
	detail := gin.H{"type": code, "code": responsesErrorCode(code, upstreamStatus), "message": message}
	if upstreamStatus != 0 {
		detail["upstream_status"] = upstreamStatus
	}
	resp["error"] = detail
	return resp
}

// responsesErrorCode picks the error code Codex acts on. Codex retries a
// failure it does not recognize; a provider's objection to the request itself
// would be repeated verbatim several times before the user saw it, so those
// are given the code Codex treats as final. Rate limits and outages keep the
// codes Codex backs off on.
func responsesErrorCode(code string, upstreamStatus int) string {
	if code != "upstream_error" {
		return code
	}
	switch {
	case upstreamStatus == 429:
		return "rate_limit_exceeded"
	case upstreamStatus >= 400 && upstreamStatus < 500:
		return "invalid_prompt"
	case upstreamStatus >= 500 || upstreamStatus == 0:
		return "server_is_overloaded"
	}
	return code
}

// finish says the last words for a fresh call once run has settled it.
func (e *responsesEncoder) finish(r *outcome) {
	out := &r.out
	e.feed(r.terminal)
	if r.code != "" {
		if e.call.stream {
			// Deltas already streamed stay as they were; the failure is the
			// last event, and the stream ends. Codex reports a stored failure
			// when the stream closes.
			e.event("response.failed", gin.H{"response": e.failed(r.code, r.message, r.upstreamStatus, out)})
			return
		}
		e.errorJSON(failureStatus(r), r.code, r.message, r.upstreamStatus, out)
		return
	}
	for _, item := range e.items {
		e.close(item)
	}
	if e.call.stream {
		e.event("response.completed", gin.H{"response": e.response("completed", out)})
		return
	}
	e.c.JSON(200, e.response("completed", out))
}

// errorJSON is the non-streaming failure: the same error envelope every
// gateway endpoint uses, with whatever output was produced attached so a
// client can keep what it was charged for.
func (e *responsesEncoder) errorJSON(status int, code, message string, upstreamStatus int, out *completion) {
	detail := gin.H{"type": code, "code": responsesErrorCode(code, upstreamStatus), "message": message}
	if upstreamStatus != 0 {
		detail["upstream_status"] = upstreamStatus
	}
	result := gin.H{"error": detail}
	if len(e.items) > 0 {
		result["partial_response"] = e.response("incomplete", out)
	}
	if billing, ok := e.c.Get(billingKey); ok {
		result["billing"] = billing
	}
	e.c.Header("Cache-Control", "no-store")
	e.c.JSON(status, result)
}

// replay answers an idempotent repeat from the stored chat frames, in the
// Responses dialect this client speaks.
func (e *responsesEncoder) replay() {
	row := e.call.row
	if replayInProgress(e.c, row) {
		return
	}
	out := parseCompletion(row.ResponseBody)
	if row.Status != "success" {
		message := replayMessage(row)
		if e.call.stream {
			// Headers and response.created must precede any delta.
			e.begin()
			e.feed(partialGatewayFrames(row.ResponseBody))
			e.event("response.failed", gin.H{"response": e.failed("generation_failed", message, 0, out)})
			return
		}
		e.feed(partialGatewayFrames(row.ResponseBody))
		e.errorJSON(502, "generation_failed", message, 0, out)
		return
	}
	if e.call.stream {
		e.begin()
	}
	e.feed(row.ResponseBody)
	for _, item := range e.items {
		e.close(item)
	}
	if e.call.stream {
		e.event("response.completed", gin.H{"response": e.response("completed", out)})
		return
	}
	e.c.JSON(200, e.response("completed", out))
}
