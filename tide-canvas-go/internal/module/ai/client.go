package ai

import (
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/go-resty/resty/v2"
	"github.com/shopspring/decimal"
	"github.com/sirupsen/logrus"
	"github.com/tidwall/gjson"

	"github.com/tidecanvas/tide-canvas-go/internal/model"
)

// operationOf 日志操作类型：新版协议优先取 body.mode（t2i/i2i/t2v/i2v/keyframe/omni_ref），
// 无 mode 时按路径归类（对齐 AiRelayClient.operationOf）。
func operationOf(path string, body map[string]interface{}) string {
	if strings.Contains(path, "/chat/") {
		return "chat"
	}
	if mode := strOf(body["mode"]); hasText(mode) {
		return mode
	}
	if strings.Contains(path, "/edits") {
		return "edits"
	}
	if strings.Contains(path, "/contents/") {
		return "video"
	}
	return "generation"
}

// ===== 上游轮询 / 重试 / 超时参数（默认值如下，可由 config 的 ai.relay.* / ai.runware.* 覆盖）=====
//
// 对齐旧 AiRelayClient / RunwareClient 的 @Value 默认值。由 router 读取配置后通过 ClientConfig 注入。
type ClientConfig struct {
	// Relay（中转站 OpenAI 风格）
	RelayPollIntervalMs   int64 // ai.relay.poll-interval-ms 默认 3000
	RelayPollTimeoutMs    int64 // ai.relay.poll-timeout-ms 默认 720000（12 分钟）
	RelayMaxRetries       int   // ai.relay.max-retries 默认 2
	RelayRetryDelayMs     int64 // ai.relay.retry-delay-ms 默认 1500
	RelayConnectTimeoutMs int   // ai.relay.connect-timeout-ms 默认 15000
	RelayReadTimeoutMs    int   // ai.relay.read-timeout-ms 默认 300000

	// Runware（原生协议）
	RunwarePollIntervalMs   int64 // ai.runware.poll-interval-ms 默认 3000
	RunwarePollTimeoutMs    int64 // ai.runware.poll-timeout-ms 默认 720000
	RunwareConnectTimeoutMs int   // ai.runware.connect-timeout-ms 默认 15000
	RunwareReadTimeoutMs    int   // ai.runware.read-timeout-ms 默认 300000
}

// DefaultClientConfig 默认上游参数（对齐旧 @Value 默认值）。
func DefaultClientConfig() ClientConfig {
	return ClientConfig{
		RelayPollIntervalMs:   3000,
		RelayPollTimeoutMs:    720000,
		RelayMaxRetries:       2,
		RelayRetryDelayMs:     1500,
		RelayConnectTimeoutMs: 15000,
		RelayReadTimeoutMs:    300000,

		RunwarePollIntervalMs:   3000,
		RunwarePollTimeoutMs:    720000,
		RunwareConnectTimeoutMs: 15000,
		RunwareReadTimeoutMs:    300000,
	}
}

// edits 接口允许的参考图数量（上游协议固定限制，非调优项）。
const maxEditImageURLs = 16

// Runware referenceImages 上限。
const maxReferenceImages = 8

// ===== progressReporter：轮询期间回写任务实时进度（替代旧 ThreadLocal GenerationLogContext）=====
// service 启动任务时按当前 taskID 构造，传入 client；Runware 视频轮询期间回写 1~99 进度。
type progressReporter interface {
	report(progress int)
}

// noopProgress 空实现（同步/无进度场景）。
type noopProgress struct{}

func (noopProgress) report(int) {}

// upstreamLog 一次上游调用日志（client 产出，service 落库；替代旧 GenerationLogRecorder + 上下文回填）。
// service 调用 client 前传入 taskID/userID/projectID/handler，client 仅填上游交互字段。
type upstreamLog struct {
	Operation      string
	OperationType  string
	RequestURL     string
	Model          string
	RequestBody    string
	HTTPStatus     *int
	ResponseBody   string
	UpstreamTaskID string
	Success        bool
	ResultURL      string
	ErrorMsg       string
	Cost           *decimal.Decimal
	DurationMs     int64
}

// logSink 接收一条上游调用日志并落库（由 service 实现）。每次执行独立的 recorder 持有它，
// 避免在共享 gateway/client 上保存可变状态（多任务 goroutine 并发安全）。
type logSink interface {
	sink(lg upstreamLog, ctx logCtx)
}

// ===== Gateway：按供应商 providerType 分发到 Relay / Runware（对齐 AiMediaGateway）=====

// Gateway 媒体生成网关：与各 client 暴露同一组方法，Handler 只面向网关、不感知协议差异。
type Gateway struct {
	repo    *Repository
	relay   *relayClient
	runware *runwareClient
	logger  *logrus.Logger
}

// NewGateway 构造网关（含两个 client）。sink 可为 nil（不落上游日志）。
func NewGateway(repo *Repository, cfg ClientConfig, sink logSink, logger *logrus.Logger) *Gateway {
	return &Gateway{
		repo:    repo,
		relay:   newRelayClient(repo, cfg, sink, logger),
		runware: newRunwareClient(repo, cfg, sink, logger),
		logger:  logger,
	}
}

// isRunware 供应商是否走 Runware 原生协议（对齐 AiMediaGateway.isRunware）。
func isRunware(p *model.AiProvider) bool {
	return p != nil && strings.EqualFold(p.ProviderType, providerTypeRunware)
}

// isUsable 供应商是否可用（已配置 baseUrl + apiKey，对齐 AiRelayClient.isUsable）。
func (g *Gateway) isUsable(p *model.AiProvider) bool {
	return p != nil && hasText(p.BaseURL) && hasText(p.APIKey)
}

// resolveProvider 解析供应商：优先按 model 关联，找不到则取优先级最高的启用供应商（对齐 resolveProvider）。
func (g *Gateway) resolveProvider(execModel executionModel) (*model.AiProvider, error) {
	if execModel.ProviderID != 0 {
		p, err := g.repo.FindProviderByID(execModel.ProviderID)
		if err != nil {
			return nil, err
		}
		if p != nil && p.Status == 1 {
			return p, nil
		}
	}
	modelID := execModel.ModelID
	if hasText(modelID) && modelID != "default" {
		m, err := g.repo.FindModelByModelID(modelID)
		if err != nil {
			return nil, err
		}
		if m != nil && m.ProviderID != 0 {
			p, err := g.repo.FindProviderByID(m.ProviderID)
			if err != nil {
				return nil, err
			}
			if p != nil && p.Status == 1 {
				return p, nil
			}
		}
	}
	return g.repo.TopEnabledProvider()
}

// generate 文生图：返回图片 URL 列表（n>1 时一次多张）。
func (g *Gateway) generate(p *model.AiProvider, modelID, prompt string, input map[string]interface{}, pr progressReporter, ctx logCtx) ([]string, error) {
	if isRunware(p) {
		return g.runware.generate(p, modelID, prompt, input, pr, ctx)
	}
	return g.relay.generate(p, modelID, prompt, input, ctx)
}

// edit 图生图/编辑：返回图片 URL 列表。
func (g *Gateway) edit(p *model.AiProvider, modelID, prompt string, imageURLs []string, input map[string]interface{}, pr progressReporter, ctx logCtx) ([]string, error) {
	if isRunware(p) {
		return g.runware.edit(p, modelID, prompt, imageURLs, input, pr, ctx)
	}
	return g.relay.edit(p, modelID, prompt, imageURLs, input, ctx)
}

// generateVideo 视频任务：返回最终视频 URL。mode 为中转站新版协议形态标识（t2v/i2v/keyframe/omni_ref），
// Runware 原生协议不使用该字段。
func (g *Gateway) generateVideo(p *model.AiProvider, modelID, prompt string, input map[string]interface{}, mode string, pr progressReporter, ctx logCtx) (string, error) {
	if isRunware(p) {
		return g.runware.generateVideo(p, modelID, prompt, input, pr, ctx)
	}
	return g.relay.generateVideo(p, modelID, prompt, input, mode, ctx)
}

// generateAudio 语音合成：返回音频 URL（目前仅 Runware 协议支持，对齐 AiMediaGateway.generateAudio）。
func (g *Gateway) generateAudio(p *model.AiProvider, modelID, text string, input map[string]interface{}, pr progressReporter, ctx logCtx) (string, error) {
	if !isRunware(p) {
		return "", fmt.Errorf("当前供应商不支持语音合成，请在模型管理中将语音模型关联 Runware 供应商")
	}
	return g.runware.generateAudio(p, modelID, text, input, pr, ctx)
}

// chat 助手对话：走 OpenAI 风格 /chat/completions，同步返回文本。
func (g *Gateway) chat(p *model.AiProvider, modelID string, input map[string]interface{}, ctx logCtx) (string, error) {
	if isRunware(p) {
		return "", fmt.Errorf("当前供应商不支持助手对话，请在后台给文本模型关联 OpenAI 兼容供应商")
	}
	return g.relay.chat(p, modelID, input, ctx)
}

// logCtx 上游日志归属上下文（替代旧 GenerationLogContext.Ctx + ThreadLocal）。
// recorded 为本次执行「是否已产生上游调用日志」的标志位指针：client 落库一条上游日志即置位，
// service 据此决定要不要补记任务级 summary 日志。每次执行新建一个，goroutine 间互不干扰。
type logCtx struct {
	taskID    *int64
	userID    *int64
	projectID *int64
	handler   string
	recorded  *bool
}

// =====================================================================
// relayClient：AI 中转站（ScarecrowToken Relay）客户端，OpenAI 风格协议
// 对齐 AiRelayClient：文生图 /images/generations、图生图 /images/edits、视频 /contents/generations/tasks，
// 统一处理「200 同步成功」与「202 异步受理 + 轮询 /tasks/{id}」，解析 OpenAI 错误信封。
// =====================================================================

type relayClient struct {
	repo   *Repository
	cfg    ClientConfig
	sink   logSink
	logger *logrus.Logger
	http   *resty.Client
}

func newRelayClient(repo *Repository, cfg ClientConfig, sink logSink, logger *logrus.Logger) *relayClient {
	// 统一读响应原始字节自行解析（gjson），不依赖 resty 自动反序列化：
	// 部分中转站会把 JSON 错标成 octet-stream，按字节读可绕过 content-type 限制。
	c := resty.New().
		SetTimeout(time.Duration(cfg.RelayReadTimeoutMs)*time.Millisecond).
		SetHeader("Accept", "application/json")
	return &relayClient{repo: repo, cfg: cfg, sink: sink, logger: logger, http: c}
}

// generate 文生图：POST {baseUrl}/images/generations（operation=generation + mode=t2i），返回图片 URL 列表。
func (c *relayClient) generate(p *model.AiProvider, modelID, prompt string, input map[string]interface{}, ctx logCtx) ([]string, error) {
	body := map[string]interface{}{
		"model":     c.resolveModelName(modelID, p, "gpt-image-2"),
		"operation": "generation",
		"mode":      "t2i",
		"prompt":    prompt,
	}
	c.applyImageParams(body, input)
	c.applyBatchCount(body, input)
	return c.submitAndResolveMulti(p, "/images/generations", body, ctx)
}

// edit 图生图：POST {baseUrl}/images/edits（operation=edits + mode=i2i，image_urls 传图），返回图片 URL 列表。
func (c *relayClient) edit(p *model.AiProvider, modelID, prompt string, imageURLs []string, input map[string]interface{}, ctx logCtx) ([]string, error) {
	normalized, err := c.normalizeEditImageURLs(imageURLs)
	if err != nil {
		return nil, err
	}
	body := map[string]interface{}{
		"model":      c.resolveModelName(modelID, p, "gpt-image-2"),
		"operation":  "edits",
		"mode":       "i2i",
		"prompt":     prompt,
		"image_urls": normalized,
	}
	c.applyEditParams(body, input)
	c.applyBatchCount(body, input)
	return c.submitAndResolveMulti(p, "/images/edits", body, ctx)
}

// generateVideo 视频任务：POST {baseUrl}/contents/generations/tasks，返回最终视频 URL。
// 新版协议：prompt 顶层，operation=generation + mode 区分形态；首尾帧/参考图以 content[] 携带（仅媒体项）。
func (c *relayClient) generateVideo(p *model.AiProvider, modelID, prompt string, input map[string]interface{}, mode string, ctx logCtx) (string, error) {
	body := map[string]interface{}{
		"model":     c.resolveModelName(modelID, p, "seedance-v2"),
		"operation": "generation",
		"prompt":    prompt,
	}
	putIfText(body, "mode", mode)
	media := buildVideoContent(input)
	if len(media) > 0 {
		body["content"] = media
	}
	ratio := ratioOf(input)
	if hasText(ratio) {
		// 文档比例集含 adaptive（自适应）；前端的 auto 归一为 adaptive
		if ratio == "auto" {
			body["ratio"] = "adaptive"
		} else {
			body["ratio"] = ratio
		}
	}
	putIfText(body, "resolution", resolutionOf(input))
	putIfText(body, "duration", durationStr(input))
	putIfText(body, "fps", strOf(input["fps"]))
	return c.submitAndResolve(p, "/contents/generations/tasks", body, ctx)
}

// chat 文本助手对话：OpenAI 兼容 /chat/completions，同步返回 choices[].message.content。
func (c *relayClient) chat(p *model.AiProvider, modelID string, input map[string]interface{}, ctx logCtx) (string, error) {
	body := map[string]interface{}{
		"model":    c.resolveModelName(modelID, p, "gpt-4o-mini"),
		"messages": buildChatMessages(input),
		"stream":   false,
	}
	if temp, ok := input["temperature"].(float64); ok {
		body["temperature"] = temp
	}
	if maxTokens := strOf(input["maxTokens"]); hasText(maxTokens) {
		body["max_tokens"] = maxTokens
	}

	start := time.Now()
	fullURL := baseURL(p) + "/chat/completions"
	resp, err := c.http.R().
		SetHeader("Authorization", "Bearer "+p.APIKey).
		SetHeader("Content-Type", "application/json").
		SetBody(body).
		Post(fullURL)
	code := 0
	raw := ""
	if resp != nil {
		code = resp.StatusCode()
		raw = string(resp.Body())
	}
	if err != nil && raw == "" {
		c.recordLog("chat", fullURL, body, code, raw, "", false, "", err.Error(), start, ctx)
		return "", err
	}
	root := tryParseSSE(raw)
	if !root.Exists() {
		root = tryParseJSON(raw)
	}
	if !root.Exists() {
		msg := strings.TrimSpace(raw)
		if msg == "" {
			msg = "上游返回为空"
		}
		if len(msg) > 200 {
			msg = msg[:200] + "..."
		}
		c.recordLog("chat", fullURL, body, code, raw, "", false, "", msg, start, ctx)
		return "", fmt.Errorf("%s", msg)
	}
	if isFailed(root) || code >= 400 {
		msg := errorMessage(root, code)
		c.recordLog("chat", fullURL, body, code, raw, root.Get("id").String(), false, "", msg, start, ctx)
		return "", fmt.Errorf("%s", msg)
	}
	content := extractChatContent(root)
	if !hasText(content) {
		msg := "上游未返回聊天内容"
		c.recordLog("chat", fullURL, body, code, raw, root.Get("id").String(), false, "", msg, start, ctx)
		return "", fmt.Errorf("%s", msg)
	}
	c.recordLog("chat", fullURL, body, code, raw, root.Get("id").String(), true, "", "", start, ctx)
	return content, nil
}

// submitAndResolve 单结果包装（视频/单图复用）。
func (c *relayClient) submitAndResolve(p *model.AiProvider, path string, body map[string]interface{}, ctx logCtx) (string, error) {
	urls, err := c.submitAndResolveMulti(p, path, body, ctx)
	if err != nil {
		return "", err
	}
	return first(urls), nil
}

// submitAndResolveMulti 提交并解析（多图）：兼容 200 同步 / 202 异步轮询；502/503 退避重试。
// 对齐 AiRelayClient.submitAndResolveMulti。
func (c *relayClient) submitAndResolveMulti(p *model.AiProvider, path string, body map[string]interface{}, ctx logCtx) ([]string, error) {
	start := time.Now()
	fullURL := baseURL(p) + path
	var lastErr error
	var lastRaw string

	for attempt := 0; attempt <= c.cfg.RelayMaxRetries; attempt++ {
		if attempt > 0 {
			delay := c.cfg.RelayRetryDelayMs * (int64(1) << uint(attempt-1)) // 退避：1.5s, 3s, ...
			if c.logger != nil {
				c.logger.Warnf("上游 %s 返回瞬态错误，第 %d 次重试（等待 %dms）", path, attempt, delay)
			}
			time.Sleep(time.Duration(delay) * time.Millisecond)
		}
		resp, err := c.http.R().
			SetHeader("Authorization", "Bearer "+p.APIKey).
			SetHeader("Content-Type", "application/json").
			SetBody(body).
			Post(fullURL)
		code := 0
		var raw string
		if resp != nil {
			code = resp.StatusCode()
			raw = string(resp.Body())
		}
		if err != nil && raw == "" {
			// 网络层错误（无响应体）
			lastErr = err
			if attempt < c.cfg.RelayMaxRetries {
				continue
			}
			c.recordLog(operationOf(path, body), fullURL, body, code, raw, "", false, "", err.Error(), start, ctx)
			return nil, err
		}
		lastRaw = raw
		root := tryParseSSE(raw)
		if !root.Exists() {
			root = tryParseJSON(raw)
		}
		upstreamTaskID := ""
		if root.Exists() {
			upstreamTaskID = root.Get("id").String()
		}
		urls, finalRaw, rerr := c.resolveResult(p, code, raw, root)
		if rerr == nil {
			c.recordLog(operationOf(path, body), fullURL, body, code, finalRaw, upstreamTaskID, true, first(urls), "", start, ctx)
			return urls, nil
		}
		lastErr = rerr
		if (code == 502 || code == 503) && attempt < c.cfg.RelayMaxRetries {
			continue
		}
		c.recordLog(operationOf(path, body), fullURL, body, code, raw, upstreamTaskID, false, "", rerr.Error(), start, ctx)
		return nil, rerr
	}
	msg := "上游 502 重试耗尽"
	if lastErr != nil {
		msg = lastErr.Error()
	}
	c.recordLog(operationOf(path, body), fullURL, body, 502, lastRaw, "", false, "", msg, start, ctx)
	if lastErr != nil {
		return nil, lastErr
	}
	return nil, errors.New("上游 502 重试耗尽")
}

// resolveResult 解析上游响应：同步媒体地址(可多张) / 失败信封 / 202 异步轮询。
// 返回 (urls, 产生它的最终响应原文, err)。对齐 AiRelayClient.resolveResult。
func (c *relayClient) resolveResult(p *model.AiProvider, code int, raw string, root gjson.Result) ([]string, string, error) {
	if !root.Exists() {
		snippet := strings.ReplaceAll(strings.TrimSpace(raw), "\n", " | ")
		if snippet == "" {
			snippet = "(empty)"
		}
		if len(snippet) > 200 {
			snippet = snippet[:200] + "..."
		}
		return nil, raw, fmt.Errorf("%s", snippet)
	}
	urls := extractURLs(root)
	if len(urls) > 0 {
		return urls, raw, nil
	}
	if isFailed(root) || code >= 400 {
		return nil, raw, fmt.Errorf("%s", errorMessage(root, code))
	}
	taskID := root.Get("id").String()
	if hasText(taskID) {
		return c.pollTask(p, taskID)
	}
	return nil, raw, fmt.Errorf("上游返回无法解析: HTTP %d", code)
}

// pollTask 轮询异步任务：GET {baseUrl}/tasks/{id} 直到 succeeded/failed 或超时。
// 对齐 AiRelayClient.pollTask。
func (c *relayClient) pollTask(p *model.AiProvider, taskID string) ([]string, string, error) {
	deadline := time.Now().Add(time.Duration(c.cfg.RelayPollTimeoutMs) * time.Millisecond)
	path := "/tasks/" + taskID
	for time.Now().Before(deadline) {
		resp, _ := c.http.R().
			SetHeader("Authorization", "Bearer "+p.APIKey).
			Get(baseURL(p) + path)
		code := 0
		var raw string
		if resp != nil {
			code = resp.StatusCode()
			raw = string(resp.Body())
		}
		root := tryParseJSON(raw)
		if code == 404 {
			return nil, raw, fmt.Errorf("上游任务不存在: %s", taskID)
		}
		if code == 403 {
			return nil, raw, fmt.Errorf("无权访问上游任务: %s", taskID)
		}
		if root.Exists() {
			status := root.Get("status").String()
			if strings.EqualFold(status, "succeeded") {
				urls := extractURLs(root)
				if len(urls) > 0 {
					return urls, raw, nil
				}
				return nil, raw, fmt.Errorf("任务成功但未返回结果地址: %s", taskID)
			}
			if strings.EqualFold(status, "failed") || isFailed(root) {
				return nil, raw, fmt.Errorf("%s", errorMessage(root, code))
			}
			// queued / processing → 继续轮询
		}
		time.Sleep(time.Duration(c.cfg.RelayPollIntervalMs) * time.Millisecond)
	}
	return nil, "", fmt.Errorf("上游任务超时未完成: %s", taskID)
}

// recordLog 记录一次上游调用日志（best-effort）。
func (c *relayClient) recordLog(operation, url string, body map[string]interface{}, status int, respBody, upstreamTaskID string, success bool, resultURL, errMsg string, start time.Time, ctx logCtx) {
	if c.sink == nil {
		return
	}
	lg := upstreamLog{
		Operation:      operation,
		OperationType:  "ai_generate",
		RequestURL:     url,
		Model:          strOf(body["model"]),
		RequestBody:    jsonString(body),
		ResponseBody:   respBody,
		UpstreamTaskID: upstreamTaskID,
		Success:        success,
		ResultURL:      resultURL,
		ErrorMsg:       errMsg,
		DurationMs:     time.Since(start).Milliseconds(),
	}
	st := status
	lg.HTTPStatus = &st
	c.sink.sink(lg, ctx)
	if ctx.recorded != nil {
		*ctx.recorded = true
	}
}

// resolveModelName 发送给供应商的模型名：优先 modelID，其次该供应商下启用模型，最后兜底（对齐 resolveModelName）。
func (c *relayClient) resolveModelName(modelID string, p *model.AiProvider, fallback string) string {
	if hasText(modelID) && modelID != "default" {
		return modelID
	}
	m, err := c.repo.FirstEnabledModelByProvider(p.ID)
	if err == nil && m != nil && hasText(m.ModelID) {
		return m.ModelID
	}
	return fallback
}

// ---- 参数构建（对齐 AiRelayClient 各 applyXxx）----

func (c *relayClient) applyImageParams(body, input map[string]interface{}) {
	c.applyAspectParam(body, input, "1:1", "aspect")
	c.applyCommonParams(body, input)
}

func (c *relayClient) applyEditParams(body, input map[string]interface{}) {
	c.applyAspectParam(body, input, "", "aspect")
	c.applyCommonParams(body, input)
}

func (c *relayClient) applyAspectParam(body, input map[string]interface{}, defaultValue, field string) {
	aspect := aspectOf(input, defaultValue)
	if hasText(aspect) && aspect != "auto" {
		body[field] = aspect
	}
}

func (c *relayClient) applyCommonParams(body, input map[string]interface{}) {
	quality := strOf(input["quality"])
	if hasText(quality) {
		body["quality"] = mapQuality(quality)
	}
	resolution := resolutionOf(input)
	if hasText(resolution) {
		body["resolution"] = resolution
		modelName := strOf(body["model"])
		if hasText(modelName) && strings.Contains(strings.ToLower(modelName), "seedream") {
			body["quality"] = strings.ToUpper(resolution)
		}
	}
}

// applyBatchCount 出图张数 n：clamp [1,4]，仅 >1 时下发（对齐 applyBatchCount）。
func (c *relayClient) applyBatchCount(body, input map[string]interface{}) {
	n := batchCountOf(input)
	if _, hasBC := input["batchCount"]; !hasBC {
		if _, hasN := input["n"]; !hasN {
			return // 未显式传张数，不下发 n（OpenAI 默认 1）
		}
	}
	if n > 1 {
		body["n"] = n
	}
}

// listOpenAIModels 拉取 OpenAI 风格 /models 列表并返回排序后的模型 id 列表
// （对齐 AdminAiController.listRemoteModels 的非 runware 分支）。
func (c *relayClient) listOpenAIModels(p *model.AiProvider) ([]string, error) {
	endpoint := baseURL(p) + "/models"
	resp, err := c.http.R().
		SetHeader("Authorization", "Bearer "+p.APIKey).
		Get(endpoint)
	if err != nil {
		return nil, fmt.Errorf("%v", err)
	}
	raw := ""
	if resp != nil {
		raw = string(resp.Body())
	}
	root := tryParseJSON(raw)
	if !root.Exists() {
		return nil, fmt.Errorf("无法解析模型列表响应")
	}
	// 兼容 { "data": [ {"id": "..."} ] } 与直接返回数组
	data := root.Get("data")
	if root.IsArray() {
		data = root
	}
	var ids []string
	for _, m := range data.Array() {
		if mid := m.Get("id").String(); hasText(mid) {
			ids = append(ids, mid)
		}
	}
	sortStringsFold(ids)
	return ids, nil
}

// normalizeEditImageURLs 过滤空值/去重/限量（对齐 normalizeEditImageUrls）。
func (c *relayClient) normalizeEditImageURLs(imageURLs []string) ([]string, error) {
	if imageURLs == nil {
		return nil, fmt.Errorf("image_urls不能为空")
	}
	urls := dedupLimit(imageURLs, maxEditImageURLs)
	if len(urls) == 0 {
		return nil, fmt.Errorf("image_urls不能为空")
	}
	return urls, nil
}

// =====================================================================
// runwareClient：Runware 原生 API 客户端（请求体为「任务数组」）
// 对齐 RunwareClient：imageInference（同步）/ videoInference（async + getResponse 轮询）/ audioInference。
// =====================================================================

type runwareClient struct {
	repo   *Repository
	cfg    ClientConfig
	sink   logSink
	logger *logrus.Logger
	http   *resty.Client
}

func newRunwareClient(repo *Repository, cfg ClientConfig, sink logSink, logger *logrus.Logger) *runwareClient {
	c := resty.New().
		SetTimeout(time.Duration(cfg.RunwareReadTimeoutMs)*time.Millisecond).
		SetHeader("Accept", "application/json")
	return &runwareClient{repo: repo, cfg: cfg, sink: sink, logger: logger, http: c}
}

// 文生图比例 → 尺寸（64 对齐，约 1MP 基准档），对齐 RunwareClient.IMAGE_SIZES。
var imageSizes = map[string][2]int{
	"1:1":  {1024, 1024},
	"16:9": {1344, 768},
	"9:16": {768, 1344},
	"4:3":  {1152, 896},
	"3:4":  {896, 1152},
	"3:2":  {1216, 832},
	"2:3":  {832, 1216},
	"21:9": {1536, 640},
	"2:1":  {1408, 704},
}

// 视频比例 → 尺寸（720p 档），对齐 RunwareClient.VIDEO_SIZES。
var videoSizes = map[string][2]int{
	"16:9": {1280, 720},
	"9:16": {720, 1280},
	"1:1":  {960, 960},
	"4:3":  {1104, 832},
	"3:4":  {832, 1104},
	"21:9": {1680, 720},
}

// generate 文生图：imageInference，返回图片 URL 列表（numberResults 一次多张）。
func (c *runwareClient) generate(p *model.AiProvider, modelID, prompt string, input map[string]interface{}, _ progressReporter, ctx logCtx) ([]string, error) {
	task := c.baseImageTask(modelID, prompt, input)
	size := c.imageSizeOf(input)
	task["width"] = size[0]
	task["height"] = size[1]
	c.mergeModelExtras(task, p.ID, modelID)
	return c.submitImage(p, task, ctx)
}

// edit 图生图/编辑：imageInference + referenceImages（编辑模型）或 seedImage（config.img2img=true）。
func (c *runwareClient) edit(p *model.AiProvider, modelID, prompt string, imageURLs []string, input map[string]interface{}, _ progressReporter, ctx logCtx) ([]string, error) {
	if len(imageURLs) == 0 {
		return nil, fmt.Errorf("image_urls不能为空")
	}
	urls := dedupLimit(imageURLs, maxReferenceImages)
	task := c.baseImageTask(modelID, prompt, input)
	if c.modelConfigFlag(p.ID, modelID, "img2img") {
		// 经典重绘：seedImage + strength（SD 系 checkpoint）
		task["seedImage"] = urls[0]
		strength := 0.8
		if s, ok := input["strength"].(float64); ok {
			strength = s
		}
		task["strength"] = strength
		size := c.imageSizeOf(input)
		task["width"] = size[0]
		task["height"] = size[1]
	} else {
		// 编辑模型（FLUX Kontext / Seedream Edit / Qwen-Image-Edit 等）：全部输入作为 referenceImages
		task["referenceImages"] = urls
	}
	c.mergeModelExtras(task, p.ID, modelID)
	return c.submitImage(p, task, ctx)
}

// generateVideo 视频任务：videoInference 异步受理 + getResponse 轮询，返回最终视频 URL。
func (c *runwareClient) generateVideo(p *model.AiProvider, modelID, prompt string, input map[string]interface{}, pr progressReporter, ctx logCtx) (string, error) {
	taskUUID := newUUID()
	task := map[string]interface{}{
		"taskType":       "videoInference",
		"taskUUID":       taskUUID,
		"model":          modelID,
		"deliveryMethod": "async",
		"includeCost":    true,
	}
	if hasText(prompt) {
		task["positivePrompt"] = prompt
	}
	if d := durationInt(input); d != nil {
		task["duration"] = *d
	}
	size := c.videoSizeOf(input)
	task["width"] = size[0]
	task["height"] = size[1]

	// 媒体参数：参考模式(全能参考) 与 首尾帧模式 互斥。
	// v2 模型要求嵌套在 inputs 对象下（config "videoInputs":true），frameImages 用 {image,frame}；
	// 旧模型顶层平铺 + {inputImage,frame}。
	wrapInputs := c.modelConfigFlag(p.ID, modelID, "videoInputs")
	media := map[string]interface{}{}
	refImages := collectURLList(input["references"], maxReferenceImages)
	refVideos := collectURLList(input["videoReferences"], 3)

	if len(refImages) > 0 || len(refVideos) > 0 {
		if len(refImages) > 0 {
			media["referenceImages"] = refImages
		}
		if len(refVideos) > 0 {
			media["referenceVideos"] = refVideos
		}
	} else {
		frames := make([]interface{}, 0, 2)
		firstFrame := input["firstFrame"]
		if firstFrame == nil {
			firstFrame = input["sourceImage"]
		}
		if s := strOf(firstFrame); hasText(s) {
			frames = append(frames, frameEntry(s, "first", wrapInputs))
		}
		if s := strOf(input["lastFrame"]); hasText(s) {
			frames = append(frames, frameEntry(s, "last", wrapInputs))
		}
		if len(frames) > 0 {
			media["frameImages"] = frames
		}
	}
	if wrapInputs {
		if len(media) > 0 {
			task["inputs"] = media
		}
	} else {
		for k, v := range media {
			task[k] = v
		}
	}
	c.mergeModelExtras(task, p.ID, modelID)

	start := time.Now()
	fullURL := baseURL(p)
	code, raw, root := c.post(p, []interface{}{task})

	// 提交即被拒（HTTP 4xx 或 errors[]）→ 立即带真实原因失败，不去轮询根本没受理的任务。
	submitErr := errorFor(root, "")
	if submitErr == "" && code >= 400 {
		submitErr = c.errorMessage(code, raw, root)
	}
	if submitErr != "" {
		c.recordLog("runware_video", fullURL, task, code, raw, taskUUID, false, "", submitErr, nil, start, ctx)
		return "", fmt.Errorf("%s", submitErr)
	}

	// 同步直接返回（个别短任务）：拿到 videoURL 即完成
	node := firstDataNode(root)
	if direct := node.Get("videoURL").String(); hasText(direct) {
		c.recordLog("runware_video", fullURL, task, code, raw, taskUUID, true, direct, "", sumCost(root), start, ctx)
		return direct, nil
	}
	url, cost, perr := c.pollMedia(p, taskUUID, "videoURL", pr)
	if perr != nil {
		c.recordLog("runware_video", fullURL, task, code, raw, taskUUID, false, "", perr.Error(), nil, start, ctx)
		return "", perr
	}
	c.recordLog("runware_video", fullURL, task, code, raw, taskUUID, true, url, "", cost, start, ctx)
	return url, nil
}

// generateAudio 语音合成：audioInference（speech.text + speech.voice），同步返回音频 URL。
func (c *runwareClient) generateAudio(p *model.AiProvider, modelID, text string, input map[string]interface{}, pr progressReporter, ctx logCtx) (string, error) {
	taskUUID := newUUID()
	speech := map[string]interface{}{"text": text}
	if v := strOf(input["voice"]); hasText(v) {
		speech["voice"] = v
	}
	task := map[string]interface{}{
		"taskType":       "audioInference",
		"taskUUID":       taskUUID,
		"model":          modelID,
		"speech":         speech,
		"outputType":     "URL",
		"outputFormat":   "MP3",
		"deliveryMethod": "sync",
		"includeCost":    true,
	}
	c.mergeModelExtras(task, p.ID, modelID)

	start := time.Now()
	fullURL := baseURL(p)
	code, raw, root := c.post(p, []interface{}{task})
	if errMsg := errorFor(root, ""); errMsg != "" {
		c.recordLog("runware_audio", fullURL, task, code, raw, taskUUID, false, "", errMsg, nil, start, ctx)
		return "", fmt.Errorf("%s", errMsg)
	}
	if code >= 400 {
		errMsg := c.errorMessage(code, raw, root)
		c.recordLog("runware_audio", fullURL, task, code, raw, taskUUID, false, "", errMsg, nil, start, ctx)
		return "", fmt.Errorf("%s", errMsg)
	}
	node := firstDataNode(root)
	if url := node.Get("audioURL").String(); hasText(url) {
		c.recordLog("runware_audio", fullURL, task, code, raw, taskUUID, true, url, "", sumCost(root), start, ctx)
		return url, nil
	}
	// 个别模型按异步受理：轮询取回
	url, cost, perr := c.pollMedia(p, taskUUID, "audioURL", pr)
	if perr != nil {
		c.recordLog("runware_audio", fullURL, task, code, raw, taskUUID, false, "", perr.Error(), nil, start, ctx)
		return "", perr
	}
	c.recordLog("runware_audio", fullURL, task, code, raw, taskUUID, true, url, "", cost, start, ctx)
	return url, nil
}

// baseImageTask 公共 imageInference 任务体（对齐 RunwareClient.baseImageTask）。
func (c *runwareClient) baseImageTask(modelID, prompt string, input map[string]interface{}) map[string]interface{} {
	return map[string]interface{}{
		"taskType":       "imageInference",
		"taskUUID":       newUUID(),
		"model":          modelID,
		"positivePrompt": prompt,
		"numberResults":  batchCountOf(input),
		"outputType":     "URL",
		"outputFormat":   "PNG",
		"includeCost":    true,
	}
}

// submitImage 提交图像任务并解析（同步返回 data[].imageURL，对齐 submitImage）。
func (c *runwareClient) submitImage(p *model.AiProvider, task map[string]interface{}, ctx logCtx) ([]string, error) {
	start := time.Now()
	fullURL := baseURL(p)
	code, raw, root := c.post(p, []interface{}{task})
	var urls []string
	for _, item := range root.Get("data").Array() {
		if u := item.Get("imageURL").String(); hasText(u) {
			urls = append(urls, u)
		}
	}
	if len(urls) == 0 {
		errMsg := c.errorMessage(code, raw, root)
		c.recordLog("runware_image", fullURL, task, code, raw, strOf(task["taskUUID"]), false, "", errMsg, nil, start, ctx)
		return nil, fmt.Errorf("%s", errMsg)
	}
	c.recordLog("runware_image", fullURL, task, code, raw, strOf(task["taskUUID"]), true, urls[0], "", sumCost(root), start, ctx)
	return urls, nil
}

// pollMedia 轮询 getResponse 直到 success / error / 超时；urlField 为结果地址字段名（videoURL / audioURL）。
// 对齐 RunwareClient.pollMedia。返回 (url, cost, err)。
func (c *runwareClient) pollMedia(p *model.AiProvider, taskUUID, urlField string, pr progressReporter) (string, *decimal.Decimal, error) {
	deadline := time.Now().Add(time.Duration(c.cfg.RunwarePollTimeoutMs) * time.Millisecond)
	poll := map[string]interface{}{"taskType": "getResponse", "taskUUID": taskUUID}
	for time.Now().Before(deadline) {
		time.Sleep(time.Duration(c.cfg.RunwarePollIntervalMs) * time.Millisecond)
		_, _, root := c.post(p, []interface{}{poll})
		if !root.Exists() {
			continue
		}
		if errMsg := errorFor(root, taskUUID); errMsg != "" {
			return "", nil, fmt.Errorf("%s", errMsg)
		}
		for _, item := range root.Get("data").Array() {
			if item.Get("taskUUID").String() != taskUUID {
				continue
			}
			status := item.Get("status").String()
			if u := item.Get(urlField).String(); hasText(u) {
				var cost *decimal.Decimal
				if cn := item.Get("cost"); cn.Exists() && (cn.Type == gjson.Number) {
					d := decimal.NewFromFloat(cn.Float())
					cost = &d
				}
				return u, cost, nil
			}
			if strings.EqualFold(status, "error") {
				return "", nil, fmt.Errorf("上游任务失败: %s", item.Get("error.message").String())
			}
			// queued / processing → 回写实时进度让前端「生成情况」可见，然后继续轮询
			if prog := item.Get("progress"); prog.Exists() && prog.Type == gjson.Number {
				v := int(prog.Int())
				if v < 1 {
					v = 1
				}
				if v > 99 {
					v = 99
				}
				if pr != nil {
					pr.report(v)
				}
			}
		}
	}
	return "", nil, fmt.Errorf("上游任务超时未完成: %s", taskUUID)
}

// searchModels 模型搜索（管理后台「模型选择」用）：返回 AIR 标识列表（对齐 RunwareClient.searchModels）。
func (c *runwareClient) searchModels(p *model.AiProvider, search string) ([]string, error) {
	task := map[string]interface{}{
		"taskType": "modelSearch",
		"taskUUID": newUUID(),
		"limit":    50,
	}
	if hasText(search) {
		task["search"] = search
	}
	code, raw, root := c.post(p, []interface{}{task})
	var models []string
	data := firstDataNode(root)
	for _, m := range data.Get("results").Array() {
		if air := m.Get("air").String(); hasText(air) {
			models = append(models, air)
		}
	}
	if len(models) == 0 && code >= 400 {
		return nil, fmt.Errorf("%s", c.errorMessage(code, raw, root))
	}
	return models, nil
}

// post 发送任务数组到 Runware（POST {baseUrl}），返回 (code, raw, root)。对齐 RunwareClient.post。
func (c *runwareClient) post(p *model.AiProvider, tasks []interface{}) (int, string, gjson.Result) {
	resp, _ := c.http.R().
		SetHeader("Authorization", "Bearer "+p.APIKey).
		SetHeader("Content-Type", "application/json").
		SetBody(tasks).
		Post(baseURL(p))
	code := 0
	var raw string
	if resp != nil {
		code = resp.StatusCode()
		raw = string(resp.Body())
	}
	var root gjson.Result
	if hasText(raw) && gjson.Valid(raw) {
		root = gjson.Parse(raw)
	}
	return code, raw, root
}

// errorMessage 解析 Runware 错误（errors[] 优先，否则原文截断），对齐 RunwareClient.errorMessage。
func (c *runwareClient) errorMessage(code int, raw string, root gjson.Result) string {
	if root.Exists() {
		if e := errorFor(root, ""); e != "" {
			return e
		}
	}
	snippet := strings.ReplaceAll(strings.TrimSpace(raw), "\n", " | ")
	if snippet == "" {
		snippet = "(empty)"
	}
	if len(snippet) > 200 {
		snippet = snippet[:200] + "..."
	}
	return fmt.Sprintf("Runware 返回无法解析: HTTP %d %s", code, snippet)
}

// recordLog 记录一次 Runware 上游调用日志（best-effort）。
func (c *runwareClient) recordLog(operation, url string, body map[string]interface{}, status int, respBody, upstreamTaskID string, success bool, resultURL, errMsg string, cost *decimal.Decimal, start time.Time, ctx logCtx) {
	if c.sink == nil {
		return
	}
	lg := upstreamLog{
		Operation:      operation,
		OperationType:  "ai_generate",
		RequestURL:     url,
		Model:          strOf(body["model"]),
		RequestBody:    jsonString(body),
		ResponseBody:   respBody,
		UpstreamTaskID: upstreamTaskID,
		Success:        success,
		ResultURL:      resultURL,
		ErrorMsg:       errMsg,
		Cost:           cost,
		DurationMs:     time.Since(start).Milliseconds(),
	}
	st := status
	lg.HTTPStatus = &st
	c.sink.sink(lg, ctx)
	if ctx.recorded != nil {
		*ctx.recorded = true
	}
}

// ---- Runware 参数构建 ----

func (c *runwareClient) imageSizeOf(input map[string]interface{}) [2]int {
	aspect := aspectOf(input, "1:1")
	base, ok := imageSizes[aspect]
	if !ok {
		base = imageSizes["1:1"]
	}
	mul := 1.0
	switch resolutionOf(input) {
	case "2k":
		mul = 1.5
	case "4k":
		mul = 2.0
	}
	return [2]int{snap64(float64(base[0]) * mul), snap64(float64(base[1]) * mul)}
}

func (c *runwareClient) videoSizeOf(input map[string]interface{}) [2]int {
	aspect := aspectOf(input, "16:9")
	base, ok := videoSizes[aspect]
	if !ok {
		base = videoSizes["16:9"]
	}
	return base
}

// snap64 64 对齐并夹在 [256, 2048]（对齐 RunwareClient.snap64）。
func snap64(v float64) int {
	snapped := int(math.Round(v/64.0)) * 64
	if snapped < 256 {
		snapped = 256
	}
	if snapped > 2048 {
		snapped = 2048
	}
	return snapped
}

// modelConfigFlag 模型 config 的布尔开关（img2img / videoInputs）。
func (c *runwareClient) modelConfigFlag(providerID int64, modelID, key string) bool {
	cfg := c.modelConfig(providerID, modelID)
	return cfg.Exists() && cfg.Get(key).Bool()
}

// mergeModelExtras 模型 config.runware 对象 → 原样合并进任务体（steps/CFGScale/providerSettings 等透传逃生门）。
func (c *runwareClient) mergeModelExtras(task map[string]interface{}, providerID int64, modelID string) {
	cfg := c.modelConfig(providerID, modelID)
	if !cfg.Exists() {
		return
	}
	extras := cfg.Get("runware")
	if !extras.IsObject() {
		return
	}
	extras.ForEach(func(k, v gjson.Result) bool {
		task[k.String()] = v.Value()
		return true
	})
}

// modelConfig 读取模型 config（JSON），解析失败/无配置返回不存在的 Result。
func (c *runwareClient) modelConfig(providerID int64, modelID string) gjson.Result {
	if !hasText(modelID) || modelID == "default" {
		return gjson.Result{}
	}
	if providerID != 0 {
		upstream, err := c.repo.FindUpstreamModelByProviderAndModelID(providerID, modelID)
		if err == nil && upstream != nil && len(upstream.Config) > 0 {
			s := string(upstream.Config)
			if gjson.Valid(s) {
				return gjson.Parse(s)
			}
		}
	}
	m, err := c.repo.FindModelByModelID(modelID)
	if err != nil || m == nil || len(m.Config) == 0 {
		return gjson.Result{}
	}
	s := string(m.Config)
	if !gjson.Valid(s) {
		return gjson.Result{}
	}
	return gjson.Parse(s)
}
