package ai

import (
	"bytes"
	"context"
	"crypto/sha1"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"
	"sync"
	"time"

	"tidecanvas/internal/pkg/relaymedia"
	"tidecanvas/internal/pkg/storage"
)

// rehostHC downloads relay-hosted result media so it can be re-uploaded to our
// own storage; generous timeout for multi-MB images.
var rehostHC = &http.Client{Timeout: 90 * time.Second}

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
		ip := p.imageParams(model, req.Input)
		res, err := p.batchImages(ctx, batchCount(req.Input), func(ctx context.Context) (relaymedia.Result, error) {
			return p.c.GenerateImage(ctx, ip)
		})
		return p.result(ctx, res, err)
	case "image_to_image":
		ip := p.imageParams(model, req.Input)
		ip.ImageURLs = p.upstreamURLs(inputImageURLs(req.Input))
		res, err := p.batchImages(ctx, batchCount(req.Input), func(ctx context.Context) (relaymedia.Result, error) {
			return p.c.EditImage(ctx, ip)
		})
		return p.result(ctx, res, err)
	case "text_to_video":
		res, err := p.c.GenerateVideo(ctx, p.videoParams(model, "text_to_video", req.Input))
		return p.result(ctx, res, err)
	case "image_to_video":
		vp := p.videoParams(model, "image_to_video", req.Input)
		vp.ImageURL = p.upstreamURL(firstURL(inputImageURLs(req.Input)))
		res, err := p.c.GenerateVideo(ctx, vp)
		return p.result(ctx, res, err)
	case "start_end_to_video":
		vp := p.videoParams(model, "first_last_frame", req.Input)
		vp.ImageURLs = p.upstreamURLs(startEndFrames(req.Input))
		res, err := p.c.GenerateVideo(ctx, vp)
		return p.result(ctx, res, err)
	case "reference_to_video":
		vp := p.videoParams(model, "multi_ref", req.Input)
		vp.ImageURLs = p.upstreamURLs(inputImageURLs(req.Input))
		vp.VideoURLs = p.upstreamURLs(inputStrings(req.Input, "videoReferences", "video_urls"))
		vp.AudioURLs = p.upstreamURLs(inputStrings(req.Input, "audioReferences", "audio_urls"))
		res, err := p.c.GenerateVideo(ctx, vp)
		return p.result(ctx, res, err)
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

// batchCount reads the requested number of images from the input and clamps it
// to the relay-friendly range [1,4]. The relay image API has no n/batch param, so
// a value > 1 is realized by calling gen multiple times (see batchImages). An
// absent/invalid value (0) means a single image.
func batchCount(in map[string]any) int {
	n := inputInt(in, "batchCount", "batch")
	if n < 1 {
		return 1
	}
	if n > 4 {
		return 4
	}
	return n
}

// batchImages realizes a multi-image request by invoking gen `n` times (the relay
// image endpoints produce one image per call and expose no batch param). For n<=1
// it is a single passthrough call, preserving the original behavior exactly.
//
// For n>1 the calls run concurrently; every successful call's URLs are merged into
// one Result. If at least one call succeeds the merged Result is returned (nil
// error); if all calls fail the last error is returned. The audit fields
// (RequestURL/RequestBody/ResponseBody/HTTPStatus/TaskID) are taken from the FIRST
// call so the generation log still mirrors a representative upstream request.
func (p *relayProviderClient) batchImages(ctx context.Context, n int, gen func(context.Context) (relaymedia.Result, error)) (relaymedia.Result, error) {
	if n <= 1 {
		return gen(ctx)
	}

	results := make([]relaymedia.Result, n)
	errs := make([]error, n)
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			results[i], errs[i] = gen(ctx)
		}(i)
	}
	wg.Wait()

	// First call's outcome supplies the audit fields for the merged Result.
	merged := results[0]
	merged.URLs = nil

	var allURLs []string
	var lastErr error
	anyOK := false
	for i := 0; i < n; i++ {
		if errs[i] != nil {
			lastErr = errs[i]
			continue
		}
		anyOK = true
		allURLs = append(allURLs, results[i].URLs...)
	}

	if !anyOK {
		// All calls failed: return first call's audit fields with the last error.
		return merged, lastErr
	}
	merged.URLs = allURLs
	return merged, nil
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
// preserving the audit fields even on failure. On success the relay-hosted media
// is re-hosted onto our own storage so the frontend always loads it from a
// stable, trusted host (relay CDNs vary and some are blocked client-side).
func (p *relayProviderClient) result(ctx context.Context, res relaymedia.Result, err error) (GenerateResult, error) {
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
		urls := p.rehost(ctx, res.URLs)
		out.ResultURL = urls[0]
		out.URLs = urls
	}
	return out, nil
}

// rehost downloads each relay-hosted result and re-uploads it to our storage
// (OSS), returning the stable public URLs. On any failure the original relay URL
// is kept so generation still succeeds — just on the upstream host. The downloads
// run concurrently so a multi-image batch (or a slow/retrying CDN) does not
// serialize: worst-case wall time is one slowest URL, not their sum.
func (p *relayProviderClient) rehost(ctx context.Context, urls []string) []string {
	if p.store == nil || len(urls) == 0 {
		return urls
	}
	out := make([]string, len(urls))
	var wg sync.WaitGroup
	for i, u := range urls {
		wg.Add(1)
		go func(i int, u string) {
			defer wg.Done()
			if saved, err := p.saveRemote(ctx, u); err == nil && saved != "" {
				out[i] = saved
			} else {
				out[i] = u
			}
		}(i, u)
	}
	wg.Wait()
	return out
}

// rehostRetries is how many times a relay-media download is attempted before
// giving up. The relay's result CDNs intermittently drop connections mid-transfer
// ("connection forcibly closed"); a single attempt would then fall back to the
// ephemeral relay URL, which expires — so a couple of quick retries materially
// raise the share of results that make it onto our durable OSS.
const rehostRetries = 3

// saveRemote downloads srcURL and stores its bytes under a deterministic key,
// returning the public URL on our storage. The download (fetch + full read) is
// retried on transient failures; the OSS upload is not (it is reliable and a
// retry would re-download needlessly).
func (p *relayProviderClient) saveRemote(ctx context.Context, srcURL string) (string, error) {
	data, ct, err := fetchRemote(ctx, srcURL)
	if err != nil {
		return "", err
	}
	key := "gen/" + sha1Hex(srcURL) + mediaExt(srcURL, ct)
	if ct == "" {
		ct = "application/octet-stream"
	}
	// Hand storage a *bytes.Reader, never the raw *io.LimitedReader: the Aliyun OSS
	// SDK reads a LimitedReader's .N field as the Content-Length, advertising 64MB
	// for a 700KB image, which the HTTP transport rejects ("ContentLength=... with
	// Body length ...") so the upload fails and we silently fall back to the
	// ephemeral relay URL. A bytes.Reader exposes its true length.
	return p.store.Save(ctx, key, bytes.NewReader(data), ct)
}

// fetchRemote downloads srcURL into memory (capped at maxRehostBytes so a
// misbehaving upstream can't exhaust memory), retrying the whole fetch+read on
// transient network/HTTP errors. Returns the bytes and the response Content-Type.
func fetchRemote(ctx context.Context, srcURL string) ([]byte, string, error) {
	var lastErr error
	for attempt := 1; attempt <= rehostRetries; attempt++ {
		data, ct, err := fetchOnce(ctx, srcURL)
		if err == nil {
			return data, ct, nil
		}
		lastErr = err
		if ctx.Err() != nil {
			break // caller cancelled / deadline exceeded — stop retrying
		}
		if attempt < rehostRetries {
			// brief linear backoff (0.5s, 1.0s) before the next try
			select {
			case <-ctx.Done():
			case <-time.After(time.Duration(attempt) * 500 * time.Millisecond):
			}
		}
	}
	return nil, "", lastErr
}

// maxRehostBytes caps an in-memory rehost download. Generous enough for short AI
// videos; images are far smaller. A body that exceeds it is treated as an error
// (not silently truncated) so we never store a corrupt file under a SUCCESS URL.
const maxRehostBytes = 256 << 20

// fetchOnce performs a single download attempt.
func fetchOnce(ctx context.Context, srcURL string) ([]byte, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, srcURL, nil)
	if err != nil {
		return nil, "", err
	}
	resp, err := rehostHC.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, "", fmt.Errorf("relay rehost: fetch %s: HTTP %d", srcURL, resp.StatusCode)
	}
	// Read one byte past the cap so an oversized body is detected rather than
	// silently truncated to a corrupt file (io.LimitReader + io.ReadAll would
	// otherwise return the truncated bytes with a nil error).
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxRehostBytes+1))
	if err != nil {
		return nil, "", fmt.Errorf("relay rehost: read body: %w", err)
	}
	if int64(len(data)) > maxRehostBytes {
		return nil, "", fmt.Errorf("relay rehost: %s exceeds %d MB cap", srcURL, maxRehostBytes>>20)
	}
	return data, strings.TrimSpace(resp.Header.Get("Content-Type")), nil
}

func sha1Hex(s string) string {
	sum := sha1.Sum([]byte(s))
	return hex.EncodeToString(sum[:])
}

// mediaExt picks a file extension from the URL path, falling back to the
// content-type, then ".png".
func mediaExt(srcURL, contentType string) string {
	if u, err := url.Parse(srcURL); err == nil {
		if e := strings.ToLower(path.Ext(u.Path)); e != "" && len(e) <= 5 {
			return e
		}
	}
	switch {
	case strings.Contains(contentType, "jpeg"):
		return ".jpg"
	case strings.Contains(contentType, "webp"):
		return ".webp"
	case strings.Contains(contentType, "mp4"):
		return ".mp4"
	case strings.Contains(contentType, "png"):
		return ".png"
	}
	return ".png"
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
