package admin

import (
	"strings"
	"testing"
)

// 推广尾注剥离——用两个真实频道的尾巴形态回归。

func TestStripPromoSeparatorFooter(t *testing.T) {
	// HotSora 形态：分割线 + 两条纯链接行。
	md := "模型 / 工具：\n- `Seedance 2 mini`\n\n━━━━━━━━━━━━━━━━━\n" +
		"[🤖 NanoBanana 创意机器人，可制作 Seedance 2.0 视频](https://t.me/aibox?start=hotsora)\n" +
		"[🦐 AI 小龙虾机器人，体验无限破甲的乐趣](https://t.me/xiaolongxia?start=cl)"
	got, removed := stripPromoMarkdown(md)
	if removed != 2 {
		t.Errorf("removed = %d, want 2", removed)
	}
	if strings.Contains(got, "NanoBanana") || strings.Contains(got, "━") {
		t.Errorf("footer not stripped: %q", got)
	}
	if !strings.HasSuffix(got, "`Seedance 2 mini`") {
		t.Errorf("body damaged: %q", got)
	}
}

func TestStripPromoMixedFooter(t *testing.T) {
	// gpt_image_2_hub 形态：分割线后的行带文字前缀（VPN推荐），但都含链接。
	md := "#GPTImage2 #文生图 #SFW\n\n━━━━━━━━━━━━━━━━━\n" +
		"*📚* [教程目录](https://t.me/gpt_image_2_hub/6) · *🤖* [我们的 Bot](https://t.me/aibox?start=cl) · *🔥* [邪修频道](https://t.me/+fMmM)\n" +
		"*🚀*VPN推荐： [Hi快 快连后的第一品牌](https://getsapp.net/WrnpAC)"
	got, removed := stripPromoMarkdown(md)
	if removed != 2 {
		t.Errorf("removed = %d, want 2", removed)
	}
	if strings.Contains(got, "VPN") || strings.Contains(got, "教程目录") {
		t.Errorf("footer not stripped: %q", got)
	}
	if !strings.HasSuffix(got, "#SFW") {
		t.Errorf("body damaged: %q", got)
	}
}

func TestStripPromoTrailingPureLinks(t *testing.T) {
	// 无分割线，仅结尾一条纯链接行。
	md := "奥特曼都说好，本频道免费赠送7000token，快来体验吧\n\n" +
		"[👉NanoGPT创意机器人](https://t.me/aibox?start=cl)"
	got, removed := stripPromoMarkdown(md)
	if removed != 1 {
		t.Errorf("removed = %d, want 1", removed)
	}
	if strings.Contains(got, "👉") {
		t.Errorf("trailing link not stripped: %q", got)
	}
}

func TestStripPromoKeepsPrefixedReference(t *testing.T) {
	// 「来源：[@xx](…)」带文字前缀且无分割线，必须保留。
	md := "三把钥匙：先提炼核心词。\n\n来源：[@AdrianPunk115](https://x.com/AdrianPunk115/status/1)"
	got, removed := stripPromoMarkdown(md)
	if removed != 0 || got != md {
		t.Errorf("legit reference stripped: removed=%d %q", removed, got)
	}
}

func TestStripPromoPlainSync(t *testing.T) {
	plain := "正文第一行\n\n━━━━━━━━━━━━━━━━━\n🤖 NanoBanana 创意机器人\n🦐 AI 小龙虾机器人"
	got := stripPromoPlain(plain, 2)
	if strings.Contains(got, "NanoBanana") || strings.Contains(got, "━") {
		t.Errorf("plain footer not stripped: %q", got)
	}
	if !strings.HasSuffix(got, "正文第一行") {
		t.Errorf("plain body damaged: %q", got)
	}
}
