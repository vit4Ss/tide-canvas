// Package tgfeed fetches and parses the public web preview of a Telegram
// channel (https://t.me/s/<username>). 无需 Bot/MTProto 凭据：预览页对公开频道
// 开放，正因如此也只支持公开频道。解析基于 golang.org/x/net/html（标准扩展库，
// 不引入第三方解析器），产出接近 Markdown 的正文与图片 URL 列表，由博客同步
// (internal/handler/admin g2_blog) 落库并把图片转存到本站对象存储。
//
// 出站请求走默认 Transport，自动尊重 HTTP_PROXY / HTTPS_PROXY 环境变量——
// 部署环境访问 t.me 需要代理时无需改代码。
package tgfeed

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"golang.org/x/net/html"
)

// Message is one parsed channel message from the web preview.
type Message struct {
	ID Int64ID
	// Markdown is the message text with links/bold/italic/code preserved in
	// Markdown syntax and <br> collapsed to newlines.
	Markdown string
	// Plain is the same text without any markup (title/summary derivation).
	Plain string
	// Photos are the message's image URLs (photo attachments + video poster
	// thumbs), in display order — telesco.pe CDN URLs that expire, so callers
	// should re-host them.
	Photos []string
	Time   time.Time
}

// Int64ID keeps the telegram message id readable at call sites.
type Int64ID = int64

// Page is one fetched preview page.
type Page struct {
	// ChannelTitle is the channel display name (og:title), "" when absent.
	ChannelTitle string
	// Messages are ordered oldest → newest as rendered by the preview page.
	Messages []Message
}

// ErrNoPreview means the page rendered but exposed no message list — private
// channel, preview disabled, or a non-channel handle.
var ErrNoPreview = errors.New("tgfeed: channel has no public web preview")

const maxRespBody = 4 << 20 // 4MB cap per preview page

var httpClient = &http.Client{Timeout: 20 * time.Second}

// FetchPage loads one preview page. beforeID = 0 fetches the newest messages;
// a positive beforeID fetches the ~20 messages older than that id.
func FetchPage(ctx context.Context, username string, beforeID int64) (*Page, error) {
	u := "https://t.me/s/" + strings.TrimPrefix(strings.TrimSpace(username), "@")
	if beforeID > 0 {
		u += "?before=" + strconv.FormatInt(beforeID, 10)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	// 通用浏览器 UA：预览页对无 UA 的请求偶发返回精简版（无消息列表）。
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36")
	req.Header.Set("Accept-Language", "en")

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxRespBody))
	if err != nil {
		return nil, fmt.Errorf("tgfeed: read preview: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("tgfeed: preview HTTP %d", resp.StatusCode)
	}
	return parsePage(string(body))
}

// FetchImage downloads one CDN image (for re-hosting). Returns the bytes and
// the response content type.
func FetchImage(ctx context.Context, url string) ([]byte, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, "", err
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("tgfeed: image HTTP %d", resp.StatusCode)
	}
	const maxImg = 10 << 20 // 10MB per image
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxImg))
	if err != nil {
		return nil, "", err
	}
	ct := resp.Header.Get("Content-Type")
	if ct == "" {
		ct = "image/jpeg"
	}
	return data, ct, nil
}

// ---- parsing ----

var bgImageRe = regexp.MustCompile(`background-image:\s*url\('([^']+)'\)`)

func parsePage(raw string) (*Page, error) {
	doc, err := html.Parse(strings.NewReader(raw))
	if err != nil {
		return nil, fmt.Errorf("tgfeed: parse html: %w", err)
	}
	p := &Page{ChannelTitle: metaOGTitle(doc)}
	walk(doc, func(n *html.Node) bool {
		if n.Type == html.ElementNode && hasClass(n, "tgme_widget_message") {
			if m, ok := parseMessage(n); ok {
				p.Messages = append(p.Messages, m)
			}
			return false // do not descend into an already-parsed message
		}
		return true
	})
	if len(p.Messages) == 0 && !strings.Contains(raw, "tgme_channel_info") {
		return nil, ErrNoPreview
	}
	return p, nil
}

// parseMessage extracts one message div (data-post="channel/123").
func parseMessage(n *html.Node) (Message, bool) {
	post := attr(n, "data-post")
	slash := strings.LastIndexByte(post, '/')
	if slash < 0 {
		return Message{}, false
	}
	id, err := strconv.ParseInt(post[slash+1:], 10, 64)
	if err != nil || id <= 0 {
		return Message{}, false
	}

	m := Message{ID: id}
	walk(n, func(c *html.Node) bool {
		if c.Type != html.ElementNode {
			return true
		}
		switch {
		case hasClass(c, "tgme_widget_message_text"):
			// 转发消息会嵌套两份 text；取首个（外层即正文）。
			if m.Markdown == "" {
				m.Markdown = strings.TrimSpace(renderMarkdown(c))
				m.Plain = strings.TrimSpace(renderPlain(c))
			}
			return false
		case hasClass(c, "tgme_widget_message_photo_wrap"),
			hasClass(c, "tgme_widget_message_video_thumb"):
			if u := extractBgImage(attr(c, "style")); u != "" {
				m.Photos = append(m.Photos, u)
			}
			return false
		case c.Data == "time":
			if dt := attr(c, "datetime"); dt != "" && m.Time.IsZero() {
				if t, err := time.Parse(time.RFC3339, dt); err == nil {
					m.Time = t
				}
			}
		}
		return true
	})
	if m.Time.IsZero() {
		m.Time = time.Now()
	}
	return m, m.Markdown != "" || len(m.Photos) > 0
}

func extractBgImage(style string) string {
	if match := bgImageRe.FindStringSubmatch(style); match != nil {
		return match[1]
	}
	return ""
}

// renderMarkdown converts a message_text node tree to Markdown.
func renderMarkdown(n *html.Node) string {
	var b strings.Builder
	renderInline(&b, n, true)
	return collapseBlank(b.String())
}

// renderPlain converts the same tree to plain text (no markup).
func renderPlain(n *html.Node) string {
	var b strings.Builder
	renderInline(&b, n, false)
	return collapseBlank(b.String())
}

func renderInline(b *strings.Builder, n *html.Node, markdown bool) {
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		switch c.Type {
		case html.TextNode:
			b.WriteString(c.Data)
		case html.ElementNode:
			switch c.Data {
			case "br":
				b.WriteString("\n")
			case "a":
				href := attr(c, "href")
				text := textContent(c)
				if markdown && href != "" && text != "" && text != href {
					fmt.Fprintf(b, "[%s](%s)", text, href)
				} else if text != "" {
					b.WriteString(text)
				} else {
					b.WriteString(href)
				}
			case "b", "strong":
				wrapInline(b, c, "**", markdown)
			case "i", "em":
				wrapInline(b, c, "*", markdown)
			case "s", "del":
				wrapInline(b, c, "~~", markdown)
			case "code":
				wrapInline(b, c, "`", markdown)
			case "pre":
				if markdown {
					b.WriteString("\n```\n" + textContent(c) + "\n```\n")
				} else {
					b.WriteString("\n" + textContent(c) + "\n")
				}
			default:
				// tg-emoji / span 等容器：直接下钻。
				renderInline(b, c, markdown)
			}
		}
	}
}

func wrapInline(b *strings.Builder, n *html.Node, mark string, markdown bool) {
	inner := textContent(n)
	if inner == "" {
		return
	}
	if markdown {
		b.WriteString(mark + inner + mark)
	} else {
		b.WriteString(inner)
	}
}

// collapseBlank trims trailing spaces per line and collapses 3+ blank lines.
func collapseBlank(s string) string {
	lines := strings.Split(strings.ReplaceAll(s, "\r\n", "\n"), "\n")
	for i := range lines {
		lines[i] = strings.TrimRight(lines[i], " \t")
	}
	out := strings.Join(lines, "\n")
	for strings.Contains(out, "\n\n\n") {
		out = strings.ReplaceAll(out, "\n\n\n", "\n\n")
	}
	return out
}

// ---- html helpers ----

// walk visits nodes depth-first; fn returning false skips the node's subtree.
func walk(n *html.Node, fn func(*html.Node) bool) {
	if !fn(n) {
		return
	}
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		walk(c, fn)
	}
}

func attr(n *html.Node, key string) string {
	for _, a := range n.Attr {
		if a.Key == key {
			return a.Val
		}
	}
	return ""
}

func hasClass(n *html.Node, class string) bool {
	for _, f := range strings.Fields(attr(n, "class")) {
		if f == class {
			return true
		}
	}
	return false
}

func textContent(n *html.Node) string {
	var b strings.Builder
	walk(n, func(c *html.Node) bool {
		if c.Type == html.TextNode {
			b.WriteString(c.Data)
		}
		return true
	})
	return strings.TrimSpace(b.String())
}

func metaOGTitle(doc *html.Node) string {
	title := ""
	walk(doc, func(n *html.Node) bool {
		if n.Type == html.ElementNode && n.Data == "meta" &&
			attr(n, "property") == "og:title" {
			title = attr(n, "content")
			return false
		}
		return title == ""
	})
	return strings.TrimSpace(title)
}
