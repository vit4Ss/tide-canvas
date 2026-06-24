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
	"net/http"
	"strings"
	"time"
)

// Msg is one OpenAI-shaped chat message.
type Msg struct {
	Role    string `json:"role"` // system | user | assistant
	Content string `json:"content"`
}

// Client calls the relay's /v1/chat/completions.
type Client struct {
	baseURL string
	apiKey  string
	hc      *http.Client
}

// New returns a client, or nil when no API key is configured (so the caller can
// fall back). baseURL defaults to the relay host when empty.
func New(baseURL, apiKey string) *Client {
	apiKey = strings.TrimSpace(apiKey)
	if apiKey == "" {
		return nil
	}
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		baseURL = "https://relay.tcmzhan.com"
	}
	return &Client{baseURL: baseURL, apiKey: apiKey, hc: &http.Client{Timeout: 60 * time.Second}}
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
	if model == "" {
		return "", errors.New("relaychat: model is required")
	}
	if len(msgs) == 0 {
		return "", errors.New("relaychat: empty transcript")
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
		sb.WriteString(ck.Choices[0].Delta.Content)
	}
	if err := sc.Err(); err != nil {
		return "", fmt.Errorf("relaychat: read stream: %w", err)
	}

	content := strings.TrimSpace(sb.String())
	if content == "" {
		return "", errors.New("relaychat: empty content")
	}
	return content, nil
}
