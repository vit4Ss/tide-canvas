package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"image"
	"math"
	"strconv"
	"strings"
	"time"

	"tidecanvas/internal/model"
)

// Domain errors surfaced by the AI pipeline.
var (
	// errProviderNotConfigured indicates no usable upstream provider/credentials
	// are wired. The stub provider returns this so tasks fail cleanly instead of
	// fabricating a fake result URL.
	errProviderNotConfigured = errors.New("AI provider not configured")

	// errTaskNotFound / errTaskForbidden gate task ownership lookups.
	errTaskNotFound  = errors.New("task not found")
	errTaskForbidden = errors.New("not allowed to access this task")

	// grid-split errors.
	errBadGridSplit         = errors.New("invalid grid split parameters")
	errGridSplitUnavailable = errors.New("server-side grid split is not available; use client-side slicing")
)

// GenHandler is a single generation capability (e.g. text_to_image). A handler
// validates/normalizes input and drives the provider client to a result. The
// registry maps a handlerName -> GenHandler; the service looks one up per task.
type GenHandler interface {
	// Name is the stable handler key (matches AiHandler.HandlerName and the
	// frontend handler strings, e.g. "text_to_image").
	Name() string
	// OperationType classifies the upstream operation for the audit log
	// (e.g. "generation", "edits", "video").
	OperationType() string
	// Async reports whether the upstream is long-running (polled) vs. immediate.
	Async() bool
	// Execute runs the generation via the provider client.
	Execute(ctx context.Context, client AiProviderClient, req GenerateRequest) (GenerateResult, error)
}

// genHandler is the default GenHandler used by every stub capability. Behavior is
// identical across handlers in this phase; they differ only by metadata so the
// audit log and async flag are accurate. Real per-capability request shaping is
// added when a real provider client lands.
type genHandler struct {
	name    string
	op      string
	isAsync bool
}

func (h genHandler) Name() string          { return h.name }
func (h genHandler) OperationType() string { return h.op }
func (h genHandler) Async() bool           { return h.isAsync }

func (h genHandler) Execute(ctx context.Context, client AiProviderClient, req GenerateRequest) (GenerateResult, error) {
	return client.Generate(ctx, req)
}

// presetEditHandler is a one-click image-edit capability (移除背景 / 物体移除 /
// 高清放大 / 扩图). It carries a server-side preset instruction and reuses the
// proven image_to_image (EditImage → /v1/images/edits) route: the source image
// the user clicked is supplied by the client under imageList/sourceImage, and we
// inject the engineered prompt here so the client never has to type one (and can
// never override the operation's intent). `extra` seeds default request params
// (e.g. resolution for upscale) without clobbering anything the client did send.
//
// prompt/extra 是内建兜底值（来自 model.CanonicalAiTools）；运行时后台在
// ai_tools 行上维护的配置经 req.PresetPrompt / req.PresetExtra 覆盖，行缺失
// 或字段为空时退回内建，行为不变。
type presetEditHandler struct {
	name   string
	prompt string
	extra  map[string]any
}

func (h presetEditHandler) Name() string          { return h.name }
func (h presetEditHandler) OperationType() string { return "edits" }
func (h presetEditHandler) Async() bool           { return true }

func (h presetEditHandler) Execute(ctx context.Context, client AiProviderClient, req GenerateRequest) (GenerateResult, error) {
	if req.Input == nil {
		req.Input = map[string]any{}
	}
	// The engineered instruction is authoritative — it drives the actual relay
	// edit. (The client may still send a human label under "prompt" for history
	// display; it is stored on the task but overridden here for the upstream call.)
	// 后台配置优先：service.generate 从 ai_tools 行带来的 PresetPrompt/PresetExtra
	// 覆盖内建默认；为空/为 nil 时退回内建，保证行缺失时行为不变。
	prompt := h.prompt
	if req.PresetPrompt != "" {
		prompt = req.PresetPrompt
	}
	extra := h.extra
	if req.PresetExtra != nil {
		extra = req.PresetExtra
	}
	// 语义护栏:一键编辑的产出必须与功能承诺相符,而提示词驱动的编辑模型
	// (nano-banana 系)常忽略 aspect_ratio 等参数、只听指令——所以约束必须写进
	// 指令本身(代码级追加,后台改过预设词的存量 ai_tools 行同样生效)。
	if h.name == "outpaint" {
		// 扩图 = 同比例视野变大:原图完整保留、在画面中占比变小,四周由新生成
		// 内容无缝补满(用户反馈:16:9 被扩成 1:1,且有"没扩、只是原图"的风险)。
		// 比例来源:客户端量好的吸附值优先,缺失/非法时服务端下载源图测量兜底
		// (与全景检测同一条 SSRF 防护通道);数值只有通过 W:H 校验才会拼进指令
		// (inputStr 的原始值是客户端可控字符串,直接拼接就是提示词注入口子)。
		// 两个通道都拿不到数值时,扩图语义与"保持源图比例"仍以定性描述追加。
		ratio := outpaintTargetRatio(ctx, req.Input)
		if ratio != "" && inputStr(req.Input, "aspect_ratio", "aspectRatio", "ratio") == "" {
			req.Input["aspect_ratio"] = ratio
		}
		shape := "the same aspect ratio as the source image"
		if ratio != "" {
			shape = "the exact aspect ratio " + ratio + " of the source image"
		}
		prompt += " The output canvas must keep " + shape + "." +
			" The entire original image must remain fully visible, appearing proportionally smaller" +
			" within the frame, surrounded on all sides by newly generated scenery that seamlessly" +
			" continues it. Never return the source image unchanged, never crop it, and never change" +
			" the canvas to a proportion different from the source image's"
		if ratio != "" && ratio != "1:1" {
			// 已观测到的失败形态就是落回方形默认画布;源图本身 1:1 时不加该例示,
			// 避免"禁止方形"与目标比例自相矛盾。
			prompt += " (for example, do not fall back to a square canvas)"
		}
		prompt += "."
	} else {
		// 其余编辑(超分/抠图/物体移除/打光)不改画布:形状与取景必须原样保留。
		// 参数通道刻意不传比例——吸附会把 2:1 等非标准比例改掉;指令级约束无此
		// 副作用,且正中"模型只听指令"的要害。措辞不提 size:高清放大的语义正是
		// 放大像素尺寸,"保持大小"会与其冲突。
		prompt += " Keep the output canvas at the source image's exact original aspect ratio, framing" +
			" and composition — do not crop, letterbox, zoom, or reshape it."
	}
	req.Input["prompt"] = prompt
	for k, v := range extra {
		if _, ok := req.Input[k]; !ok {
			req.Input[k] = v
		}
	}
	// Route through the existing image-edit handler (provider_relay dispatches on
	// req.Handler), which rewrites the source URL to the upstream-fetchable host
	// and re-hosts the result onto our OSS.
	req.Handler = "image_to_image"
	return client.Generate(ctx, req)
}

// outpaintFallbackRatios mirrors the Studio fallback pool (frontend RATIOS in
// create-studio/constants.ts) so the server-side snap lands on the same buckets
// the client would have sent. Only used when the client didn't send a ratio.
var outpaintFallbackRatios = []string{"1:1", "3:4", "4:3", "16:9", "9:16"}

// probeEditImage is safeFetchImage, injectable for tests (the SSRF guard blocks
// httptest loopback hosts, mirroring provider_worldlabs's probe seam).
var probeEditImage = safeFetchImage

// outpaintTargetRatio resolves the outpaint output ratio. The client's explicit
// snapped value (aspect_ratio/aspectRatio/ratio) wins — but only after strict
// W:H validation, because the raw string is client-controlled and the caller
// embeds the result into the server-owned engineered prompt (unvalidated
// passthrough would be a prompt-injection channel). Invalid/missing values fall
// back to downloading the first source image and snapping its pixel size to the
// standard buckets. "" means unknown.
func outpaintTargetRatio(ctx context.Context, in map[string]any) string {
	if r := normalizeRatioToken(inputStr(in, "aspect_ratio", "aspectRatio", "ratio")); r != "" {
		return r
	}
	urls := inputImageURLs(in)
	if len(urls) == 0 {
		return ""
	}
	probeCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	data, _, err := probeEditImage(probeCtx, urls[0])
	if err != nil {
		return ""
	}
	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return ""
	}
	return nearestRatioBucket(cfg.Width, cfg.Height, outpaintFallbackRatios)
}

// normalizeRatioToken validates a client-supplied ratio string and returns its
// canonical "W:H" form (digits only, each side 1..999), or "" when the value is
// not a plain ratio. This is the gate that keeps arbitrary client text out of
// the engineered prompt.
func normalizeRatioToken(s string) string {
	parts := strings.SplitN(strings.TrimSpace(s), ":", 2)
	if len(parts) != 2 {
		return ""
	}
	w, errW := strconv.Atoi(strings.TrimSpace(parts[0]))
	h, errH := strconv.Atoi(strings.TrimSpace(parts[1]))
	if errW != nil || errH != nil || w <= 0 || h <= 0 || w > 999 || h > 999 {
		return ""
	}
	return strconv.Itoa(w) + ":" + strconv.Itoa(h)
}

// nearestRatioBucket snaps a pixel size to the closest "W:H" candidate using
// log distance (horizontal/vertical symmetric — the Go twin of the frontend's
// nearestAspectRatio in lib/aspect-ratio.ts). Returns "" on invalid input.
func nearestRatioBucket(width, height int, candidates []string) string {
	if width <= 0 || height <= 0 {
		return ""
	}
	target := math.Log(float64(width) / float64(height))
	best, bestDistance := "", math.Inf(1)
	for _, candidate := range candidates {
		parts := strings.SplitN(candidate, ":", 2)
		if len(parts) != 2 {
			continue
		}
		w, errW := strconv.Atoi(parts[0])
		h, errH := strconv.Atoi(parts[1])
		if errW != nil || errH != nil || w <= 0 || h <= 0 {
			continue
		}
		if d := math.Abs(math.Log(float64(w)/float64(h)) - target); d < bestDistance {
			bestDistance, best = d, candidate
		}
	}
	return best
}

// handlerRegistry maps handlerName -> GenHandler.
type handlerRegistry struct {
	handlers map[string]GenHandler
}

// newHandlerRegistry builds the registry pre-populated with the built-in stub
// capabilities. Names mirror the frontend handler strings (see image-node.tsx,
// video-node.tsx, canvas-history-panel.tsx HANDLER_LABEL).
func newHandlerRegistry() *handlerRegistry {
	r := &handlerRegistry{handlers: map[string]GenHandler{}}
	for _, h := range builtinHandlers() {
		r.handlers[h.Name()] = h
	}
	return r
}

// get returns the handler for name and whether it exists.
func (r *handlerRegistry) get(name string) (GenHandler, bool) {
	h, ok := r.handlers[name]
	return h, ok
}

// baseGenHandlerList lists the built-in base capabilities (everything except the
// preset one-click tools appended by builtinHandlers). op classifies image vs.
// video for the log's operation column (frontend OP_LABEL maps
// generation/edits/video).
func baseGenHandlerList() []GenHandler {
	return []GenHandler{
		genHandler{name: "text_to_image", op: "generation", isAsync: true},
		genHandler{name: "image_to_image", op: "edits", isAsync: true},
		genHandler{name: "text_to_video", op: "video", isAsync: true},
		genHandler{name: "image_to_video", op: "video", isAsync: true},
		genHandler{name: "start_end_to_video", op: "video", isAsync: true},
		genHandler{name: "reference_to_video", op: "video", isAsync: true},
		// 音频(TTS/音乐/音效共用 relay /v1/audio/speech,上游由模型决定)。
		genHandler{name: "text_to_audio", op: "audio", isAsync: true},
		genHandler{name: "generate_3d", op: "3d", isAsync: true},
		// 视频超分(relay /v1/video/upscale,WaveSpeedAI/ByteDance):只收公网
		// 视频 URL,不接收 prompt,operation 统一为 upscale。
		genHandler{name: "video_upscale", op: "upscale", isAsync: true},
		// 画布 AI 助手:runTask 特判该 handler 走 relay 文本模型(见 assistant_chat.go),
		// 结果放 Meta["text"],不产出 URL。
		genHandler{name: assistantChatHandler, op: "chat", isAsync: true},
		genHandler{name: skillTextCompletionHandler, op: "text", isAsync: true},
	}
}

// baseGenHandlerNames returns the base-capability name set(builtinHandlers 与
// presetToolHandlerNames 共用,避免两处循环各自维护)。
func baseGenHandlerNames() map[string]bool {
	base := map[string]bool{}
	for _, h := range baseGenHandlerList() {
		base[h.Name()] = true
	}
	return base
}

// builtinHandlers lists every stub capability: the base list plus the preset
// one-click tools derived from model.CanonicalAiTools.
func builtinHandlers() []GenHandler {
	handlers := baseGenHandlerList()
	base := baseGenHandlerNames()

	// One-click image-edit ops (per-result toolbar in 创作台 / 独立工具页). Each
	// reuses the image-edit route with a fixed, server-owned instruction. 代码
	// 注册能力，配置决定策略：预设指令的唯一出处是 model.CanonicalAiTools，取
	// 其中 handler 不属于基础能力的行生成 presetEditHandler（内建兜底值；运行
	// 时后台在 ai_tools 上的编辑经 req.PresetPrompt/req.PresetExtra 覆盖）。
	for i := range model.CanonicalAiTools {
		t := &model.CanonicalAiTools[i]
		if base[t.Handler] {
			// e.g. 局部重绘 rides the plain image_to_image capability — no preset.
			continue
		}
		handlers = append(handlers, presetEditHandler{
			name:   t.Handler,
			prompt: t.PresetPrompt,
			extra:  decodeToolExtra(t.ExtraParams),
		})
	}
	return handlers
}

// applyBaseToolPromptGuard hardens tool-page requests that ride a BASE
// capability(局部重绘 = image_to_image):presetEditHandler 的画布形状护栏对
// 它们不生效,而"局部"的语义承诺是「只改描述的部分」——提示词驱动的编辑模型
// 否则会自由重绘甚至改画布形状(与扩图比例 bug 同一失败类)。只动带 toolKey
// 标识的工具页请求;画布/创作台的普通 image_to_image 提示词原样不碰。计费与
// 落库的任务 input 均基于原始请求,不受本次追加影响(runTask 解码的是副本)。
func applyBaseToolPromptGuard(tool *model.AiTool, gh GenHandler, input map[string]any) {
	if tool == nil || gh == nil || input == nil {
		return
	}
	if _, preset := gh.(presetEditHandler); preset {
		return // 预设型工具的护栏在 presetEditHandler.Execute 内,不重复追加。
	}
	prompt, _ := input["prompt"].(string)
	if strings.TrimSpace(prompt) == "" {
		return // 无提示词的基础能力(如视频超分)没有可追加的指令通道。
	}
	input["prompt"] = prompt +
		" Change only what the instruction above describes. Keep every other element of the source" +
		" image unchanged, and keep the output canvas at the source image's exact original aspect" +
		" ratio, framing and composition — do not crop, letterbox, zoom, or reshape it."
}

// canonicalToolRequest attributes a request to the independent /tools surface.
// A handler alone is never enough: the same preset handlers are also used by
// Studio's per-result toolbar. Only an exact canonical handler + input.toolKey
// pair is a tool-page request. marker=true with tool=nil means the caller sent
// an invalid/mismatched marker and must not silently bypass tool policy.
func canonicalToolRequest(handler string, raw json.RawMessage) (tool *model.AiTool, marker bool) {
	var input map[string]json.RawMessage
	if len(raw) == 0 || json.Unmarshal(raw, &input) != nil {
		return nil, false
	}
	rawKey, ok := input["toolKey"]
	if !ok {
		return nil, false
	}
	marker = true
	var key string
	if json.Unmarshal(rawKey, &key) != nil {
		return nil, marker
	}
	key = strings.TrimSpace(key)
	for i := range model.CanonicalAiTools {
		candidate := &model.CanonicalAiTools[i]
		if candidate.Key == key && candidate.Handler == handler {
			return candidate, marker
		}
	}
	return nil, marker
}

// toolMediaHandlerNames returns every canonical tool handler that produces the
// requested media type. Asset history classifies the output media, not the
// surface that created it, so every canonical handler belongs here.
func toolMediaHandlerNames(toolType string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(model.CanonicalAiTools))
	for i := range model.CanonicalAiTools {
		t := &model.CanonicalAiTools[i]
		if t.Type != toolType || seen[t.Handler] {
			continue
		}
		seen[t.Handler] = true
		out = append(out, t.Handler)
	}
	return out
}
