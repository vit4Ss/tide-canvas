package ai

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path"
	"strconv"
	"strings"
	"sync"
	"time"

	"tidecanvas/internal/pkg/relaymedia"
	"tidecanvas/internal/pkg/safefetch"
	"tidecanvas/internal/pkg/storage"
)

// rehostHC downloads relay-hosted result media so it can be re-uploaded to our
// own storage; generous timeout for multi-MB images.
var rehostHC = safefetch.NewClient(90*time.Second, nil)

// rehostSlots bounds relay-result downloads across all generation tasks in this
// process. Each transfer may spool up to maxRehostBytes, so a per-run limit is
// insufficient when several tasks finish together.
var rehostSlots = make(chan struct{}, 2)

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
//	generate_3d         -> POST /v1/3d/generations
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
	case "text_to_audio":
		res, err := p.c.GenerateAudio(ctx, audioParams(model, req.Input))
		return p.result(ctx, res, err)
	case "generate_3d":
		res, err := p.c.Generate3D(ctx, p.threeDParams(model, req.Input))
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
			// 子 goroutine 的 panic 不会被 runTask 的 defer recover 兜住(Go 语义),
			// 不 recover 会崩掉整个进程。这里就地捕获并转成本路 error。
			defer func() {
				if r := recover(); r != nil {
					errs[i] = fmt.Errorf("panic in batch image #%d: %v", i, r)
				}
			}()
			results[i], errs[i] = gen(ctx)
		}(i)
	}
	wg.Wait()

	// Audit fields come from the first SUCCESSFUL call so the generation /
	// model-call log mirrors a request that actually produced a result. Taking
	// them from results[0] unconditionally would, when call #0 failed but a
	// sibling succeeded, record the failed call's (empty/error) ResponseBody and
	// HTTPStatus against a SUCCESS task — corrupting the audit trail. Falls back
	// to results[0] only when every call failed.
	auditIdx := 0
	for i := 0; i < n; i++ {
		if errs[i] == nil {
			auditIdx = i
			break
		}
	}
	merged := results[auditIdx]
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

// audioParams maps the studio input to an audio request. Suno 灵感模式只有
// prompt(音乐描述);自定义模式的歌词/风格/歌名等既接受打平的顶层键(创作台
// 表单),也接受一个完整的 extras 对象(高级透传),顶层键优先级更高。
func audioParams(model string, in map[string]any) relaymedia.AudioParams {
	extras := map[string]any{}
	if raw, ok := in["extras"].(map[string]any); ok {
		for k, v := range raw {
			extras[k] = v
		}
	}
	// 顶层便捷键 → extras 规范键(与 relay 文档一致)。
	for from, to := range map[string]string{
		"lyrics":        "lyrics",
		"tags":          "tags",
		"title":         "title",
		"negativeTags":  "negative_tags",
		"negative_tags": "negative_tags",
	} {
		if v := inputStr(in, from); v != "" {
			extras[to] = v
		}
	}
	if v, ok := inputBool(in, "makeInstrumental", "make_instrumental"); ok {
		extras["make_instrumental"] = v
	}
	input := inputStr(in, "prompt", "input")
	// Suno 延长/翻唱:供应商校验顶层 prompt 与 gpt_description_prompt 不可同时缺席
	// (否则 HTTP 400 "can not both null")。经实测,供应商只认「顶层 prompt」——
	// extras.prompt / extras.gpt_description_prompt / 顶层 gpt_description_prompt
	// 均无效,唯有顶层 prompt 或 extras.lyrics 能过。故引用型任务(extend/cover,
	// 不含 upload 登记)的描述改走顶层 prompt,且**不再发 input**(避免 input+prompt
	// 双发,与实测通过的最小载荷一致);既无歌词也无描述时补一句默认指令,
	// 让「留空 = 自动续写」成立。灵感/TTS/音效不受影响,仍走原 input 载荷。
	prompt := ""
	switch t, _ := extras["task"].(string); t {
	case "extend", "upload_extend", "cover":
		if desc := strings.TrimSpace(input); desc != "" {
			prompt = desc
		} else if strings.TrimSpace(inputStr(extras, "lyrics")) == "" {
			if t == "cover" {
				prompt = "在保留原曲旋律与结构的基础上重新演绎，保持整体连贯。"
			} else {
				prompt = "在保持原曲旋律、风格与情绪的基础上自然续写，保持整体连贯。"
			}
		}
		input = "" // 描述已进 prompt,清空 input 只保留一处,避免上游双字段歧义
	}
	return relaymedia.AudioParams{
		Model:        model,
		Input:        input,
		Prompt:       prompt,
		Voice:        inputStr(in, "voice"),
		Instructions: inputStr(in, "instructions", "style"),
		Extras:       extras,
	}
}

func (p *relayProviderClient) threeDParams(model string, in map[string]any) relaymedia.ThreeDParams {
	views := make([]relaymedia.ThreeDViewImage, 0, 8)
	for _, key := range []string{"multiViewImages", "multi_view_images"} {
		raw, ok := in[key].([]any)
		if !ok {
			continue
		}
		for _, item := range raw {
			row, ok := item.(map[string]any)
			if !ok {
				continue
			}
			views = append(views, relaymedia.ThreeDViewImage{
				ViewType:        inputStr(row, "viewType", "view_type"),
				ViewImageURL:    p.upstreamURL(inputStr(row, "viewImageUrl", "view_image_url")),
				ViewImageBase64: inputStr(row, "viewImageBase64", "view_image_base64"),
			})
		}
		break
	}
	enablePBR, _ := inputBool(in, "enablePbr", "enable_pbr")
	return relaymedia.ThreeDParams{
		Model:           model,
		Prompt:          inputStr(in, "prompt"),
		ImageURL:        p.upstreamURL(inputStr(in, "imageUrl", "image_url", "sourceImage")),
		MultiViewImages: views,
		EnablePBR:       enablePBR,
		FaceCount:       inputInt(in, "faceCount", "face_count"),
		GenerateType:    inputStr(in, "generateType", "generate_type"),
		ResultFormat:    inputStr(in, "resultFormat", "result_format"),
	}
}

// inputBool returns the first key present coerced to a bool, and whether any
// key was found (absent ≠ false: Suno 的 make_instrumental 不传与传 false 不同).
func inputBool(in map[string]any, keys ...string) (bool, bool) {
	for _, k := range keys {
		switch v := in[k].(type) {
		case bool:
			return v, true
		case string:
			if s := strings.ToLower(strings.TrimSpace(v)); s == "true" || s == "1" {
				return true, true
			} else if s == "false" || s == "0" {
				return false, true
			}
		}
	}
	return false, false
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
	if len(res.Assets) > 0 {
		// Relay mirrors the canonical GLB/requested format to persistent storage.
		// Preserve model-file URLs directly: the image/video rehost pipeline rejects
		// model MIME types and would otherwise discard format + preview metadata.
		if len(res.URLs) > 0 {
			out.ResultURL = res.URLs[0]
			out.URLs = append([]string(nil), res.URLs...)
		}
		assets := make([]map[string]any, 0, len(res.Assets))
		for _, asset := range res.Assets {
			row := map[string]any{"type": asset.Type, "url": asset.URL}
			if asset.PreviewImageURL != "" {
				row["previewImageUrl"] = asset.PreviewImageURL
			}
			assets = append(assets, row)
		}
		out.Meta = map[string]any{"assets": assets}
		return out, nil
	}
	if len(res.URLs) > 0 {
		urls := p.rehost(ctx, res.URLs)
		out.ResultURL = urls[0]
		out.URLs = urls
		// Suno 分轨明细进 Meta["tracks"]（随 resultMeta 落库）：clip_id 是延长/
		// 翻唱后续任务的引用。播放地址与 URLs 同序，指向 rehost 后的稳定 URL。
		if len(res.Tracks) > 0 {
			tracks := make([]map[string]any, 0, len(res.Tracks))
			for i, t := range res.Tracks {
				u := t.URL
				if i < len(urls) {
					u = urls[i]
				}
				tracks = append(tracks, map[string]any{
					"clipId":   t.ClipID,
					"title":    t.Title,
					"coverUrl": t.CoverURL,
					"duration": t.Duration,
					"url":      u,
				})
			}
			if out.Meta == nil {
				out.Meta = map[string]any{}
			}
			out.Meta["tracks"] = tracks
		}
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
	out := append([]string(nil), urls...)
	var wg sync.WaitGroup
	for i, u := range urls {
		wg.Add(1)
		go func(i int, u string) {
			defer wg.Done()
			select {
			case rehostSlots <- struct{}{}:
				defer func() { <-rehostSlots }()
			case <-ctx.Done():
				return
			}
			// 子 goroutine panic 需就地 recover(否则崩进程);失败/异常都回退原始 URL。
			defer func() {
				if r := recover(); r != nil {
					out[i] = u
				}
			}()
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
	// Zero-copy fast path: the relay writes results straight into OUR bucket
	// directory when the calling API key carries a storage_prefix (relay V88).
	// Such URLs are already ours — persist the canonical display URL instead of
	// downloading + re-uploading the same bytes under a second key (which also
	// doubled the bucket's storage bill). OwnsURL deliberately excludes objects
	// outside our project prefix (e.g. the relay's own uploads/ dir): those
	// still fall through to the copy below so their lifecycle stays ours.
	if p.store != nil {
		if canonical, ok := strictOwnedRelayURL(p.store, srcURL); ok {
			return canonical, nil
		}
	}
	spool, ct, err := fetchRemote(ctx, srcURL)
	if err != nil {
		return "", err
	}
	spoolName := spool.Name()
	defer func() {
		_ = spool.Close()
		_ = os.Remove(spoolName)
	}()
	key := "gen/" + sha1Hex(srcURL) + mediaExt(srcURL, ct)
	if ct == "" {
		ct = "application/octet-stream"
	}
	// *os.File exposes its real length to the OSS SDK and avoids retaining an
	// entire image/video in heap memory while it is uploaded.
	return p.store.Save(ctx, key, spool, ct)
}

func strictOwnedRelayURL(store storage.StorageStrategy, raw string) (string, bool) {
	canonical, owned := store.OwnsURL(strings.TrimSpace(raw))
	if !owned {
		return "", false
	}
	parsed, err := url.Parse(canonical)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", false
	}
	probe, err := url.Parse(store.URL("__relay_rehost_probe__"))
	if err != nil || parsed.Scheme != probe.Scheme || parsed.Host != probe.Host {
		return "", false
	}
	decoded, err := url.PathUnescape(parsed.EscapedPath())
	if err != nil || decoded != path.Clean(decoded) {
		return "", false
	}
	allowedPrefix := strings.TrimSuffix(path.Dir(probe.Path), "/") + "/"
	if !strings.HasPrefix(decoded, allowedPrefix) || decoded == allowedPrefix {
		return "", false
	}
	parsed.Path = decoded
	parsed.RawPath = ""
	return parsed.String(), true
}

// fetchRemote downloads srcURL into memory (capped at maxRehostBytes so a
// misbehaving upstream can't exhaust memory), retrying the whole fetch+read on
// transient network/HTTP errors. Returns the bytes and the response Content-Type.
func fetchRemote(ctx context.Context, srcURL string) (*os.File, string, error) {
	if _, err := safefetch.ValidateURL(srcURL); err != nil {
		return nil, "", err
	}
	var lastErr error
	for attempt := 1; attempt <= rehostRetries; attempt++ {
		spool, ct, err := fetchOnce(ctx, srcURL)
		if err == nil {
			return spool, ct, nil
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
const maxRehostBytes int64 = 100 << 20

// fetchOnce performs a single download attempt.
func fetchOnce(ctx context.Context, srcURL string) (*os.File, string, error) {
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
	if resp.ContentLength > maxRehostBytes {
		return nil, "", fmt.Errorf("relay rehost: %s exceeds %d MB cap", srcURL, maxRehostBytes>>20)
	}
	spool, err := os.CreateTemp("", "tide-relay-rehost-*")
	if err != nil {
		return nil, "", fmt.Errorf("relay rehost: create spool: %w", err)
	}
	cleanup := func() {
		name := spool.Name()
		_ = spool.Close()
		_ = os.Remove(name)
	}
	written, err := io.Copy(spool, io.LimitReader(resp.Body, maxRehostBytes+1))
	if err != nil {
		cleanup()
		return nil, "", fmt.Errorf("relay rehost: read body: %w", err)
	}
	if written > maxRehostBytes {
		cleanup()
		return nil, "", fmt.Errorf("relay rehost: %s exceeds %d MB cap", srcURL, maxRehostBytes>>20)
	}
	if _, err := spool.Seek(0, io.SeekStart); err != nil {
		cleanup()
		return nil, "", fmt.Errorf("relay rehost: rewind spool: %w", err)
	}
	contentType, err := normalizeRehostContentType(resp.Header.Get("Content-Type"), srcURL)
	if err != nil {
		cleanup()
		return nil, "", err
	}
	return spool, contentType, nil
}

func normalizeRehostContentType(raw, srcURL string) (string, error) {
	contentType, _, err := mime.ParseMediaType(strings.TrimSpace(raw))
	if err != nil {
		contentType = ""
	}
	contentType = strings.ToLower(contentType)
	if contentType == "" || contentType == "application/octet-stream" {
		contentType = rehostMIMEByExtension(strings.ToLower(path.Ext(parsedURLPath(srcURL))))
	}
	if (strings.HasPrefix(contentType, "image/") && contentType != "image/svg+xml") ||
		strings.HasPrefix(contentType, "video/") || strings.HasPrefix(contentType, "audio/") {
		return contentType, nil
	}
	return "", errors.New("relay rehost: response is not a supported media type")
}

func parsedURLPath(raw string) string {
	if parsed, err := url.Parse(raw); err == nil {
		return parsed.Path
	}
	return ""
}

func rehostMIMEByExtension(ext string) string {
	switch ext {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".webp":
		return "image/webp"
	case ".gif":
		return "image/gif"
	case ".avif":
		return "image/avif"
	case ".mp4", ".m4v":
		return "video/mp4"
	case ".webm":
		return "video/webm"
	case ".mov":
		return "video/quicktime"
	case ".mp3":
		return "audio/mpeg"
	case ".wav":
		return "audio/wav"
	case ".m4a":
		return "audio/mp4"
	case ".ogg":
		return "audio/ogg"
	case ".flac":
		return "audio/flac"
	default:
		return ""
	}
}

func sha1Hex(s string) string {
	sum := sha1.Sum([]byte(s))
	return hex.EncodeToString(sum[:])
}

// mediaExt picks a file extension from the URL path, falling back to the
// content-type, then ".png".
func mediaExt(srcURL, contentType string) string {
	if u, err := url.Parse(srcURL); err == nil {
		if e := strings.ToLower(path.Ext(u.Path)); rehostMIMEByExtension(e) != "" {
			if e == ".jpeg" {
				return ".jpg"
			}
			return e
		}
	}
	switch {
	case strings.Contains(contentType, "jpeg"):
		return ".jpg"
	case strings.Contains(contentType, "webp"):
		return ".webp"
	case strings.Contains(contentType, "gif"):
		return ".gif"
	case strings.Contains(contentType, "avif"):
		return ".avif"
	case strings.Contains(contentType, "webm"):
		return ".webm"
	case strings.Contains(contentType, "quicktime"):
		return ".mov"
	case strings.Contains(contentType, "mp4"):
		return ".mp4"
	case strings.Contains(contentType, "png"):
		return ".png"
	case strings.Contains(contentType, "mpeg"), strings.Contains(contentType, "mp3"):
		return ".mp3"
	case strings.Contains(contentType, "wav"):
		return ".wav"
	case strings.Contains(contentType, "ogg"):
		return ".ogg"
	case strings.Contains(contentType, "flac"):
		return ".flac"
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
