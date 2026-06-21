package ai

import (
	"context"

	"tidecanvas/internal/model"
)

// GenerateRequest is the normalized request a handler hands to an upstream
// provider client. Input is the raw user-supplied parameter object.
type GenerateRequest struct {
	Handler  string
	Model    *model.AiModel
	Provider *model.AiProvider
	Input    map[string]any
}

// GenerateResult is the normalized provider output. For async upstreams the
// client may return an UpstreamTaskID and a handler polls it; the stub returns
// a synchronous result directly. URLs holds extra outputs (e.g. a 4-image batch)
// and is surfaced to the frontend via AiTaskVO.resultMeta { urls: [...] }.
type GenerateResult struct {
	ResultURL      string
	URLs           []string
	Meta           map[string]any
	UpstreamTaskID string
	// Audit fields captured for the AiGenerationLog row.
	RequestURL   string
	RequestBody  string
	ResponseBody string
	HttpStatus   int
	Cost         string
}

// AiProviderClient abstracts calling an upstream AI provider / relay station.
// A real implementation (OpenAI/Gemini/relay) satisfies this interface in a
// later phase; the stub below keeps the server runnable without credentials.
type AiProviderClient interface {
	// Generate performs an upstream generation and returns a normalized result.
	Generate(ctx context.Context, req GenerateRequest) (GenerateResult, error)
	// Type reports the provider client identifier (e.g. "stub", "openai").
	Type() string
}

// stubProviderClient is a no-credentials placeholder. It does NOT fabricate a
// result URL: returning an empty ResultURL causes the task to fail with a clear
// "AI provider not configured" message, which the frontend surfaces verbatim
// (use-ai-generation.ts: "生成结果无效，可能未配置 AI 供应商"). This keeps the
// contract honest until a real provider client is wired in.
type stubProviderClient struct{}

func newStubProviderClient() AiProviderClient { return &stubProviderClient{} }

func (s *stubProviderClient) Type() string { return "stub" }

func (s *stubProviderClient) Generate(ctx context.Context, req GenerateRequest) (GenerateResult, error) {
	_ = ctx
	reqURL := ""
	if req.Provider != nil {
		reqURL = req.Provider.BaseUrl
	}
	return GenerateResult{
		ResultURL:    "",
		RequestURL:   reqURL,
		ResponseBody: "",
		HttpStatus:   0,
	}, errProviderNotConfigured
}
