// Package llm wraps the Anthropic (Claude) Messages API for the chat domain's
// assistant replies. It is intentionally thin: a single Chat() call that takes a
// system prompt plus an alternating-role transcript and returns the assistant's
// text. When no API key is configured the package is not constructed at all —
// callers fall back to their own placeholder behavior (see chat.service).
package llm

import (
	"context"
	"errors"
	"strings"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"

	"tidecanvas/internal/config"
)

// Role identifies who authored a transcript turn.
type Role string

const (
	RoleUser      Role = "user"
	RoleAssistant Role = "assistant"
)

// Turn is one message in the conversation transcript handed to the model.
type Turn struct {
	Role Role
	Text string
}

// ErrDisabled is returned by New when no API key is configured.
var ErrDisabled = errors.New("llm: not configured (missing api key)")

// Client is a configured Claude chat client.
type Client struct {
	api       anthropic.Client
	model     anthropic.Model
	maxTokens int64
	system    string
}

// New builds a Client from config. It returns ErrDisabled when the API key is
// empty so the caller can degrade gracefully instead of failing to boot.
func New(cfg config.LLMConfig) (*Client, error) {
	if !cfg.Enabled() {
		return nil, ErrDisabled
	}
	opts := []option.RequestOption{option.WithAPIKey(strings.TrimSpace(cfg.APIKey))}
	if base := strings.TrimSpace(cfg.BaseURL); base != "" {
		opts = append(opts, option.WithBaseURL(base))
	}
	model := strings.TrimSpace(cfg.Model)
	if model == "" {
		model = "claude-opus-4-8"
	}
	maxTokens := int64(cfg.MaxTokens)
	if maxTokens <= 0 {
		maxTokens = 2048
	}
	return &Client{
		api:       anthropic.NewClient(opts...),
		model:     anthropic.Model(model),
		maxTokens: maxTokens,
		system:    cfg.SystemPrompt,
	}, nil
}

// Chat sends the transcript to Claude and returns the assistant's reply text.
//
// The Anthropic API requires the transcript to start with a user turn and to
// alternate user/assistant roles. normalizeTurns enforces both: it drops any
// leading assistant turns and merges consecutive same-role turns, so a transcript
// with a missing/failed prior reply still produces a valid request.
func (c *Client) Chat(ctx context.Context, turns []Turn) (string, error) {
	msgs := buildMessages(turns)
	if len(msgs) == 0 {
		return "", errors.New("llm: empty transcript")
	}

	params := anthropic.MessageNewParams{
		Model:     c.model,
		MaxTokens: c.maxTokens,
		Messages:  msgs,
	}
	if s := strings.TrimSpace(c.system); s != "" {
		params.System = []anthropic.TextBlockParam{{Text: s}}
	}

	resp, err := c.api.Messages.New(ctx, params)
	if err != nil {
		return "", err
	}

	var b strings.Builder
	for _, block := range resp.Content {
		if t, ok := block.AsAny().(anthropic.TextBlock); ok {
			b.WriteString(t.Text)
		}
	}
	out := strings.TrimSpace(b.String())
	if out == "" {
		return "", errors.New("llm: empty response")
	}
	return out, nil
}

// buildMessages converts our transcript into alternating-role API messages,
// dropping leading assistant turns and coalescing consecutive same-role turns.
func buildMessages(turns []Turn) []anthropic.MessageParam {
	type merged struct {
		role Role
		text string
	}
	var seq []merged
	for _, t := range turns {
		text := strings.TrimSpace(t.Text)
		if text == "" {
			continue
		}
		role := t.Role
		if role != RoleAssistant {
			role = RoleUser
		}
		// Skip assistant turns until the first user turn appears.
		if len(seq) == 0 && role == RoleAssistant {
			continue
		}
		if n := len(seq); n > 0 && seq[n-1].role == role {
			seq[n-1].text += "\n" + text
			continue
		}
		seq = append(seq, merged{role: role, text: text})
	}

	out := make([]anthropic.MessageParam, 0, len(seq))
	for _, m := range seq {
		block := anthropic.NewTextBlock(m.text)
		if m.role == RoleAssistant {
			out = append(out, anthropic.NewAssistantMessage(block))
		} else {
			out = append(out, anthropic.NewUserMessage(block))
		}
	}
	return out
}
