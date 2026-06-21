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
		genHandler{name: "creative_desc", op: "generation", isAsync: false},
	}
}
