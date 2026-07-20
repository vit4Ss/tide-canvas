// Package relaymedia is a thin client for the ScarecrowToken relay's
// OpenAI-compatible media generation endpoints:
//
//	POST {baseURL}/v1/images/generations  — text-to-image
//	POST {baseURL}/v1/images/edits        — image edit (參考图 → 新图)
//	POST {baseURL}/openapi/v1/generations — video (mode-driven: t2v/i2v/keyframe/multi_ref)
//	POST {baseURL}/v1/audio/speech        — audio (TTS 与音乐/音效共用,由模型决定上游)
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
)

// Tuning constants. The relay's synchronous image path can hold the connection
// for well over a minute (the model runs inline); videos are almost always async
// and can run for several minutes. Each call runs under the per-medium context
// deadline below — we deliberately do NOT set a fixed http.Client.Timeout, which
// would preempt that deadline and abort a still-running synchronous generation.
const (
	pollInterval      = 2 * time.Second  // gap between task polls
	imagePollDeadline = 6 * time.Minute  // overall budget for an image task (sync or polled)
	videoPollDeadline = 20 * time.Minute // videos are slower; stay under the 30m UI cap
	audioPollDeadline = 10 * time.Minute // TTS 通常同步秒回;Suno 音乐约 1–4 分钟(实测也会同步 200)
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
// fall back to the stub). baseURL defaults to the relay host when empty.
func New(baseURL, apiKey string) *Client {
	apiKey = strings.TrimSpace(apiKey)
	if apiKey == "" {
		return nil
	}
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		baseURL = "https://relay.tcmzhan.com"
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
	Mode       string   // text_to_video | image_to_video | first_last_frame | multi_ref
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

// Result is the normalized terminal outcome. URLs holds every produced media file
// (usually one). The audit fields mirror the upstream call for the generation
// log; they are populated even when the call ultimately fails.
type Result struct {
	URLs   []string
	Tracks []Track // Suno 音乐任务的分轨明细(与 URLs 同序);其它任务为空
	TaskID string
	Status string

	RequestURL   string
	RequestBody  string
	ResponseBody string
	HTTPStatus   int
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
type mediaResp struct {
	Created int64  `json:"created"`
	ID      string `json:"id"`
	Status  string `json:"status"`
	Model   string `json:"model"`
	Data    []struct {
		URL     string `json:"url"`
		B64JSON string `json:"b64_json"`
	} `json:"data"`
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
//（用户实测 2026-07-13）。code 兼容数字与字符串。
type mediaError struct {
	Message string `json:"message"`
	Type    string `json:"type"`
	Code    string `json:"code"`
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

	// A 2xx with the result already inline is a synchronous success.
	if status >= 200 && status < 300 {
		if urls := mediaURLs(mr); len(urls) > 0 {
			res.URLs = urls
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
	urls := mediaURLs(mr)
	tracks := mediaTracks(mr)
	if len(urls) < len(res.URLs) || (len(urls) == len(res.URLs) && len(tracks) == 0) {
		return
	}
	res.URLs = urls
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

		switch strings.ToLower(mr.Status) {
		case "succeeded", "success", "completed", "complete":
			urls := mediaURLs(mr)
			if len(urls) == 0 {
				return base, fmt.Errorf("relaymedia: task %s succeeded with no media url", taskID)
			}
			base.URLs = urls
			base.Tracks = mediaTracks(mr)
			return base, nil
		case "failed", "error", "cancelled", "canceled":
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

// upstreamError builds an error from the relay's OpenAI error envelope, falling
// back to the raw body when the envelope is absent.
func upstreamError(status int, mr mediaResp, raw []byte) error {
	if mr.Error != nil && strings.TrimSpace(mr.Error.Message) != "" {
		return fmt.Errorf("relaymedia: %s", mr.Error.Message)
	}
	if s := strings.TrimSpace(string(raw)); s != "" {
		return fmt.Errorf("relaymedia: HTTP %d: %s", status, truncate(s, 300))
	}
	return fmt.Errorf("relaymedia: HTTP %d", status)
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
