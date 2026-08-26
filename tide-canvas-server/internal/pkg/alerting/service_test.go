package alerting

import (
	"strings"
	"testing"
)

func TestVaultRoundTripAndMask(t *testing.T) {
	v := newVault("secret")
	in := ChannelConfig{Webhook: "https://open.feishu.cn/open-apis/bot/v2/hook/abcdef", Secret: "sign-secret"}
	sealed, err := v.seal(in)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(sealed, "sign-secret") {
		t.Fatal("sealed credential contains plaintext")
	}
	out, err := v.open(sealed)
	if err != nil {
		t.Fatal(err)
	}
	if out != in {
		t.Fatalf("round trip mismatch: %#v", out)
	}
	if maskedConfig(out).Secret != maskedSecret {
		t.Fatal("secret was not masked")
	}
	if !strings.Contains(maskedConfig(out).Webhook, "••") {
		t.Fatal("webhook was not masked")
	}
}

func TestSeverityAndPatternMatching(t *testing.T) {
	if !patternsMatch([]string{"ai.*"}, "ai.video.generation_failed") {
		t.Fatal("prefix pattern did not match")
	}
	if !patternsMatch([]string{"*"}, "payment.callback.failed") {
		t.Fatal("wildcard did not match")
	}
	if patternsMatch([]string{"supplier.*"}, "ai.video.generation_failed") {
		t.Fatal("unrelated prefix matched")
	}
	if severityRank(SeverityCritical) <= severityRank(SeverityError) || severityRank(SeverityError) <= severityRank(SeverityWarning) {
		t.Fatal("severity ordering is invalid")
	}
	if normalizeSeverity("warn") != SeverityWarning {
		t.Fatal("warn alias not normalized")
	}
}

func TestSanitizeDetailsHidesCredentialsAndPrompts(t *testing.T) {
	details := sanitizeDetails(map[string]any{
		"taskId": "123", "botToken": "secret-token", "authorization": "Bearer abc",
		"prompt": "private creative input", "error": "request failed: access_token=abc123 " + strings.Repeat("x", 800),
	})
	if details["taskId"] != "123" {
		t.Fatal("safe detail changed")
	}
	for _, key := range []string{"botToken", "authorization", "prompt"} {
		if details[key] != "[已隐藏]" {
			t.Fatalf("%s was not hidden", key)
		}
	}
	if len([]rune(details["error"].(string))) > 500 {
		t.Fatal("detail was not truncated")
	}
	if strings.Contains(details["error"].(string), "abc123") {
		t.Fatal("credential embedded in error text was not redacted")
	}
}

func TestValidateOfficialChannelHosts(t *testing.T) {
	for _, tc := range []struct {
		kind string
		cfg  ChannelConfig
	}{{ChannelFeishu, ChannelConfig{Webhook: "https://open.feishu.cn/open-apis/bot/v2/hook/abc"}}, {ChannelDingTalk, ChannelConfig{Webhook: "https://oapi.dingtalk.com/robot/send?access_token=abc"}}, {ChannelTelegram, ChannelConfig{BotToken: "123:abc", ChatID: "-100123"}}} {
		if err := validateChannel(tc.kind, tc.cfg); err != nil {
			t.Fatalf("valid channel rejected: %v", err)
		}
	}
	for _, tc := range []struct {
		kind string
		cfg  ChannelConfig
	}{{ChannelFeishu, ChannelConfig{Webhook: "http://open.feishu.cn/hook"}}, {ChannelDingTalk, ChannelConfig{Webhook: "https://example.com/hook"}}} {
		if validateChannel(tc.kind, tc.cfg) == nil {
			t.Fatal("invalid channel accepted")
		}
	}
}
