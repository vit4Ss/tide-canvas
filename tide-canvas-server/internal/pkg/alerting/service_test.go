package alerting

import (
	"context"
	"strings"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

func newAlertTestService(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+strings.ReplaceAll(t.Name(), "/", "-")+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.AlertChannel{}, &model.AlertRule{}, &model.AlertEvent{}, &model.AlertDelivery{}); err != nil {
		t.Fatal(err)
	}
	return New(db, "test", "test-encryption-secret"), db
}

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
		"request": map[string]any{
			"prompt":   "nested private input",
			"metadata": []any{map[string]any{"apiKey": "nested-key", "safe": "visible"}},
		},
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
	request := details["request"].(map[string]any)
	if request["prompt"] != "[已隐藏]" {
		t.Fatal("nested prompt was not hidden")
	}
	metadata := request["metadata"].([]any)[0].(map[string]any)
	if metadata["apiKey"] != "[已隐藏]" || metadata["safe"] != "visible" {
		t.Fatalf("nested credential sanitization mismatch: %#v", metadata)
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

func TestNormalizeRuleInputRejectsAmbiguousPatternsAndChannelIDs(t *testing.T) {
	base := RuleInput{Name: "video failures", EventPatterns: []string{"ai.*"}, MinSeverity: SeverityWarning}

	badPattern := base
	badPattern.EventPatterns = []string{"ai*"}
	if _, err := normalizeRuleInput(badPattern); err == nil || !strings.Contains(err.Error(), "通配") {
		t.Fatalf("ambiguous wildcard error = %v", err)
	}

	badChannel := base
	badChannel.ChannelIDs = []string{"not-an-id"}
	if _, err := normalizeRuleInput(badChannel); err == nil || !strings.Contains(err.Error(), "渠道 ID") {
		t.Fatalf("invalid channel ID error = %v", err)
	}

	duplicateChannels := base
	duplicateChannels.ChannelIDs = []string{" 123 ", "123"}
	got, err := normalizeRuleInput(duplicateChannels)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.ChannelIDs) != 1 || got.ChannelIDs[0] != "123" {
		t.Fatalf("normalized channel IDs = %#v", got.ChannelIDs)
	}
}

func TestPublishAggregatesAndResolveQueuesRecovery(t *testing.T) {
	svc, db := newAlertTestService(t)
	ctx := context.Background()
	channel, err := svc.CreateChannel(ctx, ChannelInput{
		Name: "ops", Type: ChannelFeishu, Enabled: true, MinSeverity: SeverityWarning,
		Config: ChannelConfig{Webhook: "https://open.feishu.cn/open-apis/bot/v2/hook/test"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.CreateRule(ctx, RuleInput{
		Name: "AI failures", Enabled: true, EventPatterns: []string{"ai.*"}, MinSeverity: SeverityWarning,
		ChannelIDs: []string{channel.ID}, CooldownSeconds: 300, AggregateSeconds: 60, SendRecovery: true,
	}); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	in := EventInput{EventType: "ai.video.failed", Category: "ai", Severity: SeverityError,
		Fingerprint: "ai.video.failed:model", Title: "generation failed", Content: "provider error", OccurredAt: now}
	if err := svc.Publish(ctx, in); err != nil {
		t.Fatal(err)
	}
	in.Details = map[string]any{"attempt": 2}
	in.OccurredAt = now.Add(time.Second)
	if err := svc.Publish(ctx, in); err != nil {
		t.Fatal(err)
	}

	var event model.AlertEvent
	if err := db.Where("fingerprint = ?", in.Fingerprint).First(&event).Error; err != nil {
		t.Fatal(err)
	}
	if event.OccurrenceCount != 2 || event.NotifySequence != 1 {
		t.Fatalf("aggregated event = occurrences %d, sequence %d", event.OccurrenceCount, event.NotifySequence)
	}
	var firing []model.AlertDelivery
	if err := db.Where("event_id = ?", event.ID).Find(&firing).Error; err != nil {
		t.Fatal(err)
	}
	if len(firing) != 1 || firing[0].Kind != "firing" || !strings.Contains(firing[0].Message, "发生次数：2") {
		t.Fatalf("firing deliveries = %#v", firing)
	}

	if err := svc.Resolve(ctx, in.Fingerprint, "recovered", "provider is healthy", nil); err != nil {
		t.Fatal(err)
	}
	if err := db.First(&event, "id = ?", event.ID).Error; err != nil {
		t.Fatal(err)
	}
	if event.State != "resolved" || event.ResolvedAt == nil || event.NotifySequence != 2 {
		t.Fatalf("resolved event = state %q, resolvedAt %v, sequence %d", event.State, event.ResolvedAt, event.NotifySequence)
	}
	var deliveryCount int64
	if err := db.Model(&model.AlertDelivery{}).Where("event_id = ?", event.ID).Count(&deliveryCount).Error; err != nil {
		t.Fatal(err)
	}
	if deliveryCount != 2 {
		t.Fatalf("delivery count = %d, want firing + recovery", deliveryCount)
	}
}

func TestUpdateRuleIsIdempotentAndManualRetryRestoresBudget(t *testing.T) {
	svc, db := newAlertTestService(t)
	ctx := context.Background()
	in := RuleInput{Name: "system", Enabled: true, EventPatterns: []string{"system.*"}, MinSeverity: SeverityWarning,
		CooldownSeconds: 300, SendRecovery: true}
	rule, err := svc.CreateRule(ctx, in)
	if err != nil {
		t.Fatal(err)
	}
	id, err := idgen.Parse(rule.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.UpdateRule(ctx, id, in); err != nil {
		t.Fatalf("idempotent rule update failed: %v", err)
	}

	delivery := model.AlertDelivery{
		EventID: idgen.Next(), ChannelID: idgen.Next(), Sequence: 1, Kind: "firing", Message: "test",
		Status: "failed", AttemptCount: 5, NextAttemptAt: time.Now().Add(time.Hour), HTTPStatus: 503,
		ResponseExcerpt: "unavailable", ErrorMessage: "channel returned HTTP 503",
	}
	if err := db.Create(&delivery).Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.RetryDelivery(ctx, delivery.ID); err != nil {
		t.Fatal(err)
	}
	if err := db.First(&delivery, "id = ?", delivery.ID).Error; err != nil {
		t.Fatal(err)
	}
	if delivery.Status != "pending" || delivery.AttemptCount != 0 || delivery.HTTPStatus != 0 || delivery.ResponseExcerpt != "" || delivery.ErrorMessage != "" {
		t.Fatalf("manual retry did not reset delivery budget and stale outcome: %#v", delivery)
	}
}
