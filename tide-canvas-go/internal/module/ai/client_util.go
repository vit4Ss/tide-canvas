package ai

import (
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"github.com/tidwall/gjson"

	"github.com/tidecanvas/tide-canvas-go/internal/model"
)

// parseFloat 解析十进制浮点数。
func parseFloat(s string) (float64, error) {
	return strconv.ParseFloat(strings.TrimSpace(s), 64)
}

// roundHalfUp 四舍五入（对齐 Java Math.round 语义）。
func roundHalfUp(f float64) float64 {
	return math.Floor(f + 0.5)
}

// ===== 上游响应解析 / 参数归一化的共享辅助（Relay 与 Runware 共用）=====

// baseURL 去掉供应商 baseUrl 尾部斜杠（对齐 baseUrl(provider)）。
func baseURL(p *model.AiProvider) string {
	return strings.TrimRight(p.BaseURL, "/")
}

// first 取列表首个，空则 ""。
func first(list []string) string {
	if len(list) == 0 {
		return ""
	}
	return list[0]
}

// putIfText 非空白才写入。
func putIfText(body map[string]interface{}, key, value string) {
	if hasText(value) {
		body[key] = value
	}
}

// jsonString 序列化为 JSON 字符串，失败回退 fmt（对齐 objectMapper.writeValueAsString + catch）。
func jsonString(v interface{}) string {
	b, err := json.Marshal(v)
	if err != nil {
		return fmt.Sprintf("%v", v)
	}
	return string(b)
}

// newUUID 生成 UUID v4 字符串（Runware taskUUID）。
func newUUID() string { return uuid.NewString() }

// dedupLimit 过滤空白、strip、去重、限量（对齐 normalizeEditImageUrls / collectUrlList 去重逻辑）。
func dedupLimit(urls []string, max int) []string {
	out := make([]string, 0, len(urls))
	seen := make(map[string]struct{}, len(urls))
	for _, u := range urls {
		s := strings.TrimSpace(u)
		if s == "" {
			continue
		}
		if _, dup := seen[s]; dup {
			continue
		}
		seen[s] = struct{}{}
		out = append(out, s)
		if len(out) >= max {
			break
		}
	}
	return out
}

// collectURLList 从 input 的某个 List 字段收集去重的 URL 列表（限量），对齐 collectUrlList。
func collectURLList(value interface{}, max int) []string {
	list, ok := value.([]interface{})
	if !ok {
		return nil
	}
	out := make([]string, 0, len(list))
	for _, r := range list {
		s := strings.TrimSpace(strOf(r))
		if !hasText(s) {
			continue
		}
		if contains(out, s) {
			continue
		}
		if len(out) >= max {
			break
		}
		out = append(out, s)
	}
	return out
}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

// frameEntry 单个首尾帧条目：v2(inputs) 用 {image,frame}，旧模型用 {inputImage,frame}（对齐 frameEntry）。
func frameEntry(url, frame string, wrapInputs bool) map[string]interface{} {
	if wrapInputs {
		return map[string]interface{}{"image": url, "frame": frame}
	}
	return map[string]interface{}{"inputImage": url, "frame": frame}
}

// ---- 比例 / 清晰度 / 时长归一（Relay 与 Runware 共用，对齐两 client 的同名私有方法）----

// aspectOf 比例：input.aspectRatio / aspect_ratio / aspect，缺省 defaultValue；"auto" 视为缺省（仅 Runware 需要，
// 但 Relay 自己另判 auto，故这里仅在传入时回退）。
func aspectOf(input map[string]interface{}, defaultValue string) string {
	r := input["aspectRatio"]
	if r == nil {
		r = input["aspect_ratio"]
	}
	if r == nil {
		r = input["aspect"]
	}
	s := strOf(r)
	if r == nil {
		return defaultValue
	}
	// Runware 侧：auto 归默认；Relay 侧 applyAspectParam 仍会再判一次 auto 不下发，行为一致。
	if !hasText(s) || s == "auto" {
		return defaultValue
	}
	return s
}

// ratioOf 视频比例（默认 1:1，对齐 AiRelayClient.ratioOf → aspectOf(input,"1:1")）。
func ratioOf(input map[string]interface{}) string {
	return aspectOf(input, "1:1")
}

// resolutionOf 清晰度：input.resolution 优先，其次 input.clarity，转小写（对齐两 client.resolutionOf）。
func resolutionOf(input map[string]interface{}) string {
	r := input["resolution"]
	if r == nil {
		r = input["clarity"]
	}
	if r == nil {
		return ""
	}
	return strings.ToLower(strOf(r))
}

// durationStr 视频时长归一为「Ns」（Relay）：数字 5 → "5s"，"5.0" → "5s"，已带 s 则原样。
// 对齐 AiRelayClient.durationOf。
var durationNumRe = regexp.MustCompile(`^\d+(\.\d+)?$`)
var trailingZeroRe = regexp.MustCompile(`\.0+$`)

func durationStr(input map[string]interface{}) string {
	d := input["duration"]
	if d == nil {
		return ""
	}
	s := strings.TrimSpace(strOf(d))
	if s == "" {
		return ""
	}
	if durationNumRe.MatchString(s) {
		return trailingZeroRe.ReplaceAllString(s, "") + "s"
	}
	return s
}

// durationInt 视频时长归一为整数秒（Runware）："5s" / 5 / "5.0" → 5。对齐 RunwareClient.durationOf。
func durationInt(input map[string]interface{}) *int {
	d := input["duration"]
	if d == nil {
		return nil
	}
	s := strings.TrimRight(strings.TrimSpace(strOf(d)), "sS")
	f, err := parseFloat(s)
	if err != nil {
		return nil
	}
	n := int(roundHalfUp(f))
	return &n
}

// mapQuality 前端画质 {low, standard, high} → 中转站 {low, medium, high}（对齐 mapQuality）。
func mapQuality(quality string) string {
	if quality == "standard" {
		return "medium"
	}
	return quality
}

// buildVideoContent 构建 Relay 视频媒体 content[]（仅媒体项，对齐 AiRelayClient.buildVideoContent）。
func buildVideoContent(input map[string]interface{}) []map[string]interface{} {
	content := make([]map[string]interface{}, 0, 4)
	// 首帧：优先 firstFrame，其次 sourceImage（图生视频）
	firstFrame := input["firstFrame"]
	if firstFrame == nil {
		firstFrame = input["sourceImage"]
	}
	addImageContent(&content, firstFrame, "first_frame")
	addImageContent(&content, input["lastFrame"], "last_frame")
	addImageContent(&content, input["referenceImage"], "reference_image")
	// 多张参考图（图片参考 / 全能参考）：每张作为一个 reference_image
	if list, ok := input["references"].([]interface{}); ok {
		for _, r := range list {
			addImageContent(&content, r, "reference_image")
		}
	}
	// 视频参考（全能参考）：每个视频作为一个 reference_video
	if list, ok := input["videoReferences"].([]interface{}); ok {
		for _, v := range list {
			addVideoContent(&content, v, "reference_video")
		}
	}
	return content
}

func addImageContent(content *[]map[string]interface{}, url interface{}, role string) {
	s := strOf(url)
	if !hasText(s) {
		return
	}
	*content = append(*content, map[string]interface{}{
		"type":      "image_url",
		"image_url": map[string]interface{}{"url": s},
		"role":      role,
	})
}

func addVideoContent(content *[]map[string]interface{}, url interface{}, role string) {
	s := strOf(url)
	if !hasText(s) {
		return
	}
	*content = append(*content, map[string]interface{}{
		"type":      "video_url",
		"video_url": map[string]interface{}{"url": s},
		"role":      role,
	})
}

// ---- Relay 响应字段提取（对齐 AiRelayClient.extractUrls / isFailed / errorMessage）----

// extractURLs 从响应提取媒体地址列表，兼容多种「带资源」结构体：
// OpenAI 风格 data[].url / b64_json；任务完成响应资源数组 urls / image_urls / results / attachments /
// output.image_urls；单图兜底 output_url。
func extractURLs(root gjson.Result) []string {
	urls := make([]string, 0, 4)
	// 1) OpenAI 风格 data[]
	data := root.Get("data")
	if data.IsArray() {
		for _, item := range data.Array() {
			if u := item.Get("url"); u.Exists() && hasText(u.String()) {
				urls = append(urls, u.String())
			} else if b := item.Get("b64_json"); b.Exists() && hasText(b.String()) {
				urls = append(urls, "data:image/png;base64,"+b.String())
			}
		}
	}
	// 2) 任务完成响应常见资源数组字段
	if len(urls) == 0 {
		collectURLArray(root.Get("urls"), &urls)
		collectURLArray(root.Get("image_urls"), &urls)
		collectURLArray(root.Get("results"), &urls)
		collectURLArray(root.Get("attachments"), &urls)
		collectURLArray(root.Get("output.image_urls"), &urls)
	}
	// 3) 单图兜底：output_url（如 Midjourney merged 四宫格合图）
	if len(urls) == 0 {
		if u := root.Get("output_url"); u.Exists() && hasText(u.String()) {
			urls = append(urls, u.String())
		}
	}
	return urls
}

// collectURLArray 从数组节点收集媒体地址：兼容字符串数组与对象数组取 url（对齐 collectUrlArray）。
func collectURLArray(node gjson.Result, urls *[]string) {
	if !node.IsArray() {
		return
	}
	for _, item := range node.Array() {
		if item.Type == gjson.String && hasText(item.String()) {
			*urls = append(*urls, item.String())
		} else if u := item.Get("url"); u.Exists() && hasText(u.String()) {
			*urls = append(*urls, u.String())
		}
	}
}

// isFailed 是否失败响应（OpenAI 错误信封 error 对象 或 status=failed），对齐 isFailed。
func isFailed(root gjson.Result) bool {
	if root.Get("error").IsObject() {
		return true
	}
	return strings.EqualFold(root.Get("status").String(), "failed")
}

// errorMessage 解析错误信息：error.message / error_message / 原始文本 / 兜底（对齐 errorMessage）。
func errorMessage(root gjson.Result, code int) string {
	err := root.Get("error")
	if err.IsObject() {
		msg := err.Get("message").String()
		typ := err.Get("type").String()
		if hasText(msg) {
			if hasText(typ) {
				return typ + ": " + msg
			}
			return msg
		}
	}
	if em := root.Get("error_message"); em.Exists() && hasText(em.String()) {
		return em.String()
	}
	if root.Type == gjson.String && hasText(root.String()) {
		return root.String()
	}
	return fmt.Sprintf("上游返回错误: HTTP %d", code)
}

// ---- Runware 响应字段提取（对齐 RunwareClient.errorFor / firstDataNode / sumCost）----

// firstDataNode 取 data[0]（对齐 firstDataNode）。
func firstDataNode(root gjson.Result) gjson.Result {
	data := root.Get("data")
	if data.IsArray() {
		arr := data.Array()
		if len(arr) > 0 {
			return arr[0]
		}
	}
	return gjson.Result{}
}

// errorFor 解析 errors[] 中与指定任务相关（或任意一条）的错误信息（对齐 errorFor）。taskUUID 为空则取首条。
func errorFor(root gjson.Result, taskUUID string) string {
	if !root.Exists() {
		return ""
	}
	errors := root.Get("errors")
	if !errors.IsArray() || len(errors.Array()) == 0 {
		return ""
	}
	for _, e := range errors.Array() {
		uuidVal := e.Get("taskUUID").String()
		if taskUUID == "" || uuidVal == "" || taskUUID == uuidVal {
			code := e.Get("code").String()
			msg := e.Get("message").String()
			if msg == "" {
				msg = "上游返回错误"
			}
			if hasText(code) {
				return code + ": " + msg
			}
			return msg
		}
	}
	return ""
}

// sumCost 汇总上游成本：data[].cost 求和（多张分别计费）；无 cost 字段返回 nil（对齐 sumCost）。
func sumCost(root gjson.Result) *decimal.Decimal {
	if !root.Exists() {
		return nil
	}
	data := root.Get("data")
	if !data.IsArray() {
		return nil
	}
	var sum *decimal.Decimal
	for _, item := range data.Array() {
		c := item.Get("cost")
		if c.Exists() && c.Type == gjson.Number {
			d := decimal.NewFromFloat(c.Float())
			if sum == nil {
				z := decimal.Zero
				sum = &z
			}
			v := sum.Add(d)
			sum = &v
		}
	}
	return sum
}

// ---- 畸形响应解析（对齐 AiRelayClient.tryParseSse / tryParse）----

var lineSplitRe = regexp.MustCompile(`\r?\n`)

// tryParseSSE 从 SSE / 混合前缀响应中提取首个有效 JSON（对齐 tryParseSse）。不存在返回空 Result。
func tryParseSSE(body string) gjson.Result {
	if !hasText(body) {
		return gjson.Result{}
	}
	for _, line := range lineSplitRe.Split(body, -1) {
		t := strings.TrimSpace(line)
		// 1) 标准 SSE：data: {...} 或 data: [...]
		if strings.HasPrefix(t, "data:") {
			jsonPart := strings.TrimSpace(t[5:])
			if strings.HasPrefix(jsonPart, "{") || strings.HasPrefix(jsonPart, "[") {
				if gjson.Valid(jsonPart) {
					return gjson.Parse(jsonPart)
				}
			}
		}
		// 2) 混合前缀行：MYAPI: 502 BAD_GATEWAY {"error":{...}}
		if brace := strings.IndexByte(t, '{'); brace > 0 {
			maybe := t[brace:]
			if gjson.Valid(maybe) {
				n := gjson.Parse(maybe)
				if n.Get("error").Exists() {
					return n
				}
			}
		}
	}
	return gjson.Result{}
}

// tryParseJSON 解析 JSON；失败则尝试从字符串任意位置截取 JSON 对象（对齐 tryParse）。不存在返回空 Result。
func tryParseJSON(body string) gjson.Result {
	if !hasText(body) {
		return gjson.Result{}
	}
	if gjson.Valid(body) {
		return gjson.Parse(body)
	}
	if s := strings.IndexByte(body, '{'); s >= 0 {
		sub := body[s:]
		if gjson.Valid(sub) {
			return gjson.Parse(sub)
		}
	}
	return gjson.Result{}
}

// buildChatMessages 将助手面板输入整理为 OpenAI chat/completions 消息。
func buildChatMessages(input map[string]interface{}) []map[string]interface{} {
	prompt := strOf(input["prompt"])
	messages := make([]map[string]interface{}, 0, 16)
	systemPrompt := strOf(input["systemPrompt"])
	if !hasText(systemPrompt) {
		systemPrompt = "你是 TideCanvas 的 AI 创作助手，擅长帮助用户优化提示词、分镜、脚本、画面描述和创作流程。请用简洁、可执行的中文回答。"
	}
	messages = append(messages, map[string]interface{}{"role": "system", "content": systemPrompt})

	if history, ok := input["messages"].([]interface{}); ok {
		start := 0
		if len(history) > 30 {
			start = len(history) - 30
		}
		for _, item := range history[start:] {
			m, ok := item.(map[string]interface{})
			if !ok {
				continue
			}
			role := strings.ToLower(strOf(m["role"]))
			if role != "system" && role != "assistant" && role != "user" {
				role = "user"
			}
			content := strOf(m["content"])
			if !hasText(content) {
				continue
			}
			messages = append(messages, map[string]interface{}{"role": role, "content": content})
		}
	}

	if attachmentText := buildAttachmentText(input["attachments"]); hasText(attachmentText) {
		prompt = strings.TrimSpace(prompt + "\n\n" + attachmentText)
	}
	messages = append(messages, map[string]interface{}{"role": "user", "content": prompt})
	return messages
}

func buildAttachmentText(value interface{}) string {
	list, ok := value.([]interface{})
	if !ok || len(list) == 0 {
		return ""
	}
	var sb strings.Builder
	sb.WriteString("附件：")
	for _, item := range list {
		m, ok := item.(map[string]interface{})
		if !ok {
			continue
		}
		name := strOf(m["name"])
		url := strOf(m["url"])
		mimeType := strOf(m["mimeType"])
		if !hasText(name) && !hasText(url) {
			continue
		}
		sb.WriteString("\n- ")
		if hasText(name) {
			sb.WriteString(name)
		}
		if hasText(mimeType) {
			sb.WriteString(" (")
			sb.WriteString(mimeType)
			sb.WriteString(")")
		}
		if hasText(url) {
			sb.WriteString(": ")
			sb.WriteString(url)
		}
	}
	return sb.String()
}

func extractChatContent(root gjson.Result) string {
	fields := []string{
		"choices.0.message.content",
		"choices.0.delta.content",
		"output_text",
		"answer",
		"content",
		"text",
		"response",
		"message",
	}
	for _, field := range fields {
		value := root.Get(field)
		if value.Exists() {
			if value.Type == gjson.String && hasText(value.String()) {
				return strings.TrimSpace(value.String())
			}
			if value.IsArray() {
				if text := extractTextParts(value); hasText(text) {
					return text
				}
			}
		}
	}
	choices := root.Get("choices")
	if choices.IsArray() {
		var parts []string
		for _, choice := range choices.Array() {
			text := choice.Get("message.content").String()
			if !hasText(text) {
				text = choice.Get("text").String()
			}
			if hasText(text) {
				parts = append(parts, strings.TrimSpace(text))
			}
		}
		if len(parts) > 0 {
			return strings.Join(parts, "\n")
		}
	}
	return ""
}

func extractTextParts(node gjson.Result) string {
	var parts []string
	for _, item := range node.Array() {
		if item.Type == gjson.String && hasText(item.String()) {
			parts = append(parts, strings.TrimSpace(item.String()))
			continue
		}
		for _, field := range []string{"text", "content", "value"} {
			value := item.Get(field)
			if value.Exists() && value.Type == gjson.String && hasText(value.String()) {
				parts = append(parts, strings.TrimSpace(value.String()))
				break
			}
		}
	}
	return strings.Join(parts, "\n")
}
