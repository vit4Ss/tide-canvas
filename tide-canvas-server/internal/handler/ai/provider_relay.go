package ai

import (
	"context"
	"errors"
	"strconv"
	"strings"

	"tidecanvas/internal/pkg/relaymedia"
	"tidecanvas/internal/pkg/storage"
)

// provider_relay.go is the real AiProviderClient: it routes a generation request
// to the ScarecrowToken relay's media endpoints via the relaymedia client. It
// replaces the stub once a relay API key is configured.

// errUnsupportedHandler is returned for capabilities this provider does not
// implement; the task fails with a clear message instead of being mis-routed.
var errUnsupportedHandler = errors.New("unsupported generation handler")

// newProviderClient returns the relay-backed media provider when a relay API key
// is configured, otherwise the no-credentials stub so the server stays runnable.
// store is used to rewrite reference-asset URLs to the cross-border upstream host.
func newProviderClient(baseURL, apiKey string, store storage.StorageStrategy) AiProviderClient {
	if c := relaymedia.New(baseURL, apiKey); c != nil {
		return &relayProviderClient{c: c, store: store}
	}
	return newStubProviderClient()
}

// relayProviderClient adapts GenerateRequest -> relaymedia calls.
type relayProviderClient struct {
	c     *relaymedia.Client
	store storage.StorageStrategy
}

func (p *relayProviderClient) Type() string { return "relay" }

// Generate routes by handler:
//
//	text_to_image       -> POST /v1/images/generations
//	image_to_image      -> POST /v1/images/edits
//	text_to_video       -> POST /openapi/v1/generations  (mode text_to_video)
//	image_to_video      -> …                               (mode image_to_video)
//	start_end_to_video  -> …                               (mode first_last_frame)
//	reference_to_video  -> …                               (mode multi_ref)
func (p *relayProviderClient) Generate(ctx context.Context, req GenerateRequest) (GenerateResult, error) {
	if req.Model == nil {
		return GenerateResult{}, errNoModel
	}
	model := strings.TrimSpace(req.Model.ModelID) // upstream model id (market_model.model_key)

	switch req.Handler {
	case "text_to_image":
		return p.result(p.c.GenerateImage(ctx, p.imageParams(model, req.Input)))
	case "image_to_image":
		ip := p.imageParams(model, req.Input)
		ip.ImageURLs = p.upstreamURLs(inputImageURLs(req.Input))
		return p.result(p.c.EditImage(ctx, ip))
	case "text_to_video":
		return p.result(p.c.GenerateVideo(ctx, p.videoParams(model, "text_to_video", req.Input)))
	case "image_to_video":
		vp := p.videoParams(model, "image_to_video", req.Input)
		vp.ImageURL = p.upstreamURL(firstURL(inputImageURLs(req.Input)))
		return p.result(p.c.GenerateVideo(ctx, vp))
	case "start_end_to_video":
		vp := p.videoParams(model, "first_last_frame", req.Input)
		vp.ImageURLs = p.upstreamURLs(startEndFrames(req.Input))
		return p.result(p.c.GenerateVideo(ctx, vp))
	case "reference_to_video":
		vp := p.videoParams(model, "multi_ref", req.Input)
		vp.ImageURLs = p.upstreamURLs(inputImageURLs(req.Input))
		vp.VideoURLs = p.upstreamURLs(inputStrings(req.Input, "videoReferences", "video_urls"))
		vp.AudioURLs = p.upstreamURLs(inputStrings(req.Input, "audioReferences", "audio_urls"))
		return p.result(p.c.GenerateVideo(ctx, vp))
	default:
		return GenerateResult{}, errUnsupportedHandler
	}
}

// imageParams maps the shared input fields for an image request.
func (p *relayProviderClient) imageParams(model string, in map[string]any) relaymedia.ImageParams {
	return relaymedia.ImageParams{
		Model:       model,
		Prompt:      inputStr(in, "prompt"),
		Quality:     normalizeQuality(inputStr(in, "quality")),
		Resolution:  strings.ToLower(inputStr(in, "resolution", "clarity")), // relay schema: 1k/2k/4k
		AspectRatio: inputStr(in, "aspect_ratio", "aspectRatio", "ratio"),
	}
}

// videoParams maps the shared input fields for a video request. The per-mode
// media fields are filled by the caller.
func (p *relayProviderClient) videoParams(model, mode string, in map[string]any) relaymedia.VideoParams {
	return relaymedia.VideoParams{
		Model:      model,
		Mode:       mode,
		Prompt:     inputStr(in, "prompt"),
		Ratio:      normalizeVideoRatio(inputStr(in, "aspect_ratio", "aspectRatio", "ratio")),
		Resolution: strings.ToLower(inputStr(in, "resolution")), // 480p/720p/1080p
		Duration:   inputInt(in, "duration"),
	}
}

// result maps a relaymedia.Result (and any error) to the domain GenerateResult,
// preserving the audit fields even on failure.
func (p *relayProviderClient) result(res relaymedia.Result, err error) (GenerateResult, error) {
	out := GenerateResult{
		RequestURL:     res.RequestURL,
		RequestBody:    res.RequestBody,
		ResponseBody:   res.ResponseBody,
		HttpStatus:     res.HTTPStatus,
		UpstreamTaskID: res.TaskID,
	}
	if err != nil {
		return out, err
	}
	if len(res.URLs) > 0 {
		out.ResultURL = res.URLs[0]
		out.URLs = res.URLs
	}
	return out, nil
}

// normalizeQuality maps a caller-supplied quality to the relay schema
// (low | medium | high). The canvas picker labels the middle tier "standard",
// so it is folded to "medium"; an empty value is left empty (not sent).
func normalizeQuality(q string) string {
	q = strings.ToLower(strings.TrimSpace(q))
	if q == "standard" {
		return "medium"
	}
	return q
}

// normalizeVideoRatio maps the canvas "auto" sentinel to the relay's "adaptive"
// (meaning: do not constrain the ratio). Other values pass through unchanged.
func normalizeVideoRatio(r string) string {
	r = strings.TrimSpace(r)
	if strings.EqualFold(r, "auto") {
		return "adaptive"
	}
	return r
}

// upstreamURL rewrites one asset URL to the form the (overseas) relay should
// fetch — e.g. the OSS transfer-acceleration host. A nil store is a no-op.
func (p *relayProviderClient) upstreamURL(u string) string {
	if p.store == nil || u == "" {
		return u
	}
	return p.store.UpstreamURL(u)
}

// upstreamURLs applies upstreamURL to every element.
func (p *relayProviderClient) upstreamURLs(urls []string) []string {
	if p.store == nil || len(urls) == 0 {
		return urls
	}
	out := make([]string, len(urls))
	for i, u := range urls {
		out[i] = p.store.UpstreamURL(u)
	}
	return out
}

// firstURL returns the first element of a URL slice, or "".
func firstURL(urls []string) string {
	if len(urls) > 0 {
		return urls[0]
	}
	return ""
}

// startEndFrames returns exactly [first, last] for the first_last_frame mode. The
// frontend sends discrete firstFrame/lastFrame; it falls back to the ordered
// image list when only that is present. A missing last frame reuses the first.
func startEndFrames(in map[string]any) []string {
	first := inputStr(in, "firstFrame", "startImageUrl", "sourceImage")
	last := inputStr(in, "lastFrame", "endImageUrl")
	if first == "" {
		if list := inputImageURLs(in); len(list) > 0 {
			first = list[0]
			if len(list) > 1 {
				last = list[1]
			}
		}
	}
	if first == "" {
		return nil
	}
	if last == "" {
		last = first
	}
	return []string{first, last}
}

// inputStr returns the first non-empty string value among the given keys.
func inputStr(in map[string]any, keys ...string) string {
	for _, k := range keys {
		if v, ok := in[k]; ok {
			if s, ok := v.(string); ok {
				if s = strings.TrimSpace(s); s != "" {
					return s
				}
			}
		}
	}
	return ""
}

// inputInt returns the first key's value coerced to an int. JSON numbers decode
// to float64; strings are parsed by their leading integer so unit-suffixed values
// like "5s" (the relay duration schema's form) yield 5. Returns 0 when
// absent/unparsable.
func inputInt(in map[string]any, keys ...string) int {
	for _, k := range keys {
		switch v := in[k].(type) {
		case float64:
			return int(v)
		case int:
			return v
		case string:
			if n, ok := leadingInt(v); ok {
				return n
			}
		}
	}
	return 0
}

// leadingInt parses the leading run of digits in s (e.g. "5s" -> 5, "10" -> 10).
// Returns (0,false) when s has no leading digit.
func leadingInt(s string) (int, bool) {
	s = strings.TrimSpace(s)
	end := 0
	for end < len(s) && s[end] >= '0' && s[end] <= '9' {
		end++
	}
	if end == 0 {
		return 0, false
	}
	n, err := strconv.Atoi(s[:end])
	if err != nil {
		return 0, false
	}
	return n, true
}

// inputStrings collects string elements from the first present array-valued key.
func inputStrings(in map[string]any, keys ...string) []string {
	for _, k := range keys {
		if arr, ok := in[k].([]any); ok {
			out := make([]string, 0, len(arr))
			for _, v := range arr {
				if s, ok := v.(string); ok {
					if s = strings.TrimSpace(s); s != "" {
						out = append(out, s)
					}
				}
			}
			if len(out) > 0 {
				return out
			}
		}
	}
	return nil
}

// inputImageURLs collects the reference image URLs an edit/video needs, preferring
// the ordered imageList the frontend sends ([主图, ...参考图]); it falls back to
// the discrete fields. Duplicates and blanks are dropped while order is kept.
func inputImageURLs(in map[string]any) []string {
	seen := map[string]bool{}
	var out []string
	add := func(v any) {
		if s, ok := v.(string); ok {
			if s = strings.TrimSpace(s); s != "" && !seen[s] {
				seen[s] = true
				out = append(out, s)
			}
		}
	}

	// Ordered full lists take precedence (frontend sends [主图, ...参考图]).
	for _, key := range []string{"imageList", "image_urls", "imageUrls"} {
		if arr, ok := in[key].([]any); ok {
			for _, v := range arr {
				add(v)
			}
		}
	}
	// Fall back to discrete fields, keeping the source image first.
	for _, key := range []string{"sourceImage", "imageUrl", "image_url"} {
		if v, ok := in[key]; ok {
			add(v)
		}
	}
	if arr, ok := in["references"].([]any); ok {
		for _, v := range arr {
			add(v)
		}
	}
	return out
}
