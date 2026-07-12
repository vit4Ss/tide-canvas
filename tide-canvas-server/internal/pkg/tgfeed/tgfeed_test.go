package tgfeed

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"
)

// fixture mimics the real t.me/s/<channel> preview structure (one text+photo
// message and one photo-only message)：解析器语义的离线回归——真实页面结构
// 变化由下面带 TGFEED_LIVE 开关的联网测试兜底。
const fixture = `<!DOCTYPE html><html><head>
<meta property="og:title" content="Hot Sora">
</head><body>
<div class="tgme_channel_info"><div class="tgme_channel_info_header_title">Hot Sora</div></div>
<section class="tgme_channel_history">
<div class="tgme_widget_message_wrap">
 <div class="tgme_widget_message text_not_supported_wrap js-widget_message" data-post="HotSora/101">
  <div class="tgme_widget_message_bubble">
   <a class="tgme_widget_message_photo_wrap abc" href="https://t.me/HotSora/101"
      style="width:400px;background-image:url('https://cdn4.cdn-telegram.org/file/photo101.jpg')"></a>
   <div class="tgme_widget_message_text js-message_text" dir="auto">
     Sora 2 新玩法<br/><br/>用 <b>参考图</b> 控制镜头，教程见 <a href="https://example.com/t">这里</a>
   </div>
   <div class="tgme_widget_message_footer">
    <a class="tgme_widget_message_date" href="https://t.me/HotSora/101">
      <time datetime="2026-07-10T08:30:00+00:00" class="time">08:30</time>
    </a>
   </div>
  </div>
 </div>
</div>
<div class="tgme_widget_message_wrap">
 <div class="tgme_widget_message js-widget_message" data-post="HotSora/102">
  <div class="tgme_widget_message_bubble">
   <a class="tgme_widget_message_photo_wrap" href="https://t.me/HotSora/102"
      style="background-image:url('https://cdn4.cdn-telegram.org/file/photo102.jpg')"></a>
   <div class="tgme_widget_message_footer">
    <a class="tgme_widget_message_date" href="https://t.me/HotSora/102">
      <time datetime="2026-07-11T02:00:00+00:00" class="time">02:00</time>
    </a>
   </div>
  </div>
 </div>
</div>
</section></body></html>`

func TestParsePageFixture(t *testing.T) {
	p, err := parsePage(fixture)
	if err != nil {
		t.Fatalf("parsePage: %v", err)
	}
	if p.ChannelTitle != "Hot Sora" {
		t.Errorf("channel title = %q, want Hot Sora", p.ChannelTitle)
	}
	if len(p.Messages) != 2 {
		t.Fatalf("messages = %d, want 2", len(p.Messages))
	}

	m := p.Messages[0]
	if m.ID != 101 {
		t.Errorf("msg id = %d, want 101", m.ID)
	}
	if !strings.Contains(m.Markdown, "**参考图**") {
		t.Errorf("markdown bold lost: %q", m.Markdown)
	}
	if !strings.Contains(m.Markdown, "[这里](https://example.com/t)") {
		t.Errorf("markdown link lost: %q", m.Markdown)
	}
	if !strings.HasPrefix(m.Plain, "Sora 2 新玩法") {
		t.Errorf("plain first line = %q", m.Plain)
	}
	if strings.Contains(m.Plain, "**") || strings.Contains(m.Plain, "](") {
		t.Errorf("plain leaked markup: %q", m.Plain)
	}
	if len(m.Photos) != 1 || m.Photos[0] != "https://cdn4.cdn-telegram.org/file/photo101.jpg" {
		t.Errorf("photos = %v", m.Photos)
	}
	want := time.Date(2026, 7, 10, 8, 30, 0, 0, time.UTC)
	if !m.Time.Equal(want) {
		t.Errorf("time = %v, want %v", m.Time, want)
	}

	// 纯图消息：无文字但有图，仍应产出（导入侧再按“无文字跳过”策略过滤）。
	if p.Messages[1].ID != 102 || p.Messages[1].Plain != "" || len(p.Messages[1].Photos) != 1 {
		t.Errorf("photo-only message parsed wrong: %+v", p.Messages[1])
	}
}

func TestParsePageNoPreview(t *testing.T) {
	if _, err := parsePage("<html><body>nothing here</body></html>"); err != ErrNoPreview {
		t.Errorf("err = %v, want ErrNoPreview", err)
	}
}

// TestFetchLive hits the real t.me preview（网络相关，默认跳过）：
//
//	TGFEED_LIVE=1 go test ./internal/pkg/tgfeed -run TestFetchLive -v
func TestFetchLive(t *testing.T) {
	if os.Getenv("TGFEED_LIVE") != "1" {
		t.Skip("set TGFEED_LIVE=1 to run the live t.me fetch test")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	for _, ch := range []string{"HotSora", "gpt_image_2_hub"} {
		p, err := FetchPage(ctx, ch, 0)
		if err != nil {
			t.Fatalf("FetchPage(%s): %v", ch, err)
		}
		if len(p.Messages) == 0 {
			t.Fatalf("FetchPage(%s): no messages parsed", ch)
		}
		t.Logf("%s: title=%q messages=%d", ch, p.ChannelTitle, len(p.Messages))
		withText, withPhoto := 0, 0
		for _, m := range p.Messages {
			if strings.TrimSpace(m.Plain) != "" {
				withText++
			}
			if len(m.Photos) > 0 {
				withPhoto++
			}
			if m.ID <= 0 {
				t.Errorf("%s: bad msg id %d", ch, m.ID)
			}
			if m.Time.IsZero() {
				t.Errorf("%s: msg %d no time", ch, m.ID)
			}
		}
		t.Logf("%s: withText=%d withPhoto=%d", ch, withText, withPhoto)
		last := p.Messages[len(p.Messages)-1]
		t.Logf("%s: latest #%d %s | %s", ch, last.ID, last.Time.Format(time.RFC3339),
			truncateForLog(last.Plain, 80))
	}
}

func truncateForLog(s string, n int) string {
	r := []rune(strings.ReplaceAll(s, "\n", " ⏎ "))
	if len(r) <= n {
		return s
	}
	return string(r[:n]) + "…"
}
