package alerting

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

type Service struct {
	db         *gorm.DB
	vault      vault
	env        string
	instanceID string
	client     *http.Client
}

func New(db *gorm.DB, env, encryptionSecret string) *Service {
	host, _ := os.Hostname()
	if strings.TrimSpace(host) == "" {
		host = "unknown"
	}
	return &Service{
		db:         db,
		vault:      newVault(encryptionSecret),
		env:        strings.TrimSpace(env),
		instanceID: host + ":" + strconv.Itoa(os.Getpid()),
		client:     &http.Client{Timeout: 8 * time.Second},
	}
}

func (s *Service) ListChannels(ctx context.Context) ([]ChannelView, error) {
	var rows []model.AlertChannel
	if err := s.db.WithContext(ctx).Order("create_time ASC").Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]ChannelView, 0, len(rows))
	for i := range rows {
		out = append(out, s.channelView(&rows[i]))
	}
	return out, nil
}

func (s *Service) CreateChannel(ctx context.Context, in ChannelInput) (ChannelView, error) {
	in = normalizeChannelInput(in)
	if err := validateChannelInput(in); err != nil {
		return ChannelView{}, err
	}
	sealed, err := s.vault.seal(in.Config)
	if err != nil {
		return ChannelView{}, err
	}
	row := model.AlertChannel{Name: in.Name, Type: in.Type, Enabled: in.Enabled, MinSeverity: in.MinSeverity, ConfigEncrypted: sealed}
	if err := s.db.WithContext(ctx).Create(&row).Error; err != nil {
		return ChannelView{}, err
	}
	if err := s.db.WithContext(ctx).Model(&row).Updates(map[string]any{"enabled": in.Enabled}).Error; err != nil {
		return ChannelView{}, err
	}
	row.Enabled = in.Enabled
	return s.channelView(&row), nil
}

func (s *Service) UpdateChannel(ctx context.Context, id idgen.ID, in ChannelInput) (ChannelView, error) {
	var row model.AlertChannel
	if err := s.db.WithContext(ctx).First(&row, "id = ?", id).Error; err != nil {
		return ChannelView{}, err
	}
	old, err := s.vault.open(row.ConfigEncrypted)
	if err != nil {
		return ChannelView{}, err
	}
	in = normalizeChannelInput(in)
	in.Config = mergeMaskedConfig(in.Config, old)
	if err := validateChannelInput(in); err != nil {
		return ChannelView{}, err
	}
	sealed, err := s.vault.seal(in.Config)
	if err != nil {
		return ChannelView{}, err
	}
	if err := s.db.WithContext(ctx).Model(&row).Updates(map[string]any{
		"name": in.Name, "type": in.Type, "enabled": in.Enabled,
		"min_severity": in.MinSeverity, "config_encrypted": sealed,
	}).Error; err != nil {
		return ChannelView{}, err
	}
	if err := s.db.WithContext(ctx).First(&row, "id = ?", id).Error; err != nil {
		return ChannelView{}, err
	}
	return s.channelView(&row), nil
}

func (s *Service) DeleteChannel(ctx context.Context, id idgen.ID) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("channel_id = ? AND status IN ?", id, []string{"pending", "retry", "processing"}).
			Delete(&model.AlertDelivery{}).Error; err != nil {
			return err
		}
		res := tx.Delete(&model.AlertChannel{}, "id = ?", id)
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			return gorm.ErrRecordNotFound
		}
		return nil
	})
}

func (s *Service) TestChannel(ctx context.Context, id idgen.ID) error {
	var row model.AlertChannel
	if err := s.db.WithContext(ctx).First(&row, "id = ?", id).Error; err != nil {
		return err
	}
	cfg, err := s.vault.open(row.ConfigEncrypted)
	if err != nil {
		return err
	}
	message := fmt.Sprintf("【测试】管理员通知渠道连接成功\n环境：%s\n渠道：%s\n时间：%s", s.env, row.Name, time.Now().Format("2006-01-02 15:04:05"))
	result, err := s.send(ctx, row.Type, cfg, message)
	s.updateChannelHealth(ctx, row.ID, result, err)
	return err
}

func (s *Service) channelView(row *model.AlertChannel) ChannelView {
	cfg, err := s.vault.open(row.ConfigEncrypted)
	configured := err == nil && validateChannel(row.Type, cfg) == nil
	if err != nil {
		cfg = ChannelConfig{}
	}
	return ChannelView{
		ID: row.ID.String(), Name: row.Name, Type: row.Type, Enabled: row.Enabled,
		MinSeverity: row.MinSeverity, Config: maskedConfig(cfg), Configured: configured,
		LastSuccessAt: formatTimePtr(row.LastSuccessAt), LastFailureAt: formatTimePtr(row.LastFailureAt),
		LastError: row.LastError, CreateTime: formatTime(row.CreateTime), UpdateTime: formatTime(row.UpdateTime),
	}
}

func normalizeChannelInput(in ChannelInput) ChannelInput {
	in.Name = strings.TrimSpace(in.Name)
	in.Type = strings.ToLower(strings.TrimSpace(in.Type))
	in.MinSeverity = normalizeSeverity(in.MinSeverity)
	in.Config.Webhook = strings.TrimSpace(in.Config.Webhook)
	in.Config.Secret = strings.TrimSpace(in.Config.Secret)
	in.Config.BotToken = strings.TrimSpace(in.Config.BotToken)
	in.Config.ChatID = strings.TrimSpace(in.Config.ChatID)
	in.Config.ThreadID = strings.TrimSpace(in.Config.ThreadID)
	return in
}

func validateChannelInput(in ChannelInput) error {
	if in.Name == "" || len([]rune(in.Name)) > 128 {
		return errors.New("渠道名称不能为空且最多 128 个字符")
	}
	if !validSeverity(in.MinSeverity) {
		return errors.New("无效的最低告警级别")
	}
	return validateChannel(in.Type, in.Config)
}

func (s *Service) ListRules(ctx context.Context) ([]RuleView, error) {
	var rows []model.AlertRule
	if err := s.db.WithContext(ctx).Order("create_time ASC").Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]RuleView, 0, len(rows))
	for i := range rows {
		out = append(out, ruleView(&rows[i]))
	}
	return out, nil
}

func (s *Service) CreateRule(ctx context.Context, in RuleInput) (RuleView, error) {
	in, err := normalizeRuleInput(in)
	if err != nil {
		return RuleView{}, err
	}
	patterns, _ := json.Marshal(in.EventPatterns)
	channels, _ := json.Marshal(in.ChannelIDs)
	row := model.AlertRule{Name: in.Name, Enabled: in.Enabled, EventPatterns: string(patterns), MinSeverity: in.MinSeverity,
		ChannelIDs: string(channels), CooldownSeconds: in.CooldownSeconds, AggregateSeconds: in.AggregateSeconds, SendRecovery: in.SendRecovery}
	if err := s.db.WithContext(ctx).Create(&row).Error; err != nil {
		return RuleView{}, err
	}
	if err := s.db.WithContext(ctx).Model(&row).Updates(map[string]any{"enabled": in.Enabled, "send_recovery": in.SendRecovery}).Error; err != nil {
		return RuleView{}, err
	}
	row.Enabled, row.SendRecovery = in.Enabled, in.SendRecovery
	return ruleView(&row), nil
}

func (s *Service) UpdateRule(ctx context.Context, id idgen.ID, in RuleInput) (RuleView, error) {
	in, err := normalizeRuleInput(in)
	if err != nil {
		return RuleView{}, err
	}
	patterns, _ := json.Marshal(in.EventPatterns)
	channels, _ := json.Marshal(in.ChannelIDs)
	res := s.db.WithContext(ctx).Model(&model.AlertRule{}).Where("id = ?", id).Updates(map[string]any{
		"name": in.Name, "enabled": in.Enabled, "event_patterns": string(patterns), "min_severity": in.MinSeverity,
		"channel_ids": string(channels), "cooldown_seconds": in.CooldownSeconds,
		"aggregate_seconds": in.AggregateSeconds, "send_recovery": in.SendRecovery,
	})
	if res.Error != nil || res.RowsAffected == 0 {
		if res.Error != nil {
			return RuleView{}, res.Error
		}
		return RuleView{}, gorm.ErrRecordNotFound
	}
	var row model.AlertRule
	if err := s.db.WithContext(ctx).First(&row, "id = ?", id).Error; err != nil {
		return RuleView{}, err
	}
	return ruleView(&row), nil
}

func (s *Service) DeleteRule(ctx context.Context, id idgen.ID) error {
	res := s.db.WithContext(ctx).Delete(&model.AlertRule{}, "id = ?", id)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func normalizeRuleInput(in RuleInput) (RuleInput, error) {
	in.Name = strings.TrimSpace(in.Name)
	in.MinSeverity = normalizeSeverity(in.MinSeverity)
	if in.Name == "" {
		return in, errors.New("规则名称不能为空")
	}
	if !validSeverity(in.MinSeverity) {
		return in, errors.New("无效的最低告警级别")
	}
	if len(in.EventPatterns) == 0 {
		in.EventPatterns = []string{"*"}
	}
	seen := map[string]bool{}
	patterns := make([]string, 0, len(in.EventPatterns))
	for _, p := range in.EventPatterns {
		p = strings.TrimSpace(p)
		if p == "" || strings.ContainsAny(p, " \t\r\n") {
			return in, errors.New("事件匹配模式无效")
		}
		if !seen[p] {
			seen[p] = true
			patterns = append(patterns, p)
		}
	}
	in.EventPatterns = patterns
	if in.CooldownSeconds < 0 || in.CooldownSeconds > 86400 {
		return in, errors.New("冷却时间应在 0 到 86400 秒之间")
	}
	if in.AggregateSeconds < 0 || in.AggregateSeconds > 86400 {
		return in, errors.New("聚合时间应在 0 到 86400 秒之间")
	}
	return in, nil
}

func ruleView(row *model.AlertRule) RuleView {
	var patterns, channels []string
	_ = json.Unmarshal([]byte(row.EventPatterns), &patterns)
	_ = json.Unmarshal([]byte(row.ChannelIDs), &channels)
	return RuleView{ID: row.ID.String(), RuleInput: RuleInput{Name: row.Name, Enabled: row.Enabled,
		EventPatterns: patterns, MinSeverity: row.MinSeverity, ChannelIDs: channels,
		CooldownSeconds: row.CooldownSeconds, AggregateSeconds: row.AggregateSeconds, SendRecovery: row.SendRecovery},
		CreateTime: formatTime(row.CreateTime), UpdateTime: formatTime(row.UpdateTime)}
}

func (s *Service) EnsureDefaultRules(ctx context.Context) error {
	var count int64
	if err := s.db.WithContext(ctx).Model(&model.AlertRule{}).Count(&count).Error; err != nil || count > 0 {
		return err
	}
	_, err := s.CreateRule(ctx, RuleInput{Name: "异常与风险通知", Enabled: true,
		EventPatterns: []string{"ai.*", "billing.*", "supplier.*", "payment.*", "storage.*", "mail.*", "system.*"},
		MinSeverity:   SeverityWarning, CooldownSeconds: 300, SendRecovery: true})
	return err
}

func (s *Service) Publish(ctx context.Context, in EventInput) error {
	in = normalizeEventInput(in)
	if err := validateEventInput(in); err != nil {
		return err
	}
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var existing model.AlertEvent
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("fingerprint = ? AND state = ?", in.Fingerprint, "firing").
			Order("id DESC").First(&existing).Error
		now := in.OccurredAt
		payload, _ := json.Marshal(sanitizeDetails(in.Details))
		if err == nil {
			existing.OccurrenceCount++
			existing.LastOccurredAt = now
			existing.Title, existing.Content, existing.Payload = in.Title, in.Content, string(payload)
			if severityRank(in.Severity) > severityRank(existing.Severity) {
				existing.Severity = in.Severity
			}
			if now.Before(existing.NextNotifyAt) {
				if err := tx.Save(&existing).Error; err != nil {
					return err
				}
				return tx.Model(&model.AlertDelivery{}).
					Where("event_id = ? AND sequence = ? AND kind = ? AND status = ?", existing.ID, existing.NotifySequence, "firing", "pending").
					Update("message", buildMessage(&existing, "firing")).Error
			}
			route, routeErr := s.route(tx, in.EventType, existing.Severity)
			if routeErr != nil {
				return routeErr
			}
			existing.NotifySequence++
			existing.NextNotifyAt = now.Add(time.Duration(route.suppressSeconds()) * time.Second)
			if err := tx.Save(&existing).Error; err != nil {
				return err
			}
			return s.enqueue(tx, &existing, route.channelIDs, "firing", route.aggregate)
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		route, err := s.route(tx, in.EventType, in.Severity)
		if err != nil {
			return err
		}
		event := model.AlertEvent{EventType: in.EventType, Category: in.Category, Severity: in.Severity, State: "firing",
			Fingerprint: in.Fingerprint, Title: in.Title, Content: in.Content, Payload: string(payload), Source: in.Source,
			Environment: s.env, InstanceID: s.instanceID, OccurrenceCount: 1, NotifySequence: 1,
			FirstOccurredAt: now, LastOccurredAt: now, NextNotifyAt: now.Add(time.Duration(route.suppressSeconds()) * time.Second)}
		if err := tx.Create(&event).Error; err != nil {
			return err
		}
		return s.enqueue(tx, &event, route.channelIDs, "firing", route.aggregate)
	})
}

func (s *Service) Resolve(ctx context.Context, fingerprint, title, content string, details map[string]any) error {
	fingerprint = strings.TrimSpace(fingerprint)
	if fingerprint == "" {
		return errors.New("fingerprint is required")
	}
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var event model.AlertEvent
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("fingerprint = ? AND state = ?", fingerprint, "firing").Order("id DESC").First(&event).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			}
			return err
		}
		route, err := s.route(tx, event.EventType, event.Severity)
		if err != nil {
			return err
		}
		now := time.Now()
		event.State, event.ResolvedAt, event.LastOccurredAt = "resolved", &now, now
		if strings.TrimSpace(title) != "" {
			event.Title = strings.TrimSpace(title)
		}
		if strings.TrimSpace(content) != "" {
			event.Content = strings.TrimSpace(content)
		}
		if details != nil {
			raw, _ := json.Marshal(sanitizeDetails(details))
			event.Payload = string(raw)
		}
		event.NotifySequence++
		if err := tx.Save(&event).Error; err != nil {
			return err
		}
		if !route.sendRecovery {
			return nil
		}
		return s.enqueue(tx, &event, route.channelIDs, "recovery", 0)
	})
}

type routing struct {
	channelIDs   []idgen.ID
	cooldown     int
	aggregate    int
	sendRecovery bool
}

func (r routing) suppressSeconds() int {
	if r.aggregate > r.cooldown {
		return r.aggregate
	}
	return r.cooldown
}

func (s *Service) route(tx *gorm.DB, eventType, severity string) (routing, error) {
	var totalRules int64
	if err := tx.Model(&model.AlertRule{}).Count(&totalRules).Error; err != nil {
		return routing{}, err
	}
	var rules []model.AlertRule
	if err := tx.Where("enabled = ?", true).Order("create_time ASC").Find(&rules).Error; err != nil {
		return routing{}, err
	}
	matched := false
	allChannels := false
	cooldown := -1
	aggregate := -1
	recovery := false
	ids := map[idgen.ID]bool{}
	for i := range rules {
		var patterns, rawIDs []string
		_ = json.Unmarshal([]byte(rules[i].EventPatterns), &patterns)
		if !patternsMatch(patterns, eventType) {
			continue
		}
		if severityRank(severity) < severityRank(rules[i].MinSeverity) {
			continue
		}
		matched = true
		if cooldown < 0 || rules[i].CooldownSeconds < cooldown {
			cooldown = rules[i].CooldownSeconds
		}
		if aggregate < 0 || rules[i].AggregateSeconds < aggregate {
			aggregate = rules[i].AggregateSeconds
		}
		if rules[i].SendRecovery {
			recovery = true
		}
		_ = json.Unmarshal([]byte(rules[i].ChannelIDs), &rawIDs)
		if len(rawIDs) == 0 {
			allChannels = true
		}
		for _, raw := range rawIDs {
			if id, err := idgen.Parse(raw); err == nil && id != 0 {
				ids[id] = true
			}
		}
	}
	if !matched {
		if totalRules > 0 {
			return routing{cooldown: 300}, nil
		}
		allChannels, recovery, cooldown = true, true, 300
	}
	if cooldown < 0 {
		cooldown = 300
	}
	if aggregate < 0 {
		aggregate = 0
	}
	var channels []model.AlertChannel
	q := tx.Where("enabled = ?", true)
	if !allChannels {
		wanted := make([]idgen.ID, 0, len(ids))
		for id := range ids {
			wanted = append(wanted, id)
		}
		if len(wanted) == 0 {
			return routing{cooldown: cooldown, aggregate: aggregate, sendRecovery: recovery}, nil
		}
		q = q.Where("id IN ?", wanted)
	}
	if err := q.Find(&channels).Error; err != nil {
		return routing{}, err
	}
	out := make([]idgen.ID, 0, len(channels))
	for i := range channels {
		if severityRank(severity) >= severityRank(channels[i].MinSeverity) {
			out = append(out, channels[i].ID)
		}
	}
	return routing{channelIDs: out, cooldown: cooldown, aggregate: aggregate, sendRecovery: recovery}, nil
}

func (s *Service) enqueue(tx *gorm.DB, event *model.AlertEvent, channels []idgen.ID, kind string, aggregateSeconds int) error {
	message := buildMessage(event, kind)
	now := time.Now().Add(time.Duration(aggregateSeconds) * time.Second)
	for _, channelID := range channels {
		d := model.AlertDelivery{EventID: event.ID, ChannelID: channelID, Sequence: event.NotifySequence,
			Kind: kind, Message: message, Status: "pending", NextAttemptAt: now}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&d).Error; err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) ListEvents(ctx context.Context, q EventQuery) (Page[EventView], error) {
	if q.PageNum <= 0 {
		q.PageNum = 1
	}
	if q.PageSize <= 0 {
		q.PageSize = 20
	}
	if q.PageSize > 100 {
		q.PageSize = 100
	}
	db := s.db.WithContext(ctx).Model(&model.AlertEvent{})
	if q.Keyword != "" {
		like := "%" + strings.TrimSpace(q.Keyword) + "%"
		db = db.Where("title LIKE ? OR content LIKE ? OR event_type LIKE ?", like, like, like)
	}
	if q.Severity != "" {
		db = db.Where("severity = ?", q.Severity)
	}
	if q.Category != "" {
		db = db.Where("category = ?", q.Category)
	}
	if q.State != "" {
		db = db.Where("state = ?", q.State)
	}
	var total int64
	if err := db.Count(&total).Error; err != nil {
		return Page[EventView]{}, err
	}
	var rows []model.AlertEvent
	if err := db.Order("last_occurred_at DESC").Offset((q.PageNum - 1) * q.PageSize).Limit(q.PageSize).Find(&rows).Error; err != nil {
		return Page[EventView]{}, err
	}
	out := make([]EventView, 0, len(rows))
	for i := range rows {
		out = append(out, eventView(&rows[i]))
	}
	return Page[EventView]{Records: out, Total: total, PageNum: q.PageNum, PageSize: q.PageSize}, nil
}

func (s *Service) ListDeliveries(ctx context.Context, eventID idgen.ID) ([]DeliveryView, error) {
	type joined struct {
		model.AlertDelivery
		ChannelName string
		ChannelType string
	}
	var rows []joined
	if err := s.db.WithContext(ctx).Table("alert_delivery d").Select("d.*, c.name channel_name, c.type channel_type").
		Joins("LEFT JOIN alert_channel c ON c.id = d.channel_id").Where("d.event_id = ? AND d.deleted IS NULL", eventID).
		Order("d.create_time DESC").Scan(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]DeliveryView, 0, len(rows))
	for i := range rows {
		d := &rows[i]
		out = append(out, DeliveryView{ID: d.ID.String(), EventID: d.EventID.String(), ChannelID: d.ChannelID.String(), ChannelName: d.ChannelName,
			ChannelType: d.ChannelType, Kind: d.Kind, Status: d.Status, AttemptCount: d.AttemptCount, HTTPStatus: d.HTTPStatus,
			ResponseExcerpt: d.ResponseExcerpt, ErrorMessage: d.ErrorMessage, NextAttemptAt: formatTime(d.NextAttemptAt), SentAt: formatTimePtr(d.SentAt), CreateTime: formatTime(d.CreateTime)})
	}
	return out, nil
}

func (s *Service) RetryDelivery(ctx context.Context, id idgen.ID) error {
	res := s.db.WithContext(ctx).Model(&model.AlertDelivery{}).Where("id = ? AND status IN ?", id, []string{"failed", "retry"}).Updates(map[string]any{
		"status": "pending", "next_attempt_at": time.Now(), "locked_by": "", "locked_at": nil, "error_message": "",
	})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return errors.New("该投递当前不能重试")
	}
	return nil
}

func normalizeEventInput(in EventInput) EventInput {
	in.EventType = strings.TrimSpace(in.EventType)
	in.Category = strings.TrimSpace(in.Category)
	in.Severity = normalizeSeverity(in.Severity)
	in.Fingerprint = strings.TrimSpace(in.Fingerprint)
	in.Title = strings.TrimSpace(in.Title)
	in.Content = strings.TrimSpace(in.Content)
	in.Source = strings.TrimSpace(in.Source)
	if in.Category == "" {
		in.Category = strings.Split(in.EventType, ".")[0]
	}
	if in.OccurredAt.IsZero() {
		in.OccurredAt = time.Now()
	}
	return in
}
func validateEventInput(in EventInput) error {
	if in.EventType == "" || in.Fingerprint == "" || in.Title == "" {
		return errors.New("eventType, fingerprint and title are required")
	}
	if !validSeverity(in.Severity) {
		return errors.New("invalid severity")
	}
	return nil
}
func normalizeSeverity(v string) string {
	v = strings.ToLower(strings.TrimSpace(v))
	if v == "warn" {
		return SeverityWarning
	}
	if v == "" {
		return SeverityWarning
	}
	return v
}
func validSeverity(v string) bool { return severityRank(v) >= 0 }
func severityRank(v string) int {
	switch normalizeSeverity(v) {
	case SeverityInfo:
		return 0
	case SeverityWarning:
		return 1
	case SeverityError:
		return 2
	case SeverityCritical:
		return 3
	}
	return -1
}
func patternsMatch(patterns []string, event string) bool {
	for _, p := range patterns {
		if p == "*" || p == event || (strings.HasSuffix(p, ".*") && strings.HasPrefix(event, strings.TrimSuffix(p, "*"))) {
			return true
		}
	}
	return false
}

func sanitizeDetails(details map[string]any) map[string]any {
	out := map[string]any{}
	for k, v := range details {
		low := strings.ToLower(k)
		if strings.Contains(low, "token") || strings.Contains(low, "secret") || strings.Contains(low, "password") || strings.Contains(low, "authorization") || strings.Contains(low, "prompt") {
			out[k] = "[已隐藏]"
			continue
		}
		out[k] = truncateRunes(redactText(fmt.Sprint(v)), 500)
	}
	return out
}

var (
	bearerPattern   = regexp.MustCompile(`(?i)bearer\s+[a-z0-9._~+/=-]+`)
	secretPattern   = regexp.MustCompile(`(?i)(authorization|api[_-]?key|access[_-]?token|token|secret|password)(["'=: ]+)[^&\s,}]+`)
	telegramPattern = regexp.MustCompile(`\b\d{6,}:[A-Za-z0-9_-]{20,}\b`)
)

func redactText(value string) string {
	value = bearerPattern.ReplaceAllString(value, "Bearer [已隐藏]")
	value = secretPattern.ReplaceAllString(value, "$1=[已隐藏]")
	return telegramPattern.ReplaceAllString(value, "[已隐藏]")
}
func buildMessage(e *model.AlertEvent, kind string) string {
	labels := map[string]string{SeverityInfo: "提示", SeverityWarning: "警告", SeverityError: "错误", SeverityCritical: "严重"}
	prefix := "【" + labels[e.Severity] + "】"
	if kind == "recovery" {
		prefix = "【恢复】"
	}
	lines := []string{prefix + e.Title, "环境：" + e.Environment, "来源：" + valueOr(e.Source, "system"), "事件：" + e.EventType, "详情：" + e.Content, "发生次数：" + strconv.Itoa(e.OccurrenceCount), "时间：" + e.LastOccurredAt.Format("2006-01-02 15:04:05")}
	var detail map[string]any
	_ = json.Unmarshal([]byte(e.Payload), &detail)
	keys := make([]string, 0, len(detail))
	for k := range detail {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		lines = append(lines, k+"："+fmt.Sprint(detail[k]))
	}
	return strings.Join(lines, "\n")
}
func eventView(e *model.AlertEvent) EventView {
	var d map[string]any
	_ = json.Unmarshal([]byte(e.Payload), &d)
	if d == nil {
		d = map[string]any{}
	}
	return EventView{ID: e.ID.String(), EventType: e.EventType, Category: e.Category, Severity: e.Severity, State: e.State, Fingerprint: e.Fingerprint, Title: e.Title, Content: e.Content, Details: d, Source: e.Source, Environment: e.Environment, InstanceID: e.InstanceID, OccurrenceCount: e.OccurrenceCount, FirstOccurredAt: formatTime(e.FirstOccurredAt), LastOccurredAt: formatTime(e.LastOccurredAt), ResolvedAt: formatTimePtr(e.ResolvedAt), CreateTime: formatTime(e.CreateTime)}
}
func formatTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.Format(time.RFC3339)
}
func formatTimePtr(t *time.Time) string {
	if t == nil {
		return ""
	}
	return formatTime(*t)
}
func valueOr(v, d string) string {
	if strings.TrimSpace(v) == "" {
		return d
	}
	return v
}
