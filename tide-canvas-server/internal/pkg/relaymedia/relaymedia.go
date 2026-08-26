// Package relaymedia is a thin client for the ScarecrowToken relay's
// OpenAI-compatible media generation endpoints:
//
//	POST {baseURL}/v1/images/generations  — text-to-image
//	POST {baseURL}/v1/images/edits        — image edit (參考图 → 新图)
//	POST {baseURL}/openapi/v1/generations — video (mode-driven: t2v/i2v/keyframe/multi_ref)
//	POST {baseURL}/v1/audio/speech        — audio (TTS 与音乐/音效共用,由模型决定上游)
//	POST {baseURL}/v1/3d/generations      — Hunyuan 3D 3.1 (text/image/multi-view)
//	POST {baseURL}/v1/video/upscale       — WaveSpeedAI 视频超分(公网视频 URL)
//	GET  {baseURL}/v1/tasks/{id}          — poll an async task
//
// All generation endpoints share one response contract: a synchronous 200
// with the result data, or an asynchronous 202 carrying a task id that must be
// polled at /v1/tasks/{id} until it reaches a terminal state. This client hides
// that difference — the public methods always block until a terminal result and
// return the produced media URL(s).
//
// The client is nil when no relay API key is configured; callers then fall back
// to the stub provider so the server stays runnable without credentials.
package relaymedia

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// Endpoint paths.
const (
	pathImageGenerations = "/v1/images/generations"
	pathImageEdits       = "/v1/images/edits"
	pathVideoGenerations = "/openapi/v1/generations"
	pathAudioSpeech      = "/v1/audio/speech"
	path3DGenerations    = "/v1/3d/generations"
	pathVideoUpscale     = "/v1/video/upscale"
)

// MaxThreeDMultiViewImages is the protocol-level cap accepted by Relay's 3D endpoint.
const MaxThreeDMultiViewImages = 8

// Tuning constants. The relay's synchronous image path can hold the connection
// for well over a minute (the model runs inline); videos are almost always async
// and can run for several minutes. Each call runs under the per-medium context
// deadline below — we deliberately do NOT set a fixed http.Client.Timeout, which
// would preempt that deadline and abort a still-running synchronous generation.
const (
	pollInterval       = 2 * time.Second  // gap between task polls
	imagePollDeadline  = 10 * time.Minute // overall budget for an image task (sync or polled)
	videoPollDeadline  = 40 * time.Minute // 视频排队/生成较慢，提交与轮询共用 40 分钟总预算
	audioPollDeadline  = 10 * time.Minute // TTS 通常同步秒回;Suno 音乐约 1–4 分钟(实测也会同步 200)
	threeDPollDeadline = 25 * time.Minute // 3D 通常异步，留足网格与材质生成时间
	// 超分按输入时长处理(WaveSpeed 单任务最长收 10 分钟视频),4k 长片会很慢，
	// 超分保持 20 分钟独立预算，不随普通视频生成的 40 分钟上限调整。
	upscalePollDeadline = 20 * time.Minute
)

// maxRespBody caps a single relay response read. Generous enough to hold verbose
// multi-entry results or inline b64_json (a 1 MB cap was truncating legitimate
// responses into parse failures), while still bounding memory per call.
const maxRespBody int64 = 32 << 20 // 32 MB

// Client calls the relay's media endpoints with a Bearer API key.
type Client struct {
	baseURL string
	apiKey  string
	hc      *http.Client
}

// New returns a client, or nil when no API key is configured (so the caller can
// fall back to the stub). An empty baseURL defaults to the test relay so an
// incompletely configured local process cannot send traffic to production.
func New(baseURL, apiKey string) *Client {
	apiKey = strings.TrimSpace(apiKey)
	if apiKey == "" {
		return nil
	}
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		baseURL = "https://test-relay.tcmzhan.com"
	}
	// No fixed client Timeout: each request is bounded by the per-medium context
	// deadline (see submit), so a slow synchronous generation isn't cut off early.
	return &Client{baseURL: baseURL, apiKey: apiKey, hc: &http.Client{}}
}

// ImageParams is a normalized image request. ImageURLs is only used by EditImage;
// the optional fields are sent only when non-empty so the relay applies its own
// defaults for anything the model does not need.
type ImageParams struct {
	Model       string
	Prompt      string
	Quality     string   // low | medium | high
	Resolution  string   // 1k | 2k | 4k
	AspectRatio string   // 1:1 | 16:9 | 9:16 …
	ImageURLs   []string // edits only: reference frames (1–16 public URLs)
}

// VideoParams is a normalized video request for the mode-driven endpoint. Which
// media fields apply depends on Mode (see provider routing); empty fields are
// omitted so the relay's per-model schema validation only sees what was set.
type VideoParams struct {
	Model      string
	Mode       string // text_to_video | image_to_video | first_last_frame | multi_ref
	Prompt     string
	ImageURL   string   // image_to_video: single source frame
	ImageURLs  []string // first_last_frame: [first,last]; multi_ref: reference images
	VideoURLs  []string // multi_ref: reference videos
	AudioURLs  []string // multi_ref: reference audio
	Ratio      string   // 16:9 | 9:16 | adaptive …
	Resolution string   // 480p | 720p | 1080p
	Duration   int      // whole seconds; omitted when ≤ 0
}

// AudioParams is a normalized audio request (TTS / 音乐 / 音效共用端点,上游由模型
// 决定)。Input 是要合成的文本(TTS)或音乐描述(Suno 灵感模式);Suno 自定义歌词
// 模式把歌词等放进 Extras(lyrics/tags/title/make_instrumental …)并可省略 Input。
type AudioParams struct {
	Model        string
	Input        string         // TTS 文本 / 音乐描述;Extras 含 lyrics 时可为空
	Prompt       string         // 顶层 prompt:Suno 延长/翻唱的歌曲描述(供应商只认顶层 prompt)
	Voice        string         // TTS 音色 id;音乐模型忽略
	Instructions string         // 情绪/风格;Suno 传 "instrumental" 生成纯音乐
	Extras       map[string]any // 供应商透传参数(≤32 键/16KB),如 Suno lyrics/tags/title
}

// UpscaleParams is a normalized video-upscale request (POST /v1/video/upscale)。
// 只做超分,不接收 prompt;VideoURL 必须是公网可访问的 http(s) 地址,且在任务
// 提交与上游处理期间保持有效(WaveSpeedAI 从该地址拉取原视频)。
type UpscaleParams struct {
	Model            string
	VideoURL         string
	TargetResolution string // 720p | 1080p | 2k | 4k;空 = 上游默认 1080p
}

type ThreeDViewImage struct {
	ViewType        string
	ViewImageURL    string
	ViewImageBase64 string
}

type ThreeDParams struct {
	Model           string
	Prompt          string
	ImageURL        string
	MultiViewImages []ThreeDViewImage
	EnablePBR       bool
	FaceCount       int
	GenerateType    string
	ResultFormat    string
}

// Result is the normalized terminal outcome. URLs holds every produced media file
// (usually one). The audit fields mirror the upstream call for the generation
// log; they are populated even when the call ultimately fails.
type Result struct {
	URLs   []string
	Tracks []Track // Suno 音乐任务的分轨明细(与 URLs 同序);其它任务为空
	Assets []Asset // 3D 的多格式文件（通常 OBJ + GLB）及预览图
	TaskID string
	Status string

	RequestURL   string
	RequestBody  string
	ResponseBody string
	HTTPStatus   int
}

type Asset struct {
	Type            string `json:"type"`
	URL             string `json:"url"`
	PreviewImageURL string `json:"preview_image_url,omitempty"`
}

// Track is one Suno song from /v1/tasks/{id}'s tracks[]. ClipID 是延长(extend)/
// 翻唱(cover)后续任务的关键引用;其余字段用于展示。
type Track struct {
	ClipID   string
	Title    string
	CoverURL string
	Duration float64 // seconds
	URL      string
}

// mediaResp is the OpenAI-shaped response, reused for the create call and the
// task-poll call (the relay returns the same envelope on success).
type mediaAsset struct {
	Type            string `json:"type"`
	URL             string `json:"url"`
	PreviewImageURL string `json:"preview_image_url"`
	B64JSON         string `json:"b64_json"`
}

type mediaResp struct {
	Created int64        `json:"created"`
	ID      string       `json:"id"`
	Status  string       `json:"status"`
	Model   string       `json:"model"`
	Data    []mediaAsset `json:"data"`
	Assets  []mediaAsset `json:"assets"`
	// 部分任务接口把失败信息平铺在顶层，而不是放进 OpenAI 风格的
	// error 对象，例如 error_message="InputImageRisk (2039)"、
	// error_code=5001。RawMessage 兼容数字与字符串业务码。
	ErrorMessage string          `json:"error_message"`
	ErrorType    string          `json:"error_type"`
	ErrorCode    json.RawMessage `json:"error_code"`
	// 音频任务的结果字段:/v1/audio/speech 同步 200 带 audio.url;/v1/tasks/{id}
	// 上多输出(Suno 两首)的全集在 output_urls,单输出在 output_url。
	OutputURL  string   `json:"output_url"`
	OutputURLs []string `json:"output_urls"`
	Audio      *struct {
		URL string `json:"url"`
	} `json:"audio"`
	// Suno 音乐任务的分轨明细(仅 /v1/tasks/{id} 返回):clip_id 供延长/翻唱引用。
	Tracks []struct {
		ClipID   string  `json:"clip_id"`
		Title    string  `json:"title"`
		CoverURL string  `json:"cover_url"`
		ImageURL string  `json:"image_url"`
		Duration float64 `json:"duration"`
		URL      string  `json:"url"`
		AudioURL string  `json:"audio_url"`
	} `json:"tracks"`
	Error *mediaError `json:"error"`
}

// mediaTracks normalizes mr.Tracks (封面/音频 URL 字段兼容两种命名)。
func mediaTracks(mr mediaResp) []Track {
	if len(mr.Tracks) == 0 {
		return nil
	}
	out := make([]Track, 0, len(mr.Tracks))
	for _, t := range mr.Tracks {
		cover := strings.TrimSpace(t.CoverURL)
		if cover == "" {
			cover = strings.TrimSpace(t.ImageURL)
		}
		url := strings.TrimSpace(t.URL)
		if url == "" {
			url = strings.TrimSpace(t.AudioURL)
		}
		out = append(out, Track{
			ClipID:   strings.TrimSpace(t.ClipID),
			Title:    strings.TrimSpace(t.Title),
			CoverURL: cover,
			Duration: t.Duration,
			URL:      url,
		})
	}
	return out
}

// mediaError tolerates the relay's两种错误体：OpenAI 对象形
// {"error":{"message","type","code"}} 与部分 4xx 返回的纯字符串形
// {"error":"..."}——严格结构曾让 400 的真实原因被解析错误吞掉
// （用户实测 2026-07-13）。code 兼容数字与字符串。
type mediaError struct {
	Message string `json:"message"`
	Type    string `json:"type"`
	Code    string `json:"code"`
}

// UpstreamError preserves the relay's structured error envelope across the
// provider boundary. Callers may make product decisions from Code while Error()
// still contains Message for logs and the legacy keyword-based classifier.
type UpstreamError struct {
	HTTPStatus int
	Message    string
	Type       string
	Code       string
}

func (e *UpstreamError) Error() string {
	if e == nil {
		return "relaymedia: upstream error"
	}
	message := strings.TrimSpace(e.Message)
	if e.Code != "" && message != "" {
		return fmt.Sprintf("relaymedia: code %s: %s", e.Code, message)
	}
	if message != "" {
		return "relaymedia: " + message
	}
	if e.Code != "" {
		return fmt.Sprintf("relaymedia: code %s", e.Code)
	}
	return fmt.Sprintf("relaymedia: HTTP %d", e.HTTPStatus)
}

func (e *mediaError) UnmarshalJSON(data []byte) error {
	var s string
	if json.Unmarshal(data, &s) == nil {
		e.Message = s
		return nil
	}
	var a struct {
		Message string `json:"message"`
		Type    string `json:"type"`
		Code    any    `json:"code"`
	}
	if err := json.Unmarshal(data, &a); err != nil {
		return err
	}
	e.Message, e.Type = a.Message, a.Type
	if a.Code != nil {
		e.Code = fmt.Sprint(a.Code)
	}
	return nil
}

// GenerateImage performs a text-to-image generation (POST /v1/images/generations).
func (c *Client) GenerateImage(ctx context.Context, p ImageParams) (Result, error) {
	if err := requireModelPrompt(p.Model, p.Prompt); err != nil {
		return Result{}, err
	}
	body := map[string]any{"model": p.Model, "prompt": p.Prompt}
	putNonEmpty(body, "quality", p.Quality)
	putNonEmpty(body, "resolution", p.Resolution)
	putNonEmpty(body, "aspect_ratio", p.AspectRatio)
	return c.submit(ctx, pathImageGenerations, body, imagePollDeadline)
}

// EditImage performs an image edit from one or more reference frames
// (POST /v1/images/edits). At least one ImageURL is required.
func (c *Client) EditImage(ctx context.Context, p ImageParams) (Result, error) {
	if err := requireModelPrompt(p.Model, p.Prompt); err != nil {
		return Result{}, err
	}
	if len(p.ImageURLs) == 0 {
		return Result{}, fmt.Errorf("relaymedia: edits require at least one image url")
	}
	body := map[string]any{"model": p.Model, "prompt": p.Prompt, "image_urls": p.ImageURLs}
	putNonEmpty(body, "quality", p.Quality)
	putNonEmpty(body, "resolution", p.Resolution)
	putNonEmpty(body, "aspect_ratio", p.AspectRatio)
	return c.submit(ctx, pathImageEdits, body, imagePollDeadline)
}

// GenerateAudio performs an audio generation (POST /v1/audio/speech — TTS 与
// 音乐/音效共用)。Input 与 Extras 至少要有一个:Suno 自定义歌词模式只带 Extras。
func (c *Client) GenerateAudio(ctx context.Context, p AudioParams) (Result, error) {
	if strings.TrimSpace(p.Model) == "" {
		return Result{}, fmt.Errorf("relaymedia: model is required")
	}
	if strings.TrimSpace(p.Input) == "" && strings.TrimSpace(p.Prompt) == "" && len(p.Extras) == 0 {
		return Result{}, fmt.Errorf("relaymedia: audio requires input text or extras")
	}
	body := map[string]any{"model": p.Model}
	putNonEmpty(body, "input", p.Input)
	// 顶层 prompt:Suno 延长/翻唱的歌曲描述必须走顶层(实测 extras 内无效)
	putNonEmpty(body, "prompt", p.Prompt)
	putNonEmpty(body, "voice", p.Voice)
	putNonEmpty(body, "instructions", p.Instructions)
	if len(p.Extras) > 0 {
		body["extras"] = p.Extras
	}
	return c.submit(ctx, pathAudioSpeech, body, audioPollDeadline)
}

// GenerateVideo performs a mode-driven video generation
// (POST /openapi/v1/generations). Almost always async; polled to a final URL.
func (c *Client) GenerateVideo(ctx context.Context, p VideoParams) (Result, error) {
	if err := requireModelPrompt(p.Model, p.Prompt); err != nil {
		return Result{}, err
	}
	if strings.TrimSpace(p.Mode) == "" {
		return Result{}, fmt.Errorf("relaymedia: video mode is required")
	}
	body := map[string]any{"model": p.Model, "mode": p.Mode, "prompt": p.Prompt}
	putNonEmpty(body, "image_url", p.ImageURL)
	putNonEmptySlice(body, "image_urls", p.ImageURLs)
	putNonEmptySlice(body, "video_urls", p.VideoURLs)
	putNonEmptySlice(body, "audio_urls", p.AudioURLs)
	putNonEmpty(body, "ratio", p.Ratio)
	putNonEmpty(body, "resolution", p.Resolution)
	if p.Duration > 0 {
		body["duration"] = p.Duration
	}
	return c.submit(ctx, pathVideoGenerations, body, videoPollDeadline)
}

// Generate3D submits Hunyuan 3D 3.1 text, single-image, or multi-view input.
// The relay normally answers 202; submit transparently polls the task to a
// terminal response and this method promotes GLB (or the requested format) to
// URLs[0] while retaining every returned asset.
func (c *Client) Generate3D(ctx context.Context, p ThreeDParams) (Result, error) {
	if strings.TrimSpace(p.Model) == "" {
		return Result{}, fmt.Errorf("relaymedia: model is required")
	}
	prompt := strings.TrimSpace(p.Prompt)
	imageURL := strings.TrimSpace(p.ImageURL)
	if prompt == "" && imageURL == "" && len(p.MultiViewImages) == 0 {
		return Result{}, fmt.Errorf("relaymedia: 3d requires prompt, image_url, or multi_view_images")
	}
	inputModes := 0
	if prompt != "" {
		inputModes++
	}
	if imageURL != "" {
		inputModes++
	}
	if len(p.MultiViewImages) > 0 {
		inputModes++
	}
	if inputModes > 1 {
		return Result{}, fmt.Errorf("relaymedia: 3d prompt, single image, and multi-view images cannot be used together")
	}
	if len([]rune(prompt)) > 1024 {
		return Result{}, fmt.Errorf("relaymedia: 3d prompt is too long (maximum 1024 characters)")
	}
	if p.FaceCount != 0 && (p.FaceCount < 3000 || p.FaceCount > 1500000) {
		return Result{}, fmt.Errorf("relaymedia: 3d face_count must be between 3000 and 1500000")
	}

	generateType := strings.TrimSpace(p.GenerateType)
	if generateType == "" || strings.EqualFold(generateType, "normal") {
		generateType = "Normal"
	} else if strings.EqualFold(generateType, "geometry") {
		generateType = "Geometry"
	} else {
		return Result{}, fmt.Errorf("relaymedia: unsupported 3d generate_type %q", p.GenerateType)
	}
	resultFormat := strings.ToUpper(strings.TrimSpace(p.ResultFormat))
	if resultFormat != "" && resultFormat != "STL" && resultFormat != "USDZ" && resultFormat != "FBX" {
		return Result{}, fmt.Errorf("relaymedia: unsupported 3d result_format %q", p.ResultFormat)
	}

	viewNames := map[string]bool{
		"front": true, "left": true, "right": true, "back": true,
		"top": true, "bottom": true, "left_front": true, "right_front": true,
	}
	if len(p.MultiViewImages) > MaxThreeDMultiViewImages {
		return Result{}, fmt.Errorf("relaymedia: 3d multi_view_images supports at most %d views", MaxThreeDMultiViewImages)
	}
	seen := map[string]bool{}
	views := make([]map[string]any, 0, len(p.MultiViewImages))
	for _, view := range p.MultiViewImages {
		viewType := strings.ToLower(strings.TrimSpace(view.ViewType))
		if !viewNames[viewType] {
			return Result{}, fmt.Errorf("relaymedia: unsupported 3d view_type %q", view.ViewType)
		}
		if seen[viewType] {
			return Result{}, fmt.Errorf("relaymedia: duplicate 3d view_type %q", viewType)
		}
		seen[viewType] = true
		row := map[string]any{"view_type": viewType}
		imageURL := strings.TrimSpace(view.ViewImageURL)
		imageBase64 := strings.TrimSpace(view.ViewImageBase64)
		if imageURL != "" && imageBase64 != "" {
			return Result{}, fmt.Errorf("relaymedia: 3d view %q must contain exactly one image source", viewType)
		}
		if imageURL != "" {
			row["view_image_url"] = imageURL
		} else if imageBase64 != "" {
			row["view_image_base64"] = imageBase64
		} else {
			return Result{}, fmt.Errorf("relaymedia: 3d view %q requires an image", viewType)
		}
		views = append(views, row)
	}

	body := map[string]any{
		"model":         p.Model,
		"enable_pbr":    p.EnablePBR,
		"generate_type": generateType,
	}
	putNonEmpty(body, "prompt", prompt)
	putNonEmpty(body, "image_url", imageURL)
	if len(views) > 0 {
		body["multi_view_images"] = views
	}
	if p.FaceCount > 0 {
		body["face_count"] = p.FaceCount
	}
	putNonEmpty(body, "result_format", resultFormat)

	res, err := c.submit(ctx, path3DGenerations, body, threeDPollDeadline)
	if err != nil {
		return res, err
	}
	promoteType := strings.ToLower(resultFormat)
	if promoteType == "" {
		promoteType = "glb"
	}
	for _, asset := range res.Assets {
		if strings.EqualFold(asset.Type, promoteType) {
			res.URLs = promoteURL(asset.URL, res.URLs)
			break
		}
	}
	return res, nil
}

// UpscaleVideo submits a WaveSpeedAI video upscale (POST /v1/video/upscale)。
// 同步等待窗口内完成时 relay 直接 200 带 output_url/data[0].url;更常见的是
// 202 + task id,由 submit 透明轮询 /v1/tasks/{id} 到终态。
func (c *Client) UpscaleVideo(ctx context.Context, p UpscaleParams) (Result, error) {
	if strings.TrimSpace(p.Model) == "" {
		return Result{}, fmt.Errorf("relaymedia: model is required")
	}
	videoURL := strings.TrimSpace(p.VideoURL)
	if videoURL == "" {
		return Result{}, fmt.Errorf("relaymedia: upscale requires a video url")
	}
	if !strings.HasPrefix(videoURL, "http://") && !strings.HasPrefix(videoURL, "https://") {
		return Result{}, fmt.Errorf("relaymedia: upscale video must be a public http(s) url")
	}
	resolution := strings.ToLower(strings.TrimSpace(p.TargetResolution))
	switch resolution {
	case "", "720p", "1080p", "2k", "4k":
		// ByteDance 模型不支持 720p——各模型的档位差异交给 relay 校验,这里只拦
		// 明显不合法的档位,避免一次注定失败的提交计入任务。
	default:
		return Result{}, fmt.Errorf("relaymedia: unsupported upscale target_resolution %q", p.TargetResolution)
	}
	body := map[string]any{"model": p.Model, "video": videoURL}
	putNonEmpty(body, "target_resolution", resolution)
	return c.submit(ctx, pathVideoUpscale, body, upscalePollDeadline)
}

func promoteURL(primary string, urls []string) []string {
	primary = strings.TrimSpace(primary)
	if primary == "" {
		return urls
	}
	out := []string{primary}
	for _, item := range urls {
		item = strings.TrimSpace(item)
		if item != "" && item != primary {
			out = append(out, item)
		}
	}
	return out
}

// submit posts a generation request and resolves it to a terminal result,
// polling the task when the relay answers 202 (async). deadline bounds the whole
// operation (initial call + polling).
func (c *Client) submit(ctx context.Context, path string, body map[string]any, deadline time.Duration) (Result, error) {
	ctx, cancel := context.WithTimeout(ctx, deadline)
	defer cancel()

	payload, err := json.Marshal(body)
	if err != nil {
		return Result{}, err
	}

	url := c.baseURL + path
	res := Result{RequestURL: url, RequestBody: string(payload)}

	status, respBody, err := c.do(ctx, http.MethodPost, url, payload)
	res.HTTPStatus = status
	res.ResponseBody = string(respBody)
	if err != nil {
		return res, err
	}

	var mr mediaResp
	if jsonErr := json.Unmarshal(respBody, &mr); jsonErr != nil {
		// 非 2xx 的解析失败：把上游原文透出来（截断），而不是一条 Go json
		// 错误——那会把真实拒绝原因吞掉。
		if status < 200 || status >= 300 {
			return res, fmt.Errorf("relaymedia: HTTP %d: %s", status, snippet(respBody))
		}
		return res, fmt.Errorf("relaymedia: parse response (HTTP %d): %w", status, jsonErr)
	}
	res.TaskID = mr.ID
	res.Status = mr.Status

	// Relay may report a terminal task failure in an HTTP 2xx response. Handle
	// the structured envelope before treating a task id as deferred work, so a
	// failed create response is not needlessly polled and its business code is
	// preserved for the caller.
	if mr.Error != nil {
		return res, upstreamError(status, mr, respBody)
	}
	if taskStatusFailed(mr.Status) {
		return res, upstreamError(status, mr, respBody)
	}

	// A 2xx with inline media is synchronous success only when the response is
	// terminal (or has no status for legacy synchronous endpoints). A processing
	// task may accidentally carry provisional provider URLs; never expose those
	// before the relay finishes its own durable transfer.
	if status >= 200 && status < 300 {
		urls := mediaURLs(mr)
		inlineSuccess := len(urls) > 0 && (strings.TrimSpace(mr.Status) == "" || taskStatusSucceeded(mr.Status))
		if inlineSuccess {
			res.URLs = urls
			res.Assets = mediaAssets(mr)
			res.Tracks = mediaTracks(mr)
			// Suno 实测(2026-07-18)会同步 200 且 data 只带主歌:两首全集
			// output_urls 与分轨 tracks(clip_id 供延长/翻唱)只在 /v1/tasks/{id}。
			// 带 task id 的音频结果补查一次任务详情取全集;失败不致命,保留内联结果。
			if path == pathAudioSpeech && mr.ID != "" {
				c.enrichAudio(ctx, mr.ID, &res)
			}
			return res, nil
		}
		// 2xx but no inline media: the relay deferred to a task (the usual 202
		// path, and the occasional 200 that still carries only a task id). Poll it.
		if mr.ID != "" {
			return c.poll(ctx, mr.ID, res)
		}
		if len(urls) > 0 {
			return res, fmt.Errorf("relaymedia: HTTP %d returned provisional media for non-terminal status %q without task id", status, mr.Status)
		}
		return res, fmt.Errorf("relaymedia: HTTP %d with neither media url nor task id", status)
	}
	return res, upstreamError(status, mr, respBody)
}

// enrichAudio swaps an inline audio result for the fuller /v1/tasks/{id} view
// when the latter carries more:同步 200 的 data 只回主歌,两首全集在任务详情的
// output_urls,clip_id(延长/翻唱引用)只在 tracks[]。Best-effort:请求失败、
// 解析失败或详情不比内联结果全时,原样保留内联的单首结果。
func (c *Client) enrichAudio(ctx context.Context, taskID string, res *Result) {
	status, respBody, err := c.do(ctx, http.MethodGet, c.baseURL+"/v1/tasks/"+taskID, nil)
	if err != nil || status < 200 || status >= 300 {
		return
	}
	var mr mediaResp
	if json.Unmarshal(respBody, &mr) != nil || mr.Error != nil {
		return
	}
	if strings.TrimSpace(mr.Status) != "" && !taskStatusSucceeded(mr.Status) {
		return
	}
	urls := mediaURLs(mr)
	tracks := mediaTracks(mr)
	if len(urls) < len(res.URLs) || (len(urls) == len(res.URLs) && len(tracks) == 0) {
		return
	}
	res.URLs = urls
	res.Assets = mediaAssets(mr)
	res.Tracks = tracks
	res.HTTPStatus = status
	res.ResponseBody = string(respBody)
	if mr.Status != "" {
		res.Status = mr.Status
	}
}

// poll repeatedly GETs /v1/tasks/{id} until the task reaches a terminal state or
// the context deadline fires. base carries the audit fields from the create
// call; the response/status fields are refreshed with each poll.
func (c *Client) poll(ctx context.Context, taskID string, base Result) (Result, error) {
	url := c.baseURL + "/v1/tasks/" + taskID
	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()

	for {
		status, respBody, err := c.do(ctx, http.MethodGet, url, nil)
		base.HTTPStatus = status
		base.ResponseBody = string(respBody)
		if err != nil {
			return base, fmt.Errorf("relaymedia: poll task %s: %w", taskID, err)
		}

		var mr mediaResp
		if jsonErr := json.Unmarshal(respBody, &mr); jsonErr != nil {
			if status < 200 || status >= 300 {
				return base, fmt.Errorf("relaymedia: poll task %s: HTTP %d: %s", taskID, status, snippet(respBody))
			}
			return base, fmt.Errorf("relaymedia: parse task %s (HTTP %d): %w", taskID, status, jsonErr)
		}
		if mr.Status != "" {
			base.Status = mr.Status
		}

		// A populated error envelope is terminal regardless of the status string.
		if mr.Error != nil {
			return base, upstreamError(status, mr, respBody)
		}

		switch {
		case taskStatusSucceeded(mr.Status):
			if status < 200 || status >= 300 {
				return base, upstreamError(status, mr, respBody)
			}
			urls := mediaURLs(mr)
			if len(urls) == 0 {
				return base, fmt.Errorf("relaymedia: task %s succeeded with no media url", taskID)
			}
			base.URLs = urls
			base.Assets = mediaAssets(mr)
			base.Tracks = mediaTracks(mr)
			return base, nil
		case taskStatusFailed(mr.Status):
			return base, upstreamError(status, mr, respBody)
		default:
			// queued / processing / running … keep waiting. But a non-2xx HTTP
			// status with no recognizable task status is terminal — never spin to
			// the deadline on an error the relay reported only via the HTTP code.
			if status >= 400 {
				return base, upstreamError(status, mr, respBody)
			}
		}

		select {
		case <-ctx.Done():
			return base, fmt.Errorf("relaymedia: task %s timed out: %w", taskID, ctx.Err())
		case <-ticker.C:
		}
	}
}

func taskStatusSucceeded(raw string) bool {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "succeeded", "success", "completed", "complete":
		return true
	default:
		return false
	}
}

func taskStatusFailed(raw string) bool {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "failed", "error", "cancelled", "canceled":
		return true
	default:
		return false
	}
}

// do performs one authenticated HTTP call and returns (status, body, error).
func (c *Client) do(ctx context.Context, method, url string, payload []byte) (int, []byte, error) {
	var rdr io.Reader
	if payload != nil {
		rdr = bytes.NewReader(payload)
	}
	req, err := http.NewRequestWithContext(ctx, method, url, rdr)
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Accept", "application/json")
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := c.hc.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	// Cap at maxRespBody but detect truncation: a legitimate response can exceed
	// 1 MB (multiple data entries, verbose metadata, or inline b64_json), and
	// silently truncating it turns a completed generation into a JSON-parse
	// failure the user sees as a hard error. Reading one extra byte lets us tell
	// "body too large" apart from a real parse error.
	lr := io.LimitReader(resp.Body, maxRespBody+1)
	body, err := io.ReadAll(lr)
	if err != nil {
		return resp.StatusCode, nil, err
	}
	if int64(len(body)) > maxRespBody {
		return resp.StatusCode, nil, fmt.Errorf("relaymedia: response body exceeds %d bytes", maxRespBody)
	}
	return resp.StatusCode, body, nil
}

// requireModelPrompt validates the two fields every endpoint needs.
func requireModelPrompt(model, prompt string) error {
	if strings.TrimSpace(model) == "" {
		return fmt.Errorf("relaymedia: model is required")
	}
	if strings.TrimSpace(prompt) == "" {
		return fmt.Errorf("relaymedia: prompt is required")
	}
	return nil
}

// putNonEmpty sets key=val only when val is non-blank.
func putNonEmpty(m map[string]any, key, val string) {
	if strings.TrimSpace(val) != "" {
		m[key] = val
	}
}

// putNonEmptySlice sets key=vals only when at least one element is present.
func putNonEmptySlice(m map[string]any, key string, vals []string) {
	if len(vals) > 0 {
		m[key] = vals
	}
}

// mediaURLs extracts the non-empty result URLs from a response. data[] 为主;
// 音频任务的全集可能只在 output_urls(Suno 两首,同步 200 的 data 仅回主歌),
// 取两者中更全的一组;都空时兜底 output_url / audio.url。
func mediaURLs(mr mediaResp) []string {
	out := make([]string, 0, len(mr.Data))
	for _, d := range mr.Data {
		if u := strings.TrimSpace(d.URL); u != "" {
			out = append(out, u)
		}
	}
	if assets := mediaAssets(mr); len(assets) > len(out) {
		out = out[:0]
		for _, asset := range assets {
			out = append(out, asset.URL)
		}
	}
	if len(mr.OutputURLs) > len(out) {
		alt := make([]string, 0, len(mr.OutputURLs))
		for _, u := range mr.OutputURLs {
			if u = strings.TrimSpace(u); u != "" {
				alt = append(alt, u)
			}
		}
		if len(alt) > len(out) {
			out = alt
		}
	}
	if len(out) == 0 {
		if u := strings.TrimSpace(mr.OutputURL); u != "" {
			out = append(out, u)
		} else if mr.Audio != nil {
			if u := strings.TrimSpace(mr.Audio.URL); u != "" {
				out = append(out, u)
			}
		}
	}
	return out
}

func mediaAssets(mr mediaResp) []Asset {
	raw := mr.Assets
	fromAssetField := len(raw) > 0
	if len(raw) == 0 {
		raw = mr.Data
	}
	out := make([]Asset, 0, len(raw))
	for _, item := range raw {
		url := strings.TrimSpace(item.URL)
		typeName := strings.ToLower(strings.TrimSpace(item.Type))
		preview := strings.TrimSpace(item.PreviewImageURL)
		// Synchronous 3D uses data[] while async polling uses assets[]. When
		// falling back to data[], only accept known model-file formats so a future
		// image/audio response carrying a generic `type` does not bypass rehosting.
		known3DType := typeName == "obj" || typeName == "glb" || typeName == "stl" || typeName == "usdz" || typeName == "fbx"
		if url == "" || (!fromAssetField && !known3DType) {
			continue
		}
		out = append(out, Asset{Type: typeName, URL: url, PreviewImageURL: preview})
	}
	return out
}

// upstreamError builds an error from the relay's OpenAI error envelope, falling
// back to the raw body when the envelope is absent.
func upstreamError(status int, mr mediaResp, raw []byte) error {
	if mr.Error != nil {
		return &UpstreamError{
			HTTPStatus: status,
			Message:    strings.TrimSpace(mr.Error.Message),
			Type:       strings.TrimSpace(mr.Error.Type),
			Code:       strings.TrimSpace(mr.Error.Code),
		}
	}
	if message := strings.TrimSpace(mr.ErrorMessage); message != "" || len(mr.ErrorCode) > 0 || strings.TrimSpace(mr.ErrorType) != "" {
		return &UpstreamError{
			HTTPStatus: status,
			Message:    message,
			Type:       strings.TrimSpace(mr.ErrorType),
			Code:       jsonScalarString(mr.ErrorCode),
		}
	}
	if s := strings.TrimSpace(string(raw)); s != "" {
		return fmt.Errorf("relaymedia: HTTP %d: %s", status, truncate(s, 300))
	}
	return fmt.Errorf("relaymedia: HTTP %d", status)
}

func jsonScalarString(raw json.RawMessage) string {
	if len(raw) == 0 || string(raw) == "null" {
		return ""
	}
	var value any
	if json.Unmarshal(raw, &value) != nil {
		return ""
	}
	switch value := value.(type) {
	case string:
		return strings.TrimSpace(value)
	case float64:
		return fmt.Sprintf("%g", value)
	default:
		return ""
	}
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

// snippet renders a response body for error messages (trimmed + truncated).
func snippet(raw []byte) string {
	s := strings.TrimSpace(string(raw))
	if s == "" {
		return "(empty body)"
	}
	return truncate(s, 300)
}
