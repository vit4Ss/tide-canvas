package ai

import (
	"context"
	"errors"
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
	req.Input["prompt"] = h.prompt
	for k, v := range h.extra {
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

// builtinHandlers lists the stub capabilities. op classifies image vs. video for
// the log's operation column (frontend OP_LABEL maps generation/edits/video).
func builtinHandlers() []GenHandler {
	return []GenHandler{
		genHandler{name: "text_to_image", op: "generation", isAsync: true},
		genHandler{name: "image_to_image", op: "edits", isAsync: true},
		genHandler{name: "text_to_video", op: "video", isAsync: true},
		genHandler{name: "image_to_video", op: "video", isAsync: true},
		genHandler{name: "start_end_to_video", op: "video", isAsync: true},
		genHandler{name: "reference_to_video", op: "video", isAsync: true},
		genHandler{name: "creative_desc", op: "generation", isAsync: false},

		// One-click image-edit ops (per-result toolbar in 创作台). Each reuses the
		// image-edit route with a fixed, server-owned instruction.
		presetEditHandler{
			name: "remove_bg",
			prompt: "Completely remove the background of this image. Keep the main foreground subject perfectly intact " +
				"with clean, precise edges and no halo or leftover fringe. Place the subject on a plain solid white " +
				"background. Do not change, recolor, crop or restyle the subject itself.",
		},
		presetEditHandler{
			name: "remove_object",
			prompt: "Remove the unwanted and distracting elements from this image — stray people, clutter, text, " +
				"watermarks and blemishes — while keeping the main subject and the overall composition unchanged. " +
				"Realistically reconstruct the area behind the removed elements so the result looks natural and seamless.",
		},
		presetEditHandler{
			name: "upscale",
			prompt: "Upscale this image to a higher resolution. Greatly enhance sharpness, fine detail and texture " +
				"clarity, and remove blur, noise and compression artifacts. Preserve the original content, composition, " +
				"colors and style exactly — do not add, remove or alter any elements.",
			// default to the highest tier so the output is genuinely larger; the
			// frontend pairs this with a 4K-capable model. set-if-empty, so a client
			// override still wins.
			extra: map[string]any{"resolution": "4k", "quality": "high"},
		},
		presetEditHandler{
			name: "outpaint",
			prompt: "Expand this image outward on all sides, naturally extending the existing scene, lighting, " +
				"perspective and art style to fill a larger canvas. Keep the original content unchanged and well " +
				"composed; only generate new, seamlessly blended surroundings beyond the current borders.",
		},
		presetEditHandler{
			name: "relight",
			prompt: "Relight this image with professional, cinematic lighting. Improve the exposure, contrast and " +
				"color balance, add soft natural highlights and gentle shadows, and enhance depth and atmosphere. " +
				"Preserve the original subject, composition, colors and style — do not add, remove or move any elements.",
			extra: map[string]any{"quality": "high"},
		},
	}
}
