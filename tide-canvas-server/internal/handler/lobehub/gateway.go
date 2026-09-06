package lobehub

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"tidecanvas/internal/handler/points"
	"tidecanvas/internal/middleware"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/chatcontext"
	"tidecanvas/internal/pkg/chatupstream"
	"tidecanvas/internal/pkg/eventlog"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/logger"
	"tidecanvas/internal/pkg/tokenbilling"
)

const maxGatewayResponse = 8 << 20

var errBusy = errors.New("gateway concurrency limit")
var errDaily = errors.New("gateway daily limit")
var errQuota = errors.New("gateway account quota")
var errReplayConflict = errors.New("idempotency key reused for different input")

type gatewayContextKey int

const gatewayKeyRevision gatewayContextKey = 1

func gatewayError(c *gin.Context, status int, code, message string) {
	c.Header("Cache-Control", "no-store")
	c.JSON(status, gin.H{"error": gin.H{"type": code, "code": code, "message": message}})
}

func gatewayGenerationError(c *gin.Context, code, message, modelName string, out *completion) {
	result := gin.H{"error": gin.H{"type": code, "code": code, "message": message}}
	if out.hasOutput() {
		// JSON clients must also be able to recover content they were charged
		// for. The HTTP status remains an error, never a completed generation.
		result["partial_response"] = out.json(modelName)
	}
	if billing, ok := c.Get("lobehub.billing"); ok {
		result["billing"] = billing
	}
	c.JSON(502, result)
}

func writeGatewaySSE(c *gin.Context, data string) bool {
	if c.Request.Context().Err() != nil {
		return false
	}
	_ = http.NewResponseController(c.Writer).SetWriteDeadline(time.Now().Add(5 * time.Second))
	if _, err := io.WriteString(c.Writer, data); err != nil {
		return false
	}
	c.Writer.Flush()
	return true
}

// A finish marker may share its frame with the last text/tool delta. Preserve
// those deltas on interruption, but defer every finish/error signal to our own
// settled result so a client cannot stop before receiving the actual error.
func partialGatewayFrames(frames string) string {
	var result strings.Builder
	for _, line := range strings.Split(frames, "\n") {
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		var data map[string]any
		if json.Unmarshal([]byte(strings.TrimSpace(strings.TrimPrefix(line, "data:"))), &data) != nil || data["error"] != nil {
			continue
		}
		choices, _ := data["choices"].([]any)
		for _, raw := range choices {
			if choice, ok := raw.(map[string]any); ok {
				choice["finish_reason"] = nil
			}
		}
		encoded, _ := json.Marshal(data)
		result.WriteString("data: " + string(encoded) + "\n\n")
	}
	return result.String()
}
func (s *service) listModels(c *gin.Context) {
	routes, err := s.offeredModels(c.Request.Context())
	if err != nil {
		gatewayError(c, 503, "unavailable", "模型列表暂不可用")
		return
	}
	data := []any{}
	for i := range routes {
		r := &routes[i]
		// The provider and its addresses stay server-side; a caller only needs
		// the model id and what it costs.
		data = append(data, gin.H{
			"id": r.model.ModelKey, "object": "model", "created": r.model.CreateTime.Unix(),
			"owned_by": "flowinglight", "name": r.displayNameOnly(), "token_pricing": r.pricing,
		})
	}
	c.JSON(200, gin.H{"object": "list", "data": data})
}

// Previous completed tool steps are omitted from history; the whole current
// user turn's tool cycle stays intact so tool_call_id references remain valid.
func trimGatewayHistory(messages []any) ([]any, error) {
	lastUser := -1
	systems := []any{}
	for i, value := range messages {
		m, ok := value.(map[string]any)
		if !ok {
			return nil, errors.New("invalid message")
		}
		role, _ := m["role"].(string)
		switch role {
		case "user":
			lastUser = i
		case "assistant", "tool":
		case "system", "developer":
			systems = append(systems, value)
		default:
			return nil, errors.New("invalid message role")
		}
	}
	if lastUser < 0 {
		return nil, errors.New("a current user message is required")
	}
	history := []any{}
	for _, value := range messages[:lastUser] {
		m := value.(map[string]any)
		role := m["role"]
		if (role == "user" || role == "assistant") && m["tool_calls"] == nil {
			history = append(history, value)
		}
	}
	out := append(systems, chatcontext.Latest(history)...)
	for _, value := range messages[lastUser:] {
		m := value.(map[string]any)
		if m["role"] != "system" && m["role"] != "developer" {
			out = append(out, value)
		}
	}
	return out, nil
}

// reserve holds the worst-case cost of one call. Every AI chat model is token
// priced, so there is a single billing mode here.
func (s *service) reserve(ctx context.Context, uid idgen.ID, requestKey, bodyHash string, route *chatRoute, outputLimit ...int64) (*model.ModelGatewayRequest, bool, error) {
	var row model.ModelGatewayRequest
	fresh := false
	err := s.d.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var user model.User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&user, "id = ? AND status = 1", uid).Error; err != nil {
			return err
		}
		err := tx.Where("user_id = ? AND request_key = ?", uid, requestKey).First(&row).Error
		if err == nil {
			if row.BodyHash != bodyHash {
				return errReplayConflict
			}
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		var active int64
		if err := tx.Model(&model.ModelGatewayRequest{}).Where("user_id = ? AND status = ?", uid, "pending").Count(&active).Error; err != nil {
			return err
		}
		limit := s.cfg.MaxConcurrent
		if limit < 1 {
			limit = 2
		}
		if user.ConcurrencyUnlimited != 1 && active >= int64(limit) {
			return errBusy
		}
		if user.ApiQuota > 0 {
			var used int64
			if err := tx.Unscoped().Model(&model.ModelGatewayRequest{}).Where("user_id = ? AND status IN ?", uid, []string{"pending", "success", "partial", "billing_pending"}).Count(&used).Error; err != nil {
				return err
			}
			if used >= user.ApiQuota {
				return errQuota
			}
		}
		if s.cfg.DailyLimit > 0 {
			zone := time.FixedZone("Asia/Shanghai", 8*3600)
			now := time.Now().In(zone)
			start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, zone)
			var used int64
			if err := tx.Unscoped().Model(&model.ModelGatewayRequest{}).Where("user_id = ? AND create_time >= ? AND status IN ?", uid, start.In(time.Local), []string{"pending", "success", "partial", "billing_pending"}).Count(&used).Error; err != nil {
				return err
			}
			if used >= int64(s.cfg.DailyLimit) {
				return errDaily
			}
		}
		pricing := route.pricing
		outputCap := pricing.MaxOutput
		if len(outputLimit) > 0 {
			outputCap = outputLimit[0]
		}
		if outputCap < 1 || outputCap > pricing.MaxOutput {
			return tokenbilling.ErrLimit
		}
		reserved, err := pricing.Reserve(outputCap)
		if err != nil {
			return err
		}
		row = model.ModelGatewayRequest{
			UserID: uid, RequestKey: requestKey, BodyHash: bodyHash, ModelKey: route.model.ModelKey,
			Status: "pending", ExpiresAt: time.Now().Add(65 * time.Minute),
			BillingMode: "token", ReservedMicros: reserved,
			PricingSnapshot: pricingSnapshot(pricing), MaxOutputTokens: outputCap,
		}
		var key model.UserAPIKey
		if err := tx.First(&key, "user_id = ?", uid).Error; err != nil {
			return err
		}
		row.KeyRevision = key.Revision
		if revision, ok := ctx.Value(gatewayKeyRevision).(uint64); ok {
			row.KeyRevision = revision
		}
		row.ID = idgen.Next()
		if err := tx.Create(&row).Error; err != nil {
			return err
		}
		if err := points.HoldMicros(tx, uid, row.ReservedMicros); err != nil {
			return err
		}
		fresh = true
		return nil
	})
	return &row, fresh, err
}
func (s *service) settle(row *model.ModelGatewayRequest, frames, code string) error {
	return s.settleInContext(context.Background(), row, frames, code)
}

func (s *service) settleInContext(parent context.Context, row *model.ModelGatewayRequest, frames, code string) error {
	if row.BillingMode == "token" {
		return s.settleTokens(parent, row, frames, code)
	}
	ctx, cancel := context.WithTimeout(parent, 15*time.Second)
	defer cancel()
	return s.d.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		status := "success"
		if code != "" {
			status = "failed"
			if parseCompletion(frames).hasOutput() {
				status = "partial"
			}
		}
		result := tx.Model(&model.ModelGatewayRequest{}).Where("id = ? AND status = ?", row.ID, "pending").Updates(map[string]any{"status": status, "response_body": frames, "error_code": code})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return nil
		}
		if status == "failed" {
			return points.Refund(tx, row.UserID, row.Cost, "AI 聊天失败退款", row.ID)
		}
		return nil
	})
}

type upstreamFrame struct {
	data string
	err  error
	done bool
}
type completion struct {
	text      strings.Builder
	reasoning strings.Builder
	tools     map[int]map[string]any
	finish    string
	id        string
	usage     any
	produced  bool
	failed    bool
	done      bool
}

func (out *completion) inspect(data string) bool {
	if data == "[DONE]" {
		out.done = true
		return true
	}
	var frame map[string]any
	if json.Unmarshal([]byte(data), &frame) != nil {
		return false
	}
	if frame["error"] != nil {
		out.failed = true
		return true
	}
	if id, ok := frame["id"].(string); ok {
		out.id = id
	}
	if usage := frame["usage"]; usage != nil {
		out.usage = usage
	}
	choices, _ := frame["choices"].([]any)
	if len(choices) == 0 {
		return false
	}
	choice, _ := choices[0].(map[string]any)
	delta, _ := choice["delta"].(map[string]any)
	if value, ok := delta["content"].(string); ok {
		out.text.WriteString(value)
		out.produced = out.produced || value != ""
	}
	if value, ok := delta["reasoning_content"].(string); ok {
		out.reasoning.WriteString(value)
	}
	if calls, ok := delta["tool_calls"].([]any); ok {
		if out.tools == nil {
			out.tools = map[int]map[string]any{}
		}
		for _, raw := range calls {
			call, ok := raw.(map[string]any)
			if !ok {
				continue
			}
			index, _ := call["index"].(float64)
			i := int(index)
			if out.tools[i] == nil {
				out.tools[i] = map[string]any{"type": "function", "function": map[string]any{"name": "", "arguments": ""}}
			}
			target := out.tools[i]
			if id, ok := call["id"].(string); ok {
				target["id"] = id
			}
			if fn, ok := call["function"].(map[string]any); ok {
				f := target["function"].(map[string]any)
				for _, key := range []string{"name", "arguments"} {
					if text, ok := fn[key].(string); ok {
						f[key] = f[key].(string) + text
					}
				}
			}
			out.produced = true
		}
	}
	if reason, ok := choice["finish_reason"].(string); ok && reason != "" {
		out.finish = reason
		return true
	}
	return false
}
func (out *completion) complete() bool {
	return out.hasOutput() && out.validTools() && !out.failed && (out.done || out.finish == "stop" || out.finish == "tool_calls") && (out.finish == "" || out.finish == "stop" || out.finish == "tool_calls")
}
func (out *completion) validTools() bool {
	for index, call := range out.tools {
		id, _ := call["id"].(string)
		fn, _ := call["function"].(map[string]any)
		name, _ := fn["name"].(string)
		args, _ := fn["arguments"].(string)
		if index < 0 || id == "" || name == "" || !json.Valid([]byte(args)) {
			return false
		}
	}
	return true
}
func (out *completion) hasOutput() bool {
	return strings.TrimSpace(out.text.String()) != "" || (len(out.tools) > 0 && out.validTools())
}
func parseCompletion(frames string) *completion {
	out := &completion{}
	for _, line := range strings.Split(frames, "\n") {
		if strings.HasPrefix(line, "data:") {
			out.inspect(strings.TrimSpace(strings.TrimPrefix(line, "data:")))
		}
	}
	return out
}
func (out *completion) json(modelName string) gin.H {
	msg := gin.H{"role": "assistant", "content": out.text.String()}
	if out.reasoning.Len() > 0 {
		msg["reasoning_content"] = out.reasoning.String()
	}
	if len(out.tools) > 0 {
		calls := []any{}
		indices := make([]int, 0, len(out.tools))
		for index := range out.tools {
			indices = append(indices, index)
		}
		sort.Ints(indices)
		for _, index := range indices {
			calls = append(calls, out.tools[index])
		}
		msg["tool_calls"] = calls
	}
	finish := out.finish
	if finish == "" {
		finish = "stop"
	}
	id := out.id
	if id == "" {
		id = "chatcmpl-" + idgen.Next().String()
	}
	return gin.H{"id": id, "object": "chat.completion", "created": time.Now().Unix(), "model": modelName, "choices": []any{gin.H{"index": 0, "message": msg, "finish_reason": finish}}, "usage": out.usage}
}

func (s *service) readUpstream(ctx context.Context, endpoints []chatEndpoint, payload []byte, events chan<- upstreamFrame) {
	defer close(events)
	send := func(f upstreamFrame) bool {
		select {
		case events <- f:
			return true
		case <-ctx.Done():
			return false
		}
	}
	// Walk the provider's addresses until one accepts the call. Failover stops
	// the moment a response starts: once bytes are on their way to the user,
	// retrying elsewhere would repeat text and charge for both attempts.
	var resp *http.Response
	var lastErr error
	for i, endpoint := range endpoints {
		req, err := http.NewRequestWithContext(ctx, "POST", chatupstream.Endpoint(endpoint.baseURL, "chat/completions"), bytes.NewReader(payload))
		if err != nil {
			send(upstreamFrame{err: err})
			return
		}
		req.Header.Set("Authorization", "Bearer "+endpoint.apiKey)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Accept", "text/event-stream")
		attempt, err := s.upstream.Do(req)
		if err != nil {
			lastErr = errors.New("upstream connection failed")
			s.noteEndpoint(endpoint.id, "连接失败")
			continue
		}
		if attempt.StatusCode != 200 {
			attempt.Body.Close()
			lastErr = fmt.Errorf("upstream HTTP %d", attempt.StatusCode)
			s.noteEndpoint(endpoint.id, fmt.Sprintf("HTTP %d", attempt.StatusCode))
			continue
		}
		if i > 0 {
			logger.L().Info("chat call moved to a backup endpoint", zap.String("endpoint", endpoint.label))
		}
		s.noteEndpoint(endpoint.id, "")
		resp = attempt
		break
	}
	if resp == nil {
		if lastErr == nil {
			lastErr = errors.New("upstream connection failed")
		}
		send(upstreamFrame{err: lastErr})
		return
	}
	defer resp.Body.Close()
	scan := bufio.NewScanner(resp.Body)
	scan.Buffer(make([]byte, 64<<10), 2<<20)
	for scan.Scan() {
		line := strings.TrimSpace(scan.Text())
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "" {
			continue
		}
		var parsed map[string]any
		if data != "[DONE]" && (json.Unmarshal([]byte(data), &parsed) != nil || parsed == nil) {
			send(upstreamFrame{err: errors.New("upstream returned an invalid event")})
			return
		}
		// An upstream that echoes its own credential back in an error must not
		// forward it to the user, so scrub every key this call could have used.
		for _, endpoint := range endpoints {
			if endpoint.apiKey != "" {
				data = strings.ReplaceAll(data, endpoint.apiKey, "[REDACTED]")
			}
		}
		if !send(upstreamFrame{data: data}) {
			return
		}
		if data == "[DONE]" || parsed["error"] != nil {
			return
		}
	}
	if err := scan.Err(); err != nil {
		send(upstreamFrame{err: errors.New("upstream stream interrupted")})
	}
}

func (s *service) chat(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<20)
	var body map[string]any
	decoder := json.NewDecoder(c.Request.Body)
	if decoder.Decode(&body) != nil {
		gatewayError(c, 400, "invalid_request", "请求格式无效或超过大小限制")
		return
	}
	var trailing any
	if decoder.Decode(&trailing) != io.EOF {
		gatewayError(c, 400, "invalid_request", "请求必须是单个 JSON 对象")
		return
	}
	modelName, _ := body["model"].(string)
	messages, ok := body["messages"].([]any)
	if !ok || len(messages) == 0 || len(messages) > 256 {
		gatewayError(c, 400, "invalid_request", "消息列表无效")
		return
	}
	if n, ok := body["n"].(float64); ok && n != 1 {
		gatewayError(c, 400, "invalid_request", "每次只支持一条回复")
		return
	}
	if tools, exists := body["tools"]; exists {
		items, ok := tools.([]any)
		if !ok {
			gatewayError(c, 400, "invalid_request", "工具列表格式无效")
			return
		}
		if len(items) > 0 && !s.cfg.SupportsTools {
			gatewayError(c, 400, "tools_unavailable", "工具调用尚未启用，请管理员先升级模型网关")
			return
		}
	}
	trimmed, err := trimGatewayHistory(messages)
	if err != nil {
		gatewayError(c, 400, "invalid_request", "消息格式无效")
		return
	}
	// Resolve the model to its provider and credentialed addresses before any
	// money moves: a model we cannot reach must not be charged for.
	route, err := s.routeFor(c.Request.Context(), modelName)
	if err != nil {
		switch {
		case errors.Is(err, errNoChatModel):
			gatewayError(c, 404, "model_not_available", "该模型未开放给 AI 聊天")
		case errors.Is(err, errNoEndpoint):
			gatewayError(c, 503, "upstream_unavailable", "该模型的供应商没有可用的接入地址，请联系管理员")
		default:
			gatewayError(c, 503, "unavailable", "模型配置暂不可用")
		}
		return
	}
	stream, _ := body["stream"].(bool)
	body["stream"] = true
	body["messages"] = trimmed
	uid := middleware.CurrentUserID(c)
	body["user"] = uid.String()
	fingerprint, _ := json.Marshal(body)
	// A model only reaches this point with usable pricing — offeredModels drops
	// the rest — so token billing always applies here.
	pricing := route.pricing
	maxOutput := int64(0)
	{
		maxOutput = pricing.MaxOutput
		field := "max_completion_tokens"
		if body["max_tokens"] != nil && body["max_completion_tokens"] == nil {
			field = "max_tokens"
		}
		if raw := body[field]; raw != nil {
			value, ok := raw.(float64)
			if !ok || value < 1 || value > float64(pricing.MaxOutput) || value != math.Trunc(value) {
				gatewayError(c, 400, "invalid_token_limit", fmt.Sprintf("输出 Token 上限必须在 1–%d 之间", pricing.MaxOutput))
				return
			}
			maxOutput = int64(value)
		}
		if body["max_tokens"] != nil && body["max_completion_tokens"] != nil {
			gatewayError(c, 400, "invalid_token_limit", "请只使用一个输出 Token 上限参数")
			return
		}
		body[field] = maxOutput
		options := map[string]any{}
		if raw := body["stream_options"]; raw != nil {
			var ok bool
			options, ok = raw.(map[string]any)
			if !ok {
				gatewayError(c, 400, "invalid_request", "stream_options 格式无效")
				return
			}
		}
		options["include_usage"] = true
		body["stream_options"] = options
	}
	payload, err := json.Marshal(body)
	if err != nil {
		gatewayError(c, 400, "invalid_request", "请求格式无效")
		return
	}
	requestKey := c.GetHeader("Idempotency-Key")
	if len(requestKey) > 128 {
		gatewayError(c, 400, "invalid_request", "请求标识过长")
		return
	}
	if requestKey == "" {
		requestKey = c.GetString(middleware.CtxRequestID)
	}
	if requestKey == "" {
		requestKey = idgen.Next().String()
	}
	requestContext := c.Request.Context()
	if revision, ok := c.Get("integration.keyRevision"); ok {
		requestContext = context.WithValue(requestContext, gatewayKeyRevision, revision)
	}
	row, fresh, err := s.reserve(requestContext, uid, hash(requestKey), hash(string(fingerprint)), route, maxOutput)
	if err != nil {
		switch {
		case errors.Is(err, points.ErrInsufficient):
			gatewayError(c, 402, "insufficient_points", "可用积分不足以预留本次 Token 额度，请充值或降低输出上限")
		case errors.Is(err, errBusy):
			gatewayError(c, 429, "concurrency_limit", "已有聊天正在生成，请稍后再试")
		case errors.Is(err, errDaily):
			gatewayError(c, 429, "daily_limit", "今日调用次数已用完")
		case errors.Is(err, errQuota):
			gatewayError(c, 429, "account_quota", "账户 API 调用额度已用完，请联系管理员调整")
		case errors.Is(err, errReplayConflict):
			gatewayError(c, 409, "idempotency_conflict", "请求标识已用于其他内容")
		default:
			gatewayError(c, 503, "unavailable", "暂时无法开始生成")
		}
		return
	}
	c.Header("X-Request-Id", requestKey)
	if row.BillingMode == "token" {
		c.Header("X-Billing-Mode", "token")
		c.Header("X-Point-Reserved", tokenCostLabel(row.ReservedMicros))
		if !fresh {
			c.Header("X-Point-Cost", tokenCostLabel(row.CostMicros))
			c.Set("lobehub.billing", billingInfo(row))
		}
	} else {
		c.Header("X-Point-Cost", fmt.Sprint(row.Cost))
	}
	c.Header("Cache-Control", "no-store")
	if !fresh {
		c.Header("X-Idempotent-Replay", "true")
		if row.Status == "pending" {
			c.Header("Retry-After", "5")
			gatewayError(c, 409, "request_in_progress", "原请求仍在生成，请勿重复扣费重试")
			return
		}
		if row.Status != "success" {
			message := "该请求生成失败，已退回积分；请使用新请求重试"
			if row.Status == "partial" {
				message = fmt.Sprintf("原请求已生成部分内容，已消耗 %d 积分；本次重试不重复扣费", row.Cost)
			}
			if row.BillingMode == "token" {
				message = fmt.Sprintf("原请求已结算 %s 积分；重放不会重复扣费", tokenCostLabel(row.CostMicros))
				if row.Status == "billing_pending" {
					message = "本次 Token 用量需要核对，预留积分暂未释放，请查看主站 Token 账单"
				}
			}
			if (row.Status == "partial" || row.Status == "billing_pending") && stream {
				c.Header("Content-Type", "text/event-stream")
				c.Header("X-Accel-Buffering", "no")
				data, _ := json.Marshal(gin.H{"error": gin.H{"type": "partial_response", "message": message}})
				writeGatewaySSE(c, partialGatewayFrames(row.ResponseBody)+billingFrame(row)+"data: "+string(data)+"\n\ndata: [DONE]\n\n")
				return
			}
			gatewayGenerationError(c, "generation_failed", message, modelName, parseCompletion(row.ResponseBody))
			return
		}
		if stream {
			c.Header("Content-Type", "text/event-stream")
			c.Header("X-Accel-Buffering", "no")
			writeGatewaySSE(c, strings.TrimSuffix(row.ResponseBody, "data: [DONE]\n\n")+billingFrame(row)+"data: [DONE]\n\n")
			return
		}
		out := parseCompletion(row.ResponseBody)
		result := out.json(modelName)
		if row.BillingMode == "token" {
			result["billing"] = billingInfo(row)
		}
		c.JSON(200, result)
		return
	}
	started := time.Now()
	ctx, cancel := context.WithTimeout(context.WithoutCancel(c.Request.Context()), 60*time.Minute)
	defer cancel()
	events := make(chan upstreamFrame, 8)
	go s.readUpstream(ctx, route.endpoints, payload, events)
	connected := true
	emit := func(data string) {
		if !stream || !connected {
			return
		}
		connected = writeGatewaySSE(c, data)
	}
	if stream {
		c.Header("Content-Type", "text/event-stream")
		c.Header("X-Accel-Buffering", "no")
		c.Status(200)
		emit(": connected\n\n")
	}
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	var frames, terminal strings.Builder
	out := completion{}
	code := ""
	ended := false
	bufferTerminal := false
	for !ended {
		select {
		case <-ctx.Done():
			code = "generation_timeout"
			ended = true
		case <-ticker.C:
			emit(": heartbeat\n\n")
		case frame, ok := <-events:
			if !ok {
				ended = true
				break
			}
			if frame.err != nil {
				code = "upstream_error"
				ended = true
				break
			}
			if frames.Len()+len(frame.data) > maxGatewayResponse {
				code = "response_too_large"
				cancel()
				ended = true
				break
			}
			isTerminal := out.inspect(frame.data)
			if out.failed {
				// An explicit error is terminal even if the upstream keeps its
				// socket open. Release reservations instead of waiting an hour.
				ended = true
				cancel()
			}
			if frame.data == "[DONE]" {
				continue
			}
			wire := "data: " + frame.data + "\n\n"
			frames.WriteString(wire)
			bufferTerminal = bufferTerminal || isTerminal
			if bufferTerminal {
				terminal.WriteString(wire)
			} else {
				emit(wire)
			}
		}
	}
	if code == "" && !out.complete() {
		code = "incomplete_response"
	}
	if code == "" {
		frames.WriteString("data: [DONE]\n\n")
	}
	if err := s.settle(row, frames.String(), code); err != nil {
		logger.L().Error("gateway settlement failed", zap.String("request", row.ID.String()), zap.Error(err))
		code = "settlement_pending"
	}
	if row.BillingMode == "token" {
		c.Set("lobehub.billing", billingInfo(row))
		if !stream {
			c.Header("X-Point-Cost", tokenCostLabel(row.CostMicros))
		}
		if row.Status == "billing_pending" && code != "settlement_pending" {
			code = "token_usage_unavailable"
		}
	}
	var callErr error
	if code != "" {
		callErr = errors.New(code)
	}
	cost := int64(row.Cost)
	if code != "" && code != "settlement_pending" && !out.hasOutput() {
		cost = 0
	}
	auditResponse := out.text.String()
	if len(out.tools) > 0 {
		raw, _ := json.Marshal(out.json(modelName))
		auditResponse = string(raw)
	}
	eventlog.ModelText(uid, "chat", modelName, "/api/integrations/v1/chat/completions", eventlog.SanitizeDataURIs(string(payload)), auditResponse, started, callErr, cost, eventlog.ModelTextBillingRef{ID: row.ID, Type: "ledger"})
	if code != "" {
		message := "回复未完整生成，积分已退回，请重新发起或继续提问"
		if out.hasOutput() {
			message = fmt.Sprintf("回复未完整生成，已保留有效内容，本次消耗 %d 积分；继续提问会发起新调用", row.Cost)
		}
		if row.BillingMode == "token" {
			message = fmt.Sprintf("回复未完整生成，已按返回用量结算 %s 积分，未使用的预留额度已释放", tokenCostLabel(row.CostMicros))
			if row.Status == "billing_pending" {
				message = "本次 Token 用量需要核对，预留积分暂未释放，请查看主站 Token 账单"
			}
		}
		if code == "settlement_pending" {
			message = "结果结算暂未完成，请保留请求编号并稍后查询"
		}
		if stream {
			emit(partialGatewayFrames(terminal.String()))
			emit(billingFrame(row))
			data, _ := json.Marshal(gin.H{"error": gin.H{"code": code, "type": code, "message": message}})
			emit("data: " + string(data) + "\n\ndata: [DONE]\n\n")
		} else {
			gatewayGenerationError(c, code, message, modelName, &out)
		}
		return
	}
	if stream {
		emit(terminal.String() + billingFrame(row) + "data: [DONE]\n\n")
	} else {
		result := out.json(modelName)
		if row.BillingMode == "token" {
			result["billing"] = billingInfo(row)
		}
		c.JSON(200, result)
	}
}
