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
}

// defaultStreamDeadline caps a stream whose caller context carries no deadline,
// so a stalled relay can never hang a request forever.
const defaultStreamDeadline = 5 * time.Minute

// New returns a client, or nil when no API key is configured (so the caller can
// fall back). baseURL defaults to the relay host when empty.
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
		baseURL = "https://relay.tcmzhan.com"
	}
	return &Client{baseURL: baseURL, apiKey: apiKey, hc: &http.Client{
		Transport: &http.Transport{
			Proxy: http.ProxyFromEnvironment,
			// A custom dialer disables automatic HTTP/2; force-attempt it back on
			// and keep DefaultTransport's idle-connection hygiene.
			ForceAttemptHTTP2:     true,
			DialContext:           (&net.Dialer{Timeout: 10 * time.Second}).DialContext,
			TLSHandshakeTimeout:   10 * time.Second,
			ResponseHeaderTimeout: 60 * time.Second,
			MaxIdleConns:          100,
			IdleConnTimeout:       90 * time.Second,
			ExpectContinueTimeout: 1 * time.Second,
		},
	}}
}

type chatRequest struct {
	Model    string `json:"model"`
	Messages []Msg  `json:"messages"`
	Stream   bool   `json:"stream"`
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
	return c.stream(ctx, model, msgs, nil)
}

// ChatStream is like Chat but invokes onDelta for every token as it arrives,
// returning the full accumulated reply when the stream ends. Pass a context with
// a deadline to bound a long generation.
func (c *Client) ChatStream(ctx context.Context, model string, msgs []Msg, onDelta func(string)) (string, error) {
	return c.stream(ctx, model, msgs, onDelta)
}

// stream performs the SSE request, accumulating the reply and (when onDelta is
// non-nil) forwarding each delta as it arrives.
func (c *Client) stream(ctx context.Context, model string, msgs []Msg, onDelta func(string)) (string, error) {
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

	payload, err := json.Marshal(chatRequest{Model: model, Messages: msgs, Stream: true})
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

	var sb strings.Builder
	sc := bufio.NewScanner(resp.Body)
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
		return "", fmt.Errorf("relaychat: read stream (after %s, %d bytes received): %w",
			time.Since(start).Round(time.Millisecond), sb.Len(), err)
	}

	content := strings.TrimSpace(sb.String())
	if content == "" {
		return "", errors.New("relaychat: empty content")
	}
	return content, nil
}
