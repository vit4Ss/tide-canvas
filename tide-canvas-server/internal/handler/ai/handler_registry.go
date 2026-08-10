package ai

import (
	"context"
	"errors"

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

// toolSharedHandlers are handlers a 智能工具 shares with a non-tool surface, so
// a task carrying one cannot be attributed to the tool:局部重绘复用创作台的
// 通用图生图。video_upscale 虽然也是基础能力,但目前只有「视频超分」工具这一个
// 入口,故计入;将来若给它做了创作台入口,加进这里即可。
var toolSharedHandlers = map[string]bool{"image_to_image": true}

// isToolExclusiveHandler reports whether a handler belongs to exactly one
// 智能工具(没有被创作台等非工具入口共用)。后台「工具管理」的上下线开关据此
// 生效:handler 专属于某个工具时,下线它就该挡住生成;共用的(局部重绘的
// image_to_image)绝不能挡,否则会连创作台的图生图一起废掉。
func isToolExclusiveHandler(handler string) bool {
	if toolSharedHandlers[handler] {
		return false
	}
	for i := range model.CanonicalAiTools {
		if model.CanonicalAiTools[i].Handler == handler {
			return true
		}
	}
	return false
}

// toolHandlerNames returns the handlers whose tasks can be attributed to a
// 智能工具。任务列表的「工具作品」筛选桶(mediaType=tool)用它。
func toolHandlerNames() []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(model.CanonicalAiTools))
	for i := range model.CanonicalAiTools {
		h := model.CanonicalAiTools[i].Handler
		if toolSharedHandlers[h] || seen[h] {
			continue
		}
		seen[h] = true
		out = append(out, h)
	}
	return out
}
