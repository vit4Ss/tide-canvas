package alerting

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type sendResult struct {
	StatusCode int
	Response   string
	Permanent  bool
}

func validateChannel(kind string, cfg ChannelConfig) error {
	switch kind {
	case ChannelFeishu:
		if err := validateWebhook(cfg.Webhook, "open.feishu.cn", "open.larksuite.com"); err != nil {
			return fmt.Errorf("飞书 Webhook 无效: %w", err)
		}
	case ChannelDingTalk:
		if err := validateWebhook(cfg.Webhook, "oapi.dingtalk.com", "api.dingtalk.com"); err != nil {
			return fmt.Errorf("钉钉 Webhook 无效: %w", err)
		}
	case ChannelWeCom:
		if err := validateWeComWebhook(cfg.Webhook); err != nil {
			return fmt.Errorf("企业微信 Webhook 无效: %w", err)
		}
	case ChannelTelegram:
		if strings.TrimSpace(cfg.BotToken) == "" || strings.TrimSpace(cfg.ChatID) == "" {
			return errors.New("Telegram Bot Token 和 Chat ID 均不能为空")
		}
	default:
		return errors.New("不支持的通知渠道")
	}
	return nil
}

func validateWeComWebhook(raw string) error {
	if err := validateWebhook(raw, "qyapi.weixin.qq.com"); err != nil {
		return err
	}
	u, _ := url.Parse(strings.TrimSpace(raw))
	if u.Path != "/cgi-bin/webhook/send" || strings.TrimSpace(u.Query().Get("key")) == "" {
		return errors.New("必须是包含 key 的群机器人 Webhook 地址")
	}
	return nil
}

func validateWebhook(raw string, allowed ...string) error {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Scheme != "https" || u.Hostname() == "" {
		return errors.New("必须是 HTTPS 地址")
	}
	for _, host := range allowed {
		if strings.EqualFold(u.Hostname(), host) {
			return nil
		}
	}
	return errors.New("域名不在官方允许列表")
}

func (s *Service) send(ctx context.Context, kind string, cfg ChannelConfig, message string) (sendResult, error) {
	if err := validateChannel(kind, cfg); err != nil {
		return sendResult{Permanent: true}, err
	}
	var endpoint string
	var body any
	switch kind {
	case ChannelFeishu:
		endpoint = cfg.Webhook
		payload := map[string]any{
			"msg_type": "text",
			"content":  map[string]string{"text": truncateRunes(message, 3800)},
		}
		if strings.TrimSpace(cfg.Secret) != "" {
			timestamp := strconv.FormatInt(time.Now().Unix(), 10)
			key := timestamp + "\n" + cfg.Secret
			mac := hmac.New(sha256.New, []byte(key))
			payload["timestamp"] = timestamp
			payload["sign"] = base64.StdEncoding.EncodeToString(mac.Sum(nil))
		}
		body = payload
	case ChannelDingTalk:
		endpoint = cfg.Webhook
		if strings.TrimSpace(cfg.Secret) != "" {
			timestamp := strconv.FormatInt(time.Now().UnixMilli(), 10)
			mac := hmac.New(sha256.New, []byte(cfg.Secret))
			_, _ = mac.Write([]byte(timestamp + "\n" + cfg.Secret))
			sign := url.QueryEscape(base64.StdEncoding.EncodeToString(mac.Sum(nil)))
			separator := "?"
			if strings.Contains(endpoint, "?") {
				separator = "&"
			}
			endpoint += separator + "timestamp=" + timestamp + "&sign=" + sign
		}
		body = map[string]any{"msgtype": "text", "text": map[string]string{"content": truncateRunes(message, 3800)}}
	case ChannelWeCom:
		endpoint = cfg.Webhook
		body = map[string]any{
			"msgtype": "text",
			"text":    map[string]string{"content": truncateUTF8Bytes(message, 2048)},
		}
	case ChannelTelegram:
		endpoint = "https://api.telegram.org/bot" + strings.TrimSpace(cfg.BotToken) + "/sendMessage"
		payload := map[string]any{
			"chat_id":                  cfg.ChatID,
			"text":                     truncateRunes(message, 3900),
			"disable_web_page_preview": true,
		}
		if threadID, err := strconv.ParseInt(strings.TrimSpace(cfg.ThreadID), 10, 64); err == nil && threadID > 0 {
			payload["message_thread_id"] = threadID
		}
		body = payload
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return sendResult{Permanent: true}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(raw))
	if err != nil {
		return sendResult{Permanent: true}, err
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := s.client.Do(req)
	if err != nil {
		return sendResult{}, err
	}
	defer res.Body.Close()
	resp, readErr := io.ReadAll(io.LimitReader(res.Body, 64<<10))
	result := sendResult{StatusCode: res.StatusCode, Response: truncateRunes(strings.TrimSpace(string(resp)), 500)}
	if readErr != nil {
		return result, readErr
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		result.Permanent = res.StatusCode >= 400 && res.StatusCode < 500 && res.StatusCode != 408 && res.StatusCode != 429
		return result, fmt.Errorf("channel returned HTTP %d", res.StatusCode)
	}
	if err := platformError(kind, resp); err != nil {
		result.Permanent = true
		return result, err
	}
	return result, nil
}

func platformError(kind string, raw []byte) error {
	var v map[string]any
	if json.Unmarshal(raw, &v) != nil {
		return nil
	}
	for _, key := range []string{"code", "errcode"} {
		if n, ok := v[key].(float64); ok && n != 0 {
			msg, _ := v["msg"].(string)
			if msg == "" {
				msg, _ = v["errmsg"].(string)
			}
			return fmt.Errorf("%s rejected message: code %.0f %s", kind, n, msg)
		}
	}
	if kind == ChannelTelegram {
		if ok, exists := v["ok"].(bool); exists && !ok {
			return errors.New("telegram rejected message")
		}
	}
	return nil
}

func truncateRunes(value string, max int) string {
	r := []rune(value)
	if len(r) <= max {
		return value
	}
	return string(r[:max-1]) + "…"
}

// 企业微信群机器人按 UTF-8 字节数限制文本内容。截断时保留完整 rune，
// 避免在多字节中文字符中间切断并生成无效 JSON 文本。
func truncateUTF8Bytes(value string, max int) string {
	if len(value) <= max {
		return value
	}
	suffix := "…"
	budget := max - len(suffix)
	if budget <= 0 {
		return ""
	}
	var b strings.Builder
	b.Grow(max)
	for _, r := range value {
		n := len(string(r))
		if b.Len()+n > budget {
			return b.String() + suffix
		}
		b.WriteRune(r)
	}
	return b.String()
}
