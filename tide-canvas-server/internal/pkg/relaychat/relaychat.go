// Package relaychat is a thin client for the ScarecrowToken relay's
// OpenAI-compatible chat completions endpoint (POST {baseURL}/v1/chat/completions).
// It powers the text-model assistant: a single non-streaming Chat() call that
// takes a transcript and returns the assistant's reply text.
//
// The client is nil when no relay API key is configured; callers then fall back
// to another path (the legacy llm client or a canned reply).
package relaychat

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"sync/atomic"
	"time"
)

// Msg is one OpenAI-shaped chat message. Content is `any` so it can be either a
// plain string (text-only message) OR a []Part array (multimodal: text + images),
// matching the OpenAI chat-completions content contract. Build text messages with
// TextMsg and image-bearing user messages with UserMultimodal.
type Msg struct {
	Role    string `json:"role"` // system | user | assistant
	Content any    `json:"content"`
}

// Part is one block of a multimodal message content array.
type Part struct {
	Type     string    `json:"type"` // "text" | "image_url" | "file"
	Text     string    `json:"text,omitempty"`
	ImageURL *ImageURL `json:"image_url,omitempty"`
	File     *FileData `json:"file,omitempty"`
}

// ImageURL is the OpenAI image reference (a hosted URL or a data: URI).
type ImageURL struct {
	URL string `json:"url"`
}

// FileData is a document attachment part（relay /v1/chat/completions 的 file
// part 契约）：文件名 + base64 data URI。能否被理解取决于上游模型的文件能力。
type FileData struct {
	Filename string `json:"filename"`
	FileData string `json:"file_data"` // "data:<mime>;base64,…"
}

// FileAttachment is one document to forward as a "file" content part.
type FileAttachment struct {
	Filename string
	DataURI  string
}

// TextMsg builds a plain text message (content is a string).
func TextMsg(role, text string) Msg {
	return Msg{Role: role, Content: text}
}

// UserMultimodal builds a user message carrying text plus zero or more images as
// OpenAI content parts. With no image URLs it degrades to a plain text message so
// the wire shape stays minimal.
func UserMultimodal(text string, imageURLs []string) Msg {
	return UserWithAttachments(text, imageURLs, nil)
}

// UserWithAttachments builds a user message carrying text plus images and/or
// document files as OpenAI content parts. With no attachments it degrades to a
// plain text message so the wire shape stays minimal.
func UserWithAttachments(text string, imageURLs []string, files []FileAttachment) Msg {
	if len(imageURLs) == 0 && len(files) == 0 {
		return TextMsg("user", text)
	}
	parts := make([]Part, 0, len(imageURLs)+len(files)+1)
	if strings.TrimSpace(text) != "" {
		parts = append(parts, Part{Type: "text", Text: text})
	}
	for _, u := range imageURLs {
		if u = strings.TrimSpace(u); u != "" {
			parts = append(parts, Part{Type: "image_url", ImageURL: &ImageURL{URL: u}})
		}
	}
	for _, f := range files {
		if f.DataURI == "" {
			continue
		}
		name := f.Filename
		if name == "" {
			name = "附件"
		}
		parts = append(parts, Part{Type: "file", File: &FileData{Filename: name, FileData: f.DataURI}})
	}
	return Msg{Role: "user", Content: parts}
}

// Client calls the relay's /v1/chat/completions.
type Client struct {
	baseURL string
	apiKey  string
	hc      *http.Client
	// 空闲看门狗的两个阈值放在实例上而不是包级变量：测试要压到毫秒级才能在
	// 合理时间内验证断流，包级变量会被别的用例仍在运行的看门狗并发读到（竞态）。
	idleTimeout time.Duration
	idleCheck   time.Duration
}

// defaultStreamDeadline caps a stream whose caller context carries no deadline.
// Frontier reasoning models may spend a long time before and between visible
// deltas, so keep a generous hard ceiling; the idle watchdog remains the faster
// failure detector for a genuinely silent/dead relay.
const defaultStreamDeadline = 60 * time.Minute

// streamIdleTimeout aborts a stream that stops producing bytes. 流式生成不能按
// 总时长掐:只要还在吐字就说明上游活着,长回复本来就该允许跑久。真正的故障
// 形态是「连接开着但不再有数据」,按空闲时长判定才对得上。
//
// 之前只有总时长上限(180s),一个还在正常输出的长回复会被拦腰截断——用户看到
// 半截答案,上游那侧则报 Broken pipe(它下一次 flush 写到我们已关闭的 socket)。
// Relay now emits a lightweight SSE heartbeat while the model is reasoning; the
// 15-minute allowance also protects deployments during rolling upgrades where
// an older relay instance may not emit that heartbeat yet.
const streamIdleTimeout = 15 * time.Minute

// streamIdleCheck is how often the watchdog compares now against the last read.
// 粒度取 5s:比空闲阈值小一个量级,又不至于空转太频繁。
const streamIdleCheck = 5 * time.Second

// New returns a client, or nil when no API key is configured (so the caller can
// fall back). An empty baseURL defaults to the test relay so an incompletely
// configured local process cannot send traffic to production.
//
// The http.Client deliberately has no overall Timeout: that field also covers
// reading the response body, which for SSE would kill any generation longer
// than the timeout regardless of the caller's context. Connection setup and
// time-to-first-response are bounded via the Transport instead; total duration
// is owned by the caller's context (with defaultStreamDeadline as fallback).
func New(baseURL, apiKey string) *Client {
	apiKey = strings.TrimSpace(apiKey)
	if apiKey == "" {
		return nil
	}
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		baseURL = "https://test-relay.tcmzhan.com"
	}
	return &Client{baseURL: baseURL, apiKey: apiKey, idleTimeout: streamIdleTimeout, idleCheck: streamIdleCheck, hc: &http.Client{
		Transport: &http.Transport{
			Proxy: http.ProxyFromEnvironment,
			// A custom dialer disables automatic HTTP/2; force-attempt it back on
			// and keep DefaultTransport's idle-connection hygiene.
			ForceAttemptHTTP2:   true,
			DialContext:         (&net.Dialer{Timeout: 10 * time.Second}).DialContext,
			TLSHandshakeTimeout: 10 * time.Second,
			// 首字节前的等待上限。推理型模型(gpt-5.6-sol 等)会先想很久才
			// 开口；relay 心跳通常会更早提交响应头，这里仍保留 15 分钟兜底，
			// 兼容尚未升级心跳的实例。
			ResponseHeaderTimeout: 15 * time.Minute,
			MaxIdleConns:          100,
			IdleConnTimeout:       90 * time.Second,
			ExpectContinueTimeout: 1 * time.Second,
		},
	}}
}

type chatRequest struct {
	Model     string `json:"model"`
	Messages  []Msg  `json:"messages"`
	Stream    bool   `json:"stream"`
	WebSearch bool   `json:"web_search,omitempty"`
}

// chunk is one SSE frame (chat.completion.chunk) from the streaming response.
type chunk struct {
	Choices []struct {
		Delta struct {
			Content string `json:"content"`
		} `json:"delta"`
	} `json:"choices"`
}

// Chat requests a STREAMING completion for the given text model and returns the
// full assistant reply (accumulated from the SSE delta frames). The relay's
// non-streaming path is unreliable, so streaming is used and collapsed to a
// single string here.
func (c *Client) Chat(ctx context.Context, model string, msgs []Msg) (string, error) {
	return c.stream(ctx, model, msgs, false, nil)
}

// ChatWithWebSearch enables the relay's native web_search option for one
// completion while preserving Chat's default behavior for existing callers.
func (c *Client) ChatWithWebSearch(ctx context.Context, model string, msgs []Msg, webSearch bool) (string, error) {
	return c.stream(ctx, model, msgs, webSearch, nil)
}

// ChatStream is like Chat but invokes onDelta for every token as it arrives,
// returning the full accumulated reply when the stream ends. Pass a context with
// a deadline to bound a long generation.
func (c *Client) ChatStream(ctx context.Context, model string, msgs []Msg, onDelta func(string)) (string, error) {
	return c.stream(ctx, model, msgs, false, onDelta)
}

// ChatStreamWithWebSearch is the streaming equivalent of ChatWithWebSearch.
func (c *Client) ChatStreamWithWebSearch(ctx context.Context, model string, msgs []Msg, webSearch bool, onDelta func(string)) (string, error) {
	return c.stream(ctx, model, msgs, webSearch, onDelta)
}

// stream performs the SSE request, accumulating the reply and (when onDelta is
// non-nil) forwarding each delta as it arrives.
func (c *Client) stream(ctx context.Context, model string, msgs []Msg, webSearch bool, onDelta func(string)) (string, error) {
	if model == "" {
		return "", errors.New("relaychat: model is required")
	}
	if len(msgs) == 0 {
		return "", errors.New("relaychat: empty transcript")
	}

	if _, ok := ctx.Deadline(); !ok {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, defaultStreamDeadline)
		defer cancel()
	}
	// 请求必须挂在这个可取消的上下文上，空闲看门狗才能真的把阻塞中的读打断。
	ctx, cancelStream := context.WithCancel(ctx)
	defer cancelStream()

	payload, err := json.Marshal(chatRequest{Model: model, Messages: msgs, Stream: true, WebSearch: webSearch})
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/v1/chat/completions", bytes.NewReader(payload))
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")

	start := time.Now()
	resp, err := c.hc.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return "", fmt.Errorf("relaychat: HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	// 空闲看门狗：每收到一次字节就续命，连续 streamIdleTimeout 没有新数据才
	// 取消请求。计的是原始字节而不是解析出的 delta——SSE 心跳注释行同样能证明
	// 连接活着，用它续命才不会把「上游正在思考」误判成断流。
	body := newIdleReader(resp.Body)
	var idleAbort atomic.Bool
	watchdogDone := make(chan struct{})
	defer close(watchdogDone)
	go func() {
		t := time.NewTicker(c.idleCheck)
		defer t.Stop()
		for {
			select {
			case <-watchdogDone:
				return
			case <-ctx.Done():
				return
			case <-t.C:
				if body.stalledFor() > c.idleTimeout {
					idleAbort.Store(true)
					cancelStream() // 取消请求上下文 → 阻塞中的 Read 立即返回错误
					return
				}
			}
		}
	}()

	var sb strings.Builder
	sc := bufio.NewScanner(body)
	sc.Buffer(make([]byte, 0, 64*1024), 1<<20)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "[DONE]" {
			break
		}
		var ck chunk
		if json.Unmarshal([]byte(data), &ck) != nil || len(ck.Choices) == 0 {
			continue
		}
		delta := ck.Choices[0].Delta.Content
		if delta == "" {
			continue
		}
		sb.WriteString(delta)
		if onDelta != nil {
			onDelta(delta)
		}
	}
	if err := sc.Err(); err != nil {
		// Include elapsed time and how much content had arrived: zero bytes at
		// the deadline points at the relay stalling; a partial reply points at
		// the caller's budget being too small for the generation.
		if idleAbort.Load() {
			// 与「总时长到顶」区分开：这条说明上游连接还在但已经不吐字了。
			return "", fmt.Errorf("relaychat: stream idle %s (after %s, %d bytes received)",
				c.idleTimeout, time.Since(start).Round(time.Millisecond), sb.Len())
		}
		return "", fmt.Errorf("relaychat: read stream (after %s, %d bytes received): %w",
			time.Since(start).Round(time.Millisecond), sb.Len(), err)
	}

	content := strings.TrimSpace(sb.String())
	if content == "" {
		return "", errors.New("relaychat: empty content")
	}
	return content, nil
}

// idleReader wraps the SSE body so the watchdog can measure 一件事、且只измер这
// 一件事：「我们已经阻塞等待上游字节多久了」。
//
// 关键是 waiting 标志。读循环里 onDelta 是同步写 SSE 给客户端的，客户端半开
// 时那个写能阻塞几分钟；如果只看「距上次收到字节多久」，这段时间会被算成上游
// 断流，把健康的生成误杀——而 chat 那边特意用 context.WithoutCancel 解耦客户端
// 断开，正是为了不发生这种事。只在 Read 真正在途时判超时，慢消费者就影响不到。
type idleReader struct {
	r       io.Reader
	last    atomic.Int64 // unix nano：当前这次等待的起点，或最近一次收到字节的时刻
	waiting atomic.Bool  // 是否正阻塞在底层 Read 上
}

func newIdleReader(r io.Reader) *idleReader {
	ir := &idleReader{r: r}
	ir.last.Store(time.Now().UnixNano())
	return ir
}

func (ir *idleReader) Read(p []byte) (int, error) {
	ir.last.Store(time.Now().UnixNano()) // 等待起点
	ir.waiting.Store(true)
	n, err := ir.r.Read(p)
	ir.waiting.Store(false)
	if n > 0 {
		ir.last.Store(time.Now().UnixNano())
	}
	return n, err
}

// stalledFor reports how long the reader has been blocked waiting on upstream
// bytes. 不在等待中（例如正在 onDelta 里写客户端、或 Scanner 正消费缓冲里的
// 剩余行）时返回 0——那不是上游的问题，不该计入。
func (ir *idleReader) stalledFor() time.Duration {
	if !ir.waiting.Load() {
		return 0
	}
	return time.Since(time.Unix(0, ir.last.Load()))
}
