// Package epay integrates 易联达Pay (eliandapay / api.ndow.cn) — a standard
// "易支付/epay"-style aggregator cashier (V1 / MD5 signing) that fronts both
// Alipay and WeChat Pay behind one page-jump checkout.
//
// Everything protocol-specific is isolated here so a merchant-doc discrepancy is
// a localized edit. Ported from the reference Java service (com.scarecrowtoken
// .relay.service.EliandaPayService) with the identical wire protocol:
//
//   - Page-jump create: browser GET to <gateway>/submit.php with
//     pid,type,out_trade_no,notify_url,return_url,name,money,param,sign,
//     sign_type=MD5. The cashier auto-adapts (mobile → app; desktop → QR).
//   - Sign: all non-empty params except sign/sign_type, sorted by key ASCII
//     ascending, joined a=b&c=d (NO url-encoding), MD5 key appended DIRECTLY
//     (…&c=d + KEY), MD5, lowercase hex.
//   - Async notify: gateway GETs notify_url with pid,trade_no,out_trade_no,type,
//     name,money,trade_status=TRADE_SUCCESS,param,sign,sign_type; verify the sign
//     the same way and reply the literal "success".
//   - Order query / refund via api.php (authenticated by the plaintext key, no
//     sign) as a backstop for a dropped notify and for admin refunds.
package epay

import (
	"context"
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/shopspring/decimal"
)

const (
	submitPath  = "submit.php"
	signType    = "MD5"
	tradeStatus = "TRADE_SUCCESS"
)

// SupportedTypes is the set of epay pay methods this cashier exposes.
var SupportedTypes = map[string]bool{"alipay": true, "wxpay": true}

// Config holds the merchant credentials and callback URLs. It mirrors the
// reference AppProperties.Eliandapay.
type Config struct {
	Enabled    bool
	Gateway    string // API base, e.g. https://api.ndow.cn/
	MerchantID string // 商户ID — the epay `pid`.
	MD5Key     string // V1 MD5 密钥 — appended to the sorted param string before MD5.
	NotifyURL  string // PUBLIC https URL the gateway GETs on payment.
	ReturnURL  string // browser sync-redirect after pay (UX only).
}

// Client performs signed epay calls against a configured gateway.
type Client struct {
	cfg  Config
	http *http.Client
}

// New builds a Client. hc may be nil (a default 15s client is used).
func New(cfg Config, hc *http.Client) *Client {
	if hc == nil {
		hc = &http.Client{Timeout: 15 * time.Second}
	}
	return &Client{cfg: cfg, http: hc}
}

// Enabled reports whether the integration is switched on.
func (c *Client) Enabled() bool { return c.cfg.Enabled }

// Errors surfaced to callers.
var (
	ErrDisabled    = errors.New("epay: not enabled")
	ErrBadPayType  = errors.New("epay: unsupported pay type (use alipay | wxpay)")
	ErrNoNotifyURL = errors.New("epay: notify URL is not configured")
)

// CheckoutParams describes a single order to charge.
type CheckoutParams struct {
	Type       string          // "alipay" | "wxpay"
	OutTradeNo string          // our order number (idempotency key)
	Name       string          // human product name shown on the cashier
	Money      decimal.Decimal // amount in 元 (yuan)
	Param      string          // opaque round-trip value (we use userID:orderNo)
}

// CheckoutURL builds the page-jump cashier URL the browser should open. Credits
// are granted later by the async notify, not here.
func (c *Client) CheckoutURL(p CheckoutParams) (string, error) {
	if !c.cfg.Enabled {
		return "", ErrDisabled
	}
	if !SupportedTypes[p.Type] {
		return "", ErrBadPayType
	}
	// notify_url is REQUIRED by the gateway; a blank value is silently dropped
	// from the sign/query and the gateway rejects the order with a cryptic error.
	if strings.TrimSpace(c.cfg.NotifyURL) == "" {
		return "", ErrNoNotifyURL
	}

	params := map[string]string{
		"pid":          c.cfg.MerchantID,
		"type":         p.Type,
		"out_trade_no": p.OutTradeNo,
		"notify_url":   c.cfg.NotifyURL,
		"return_url":   c.cfg.ReturnURL,
		"name":         p.Name,
		"money":        Money(p.Money),
		"param":        p.Param,
	}
	params["sign"] = sign(params, c.cfg.MD5Key)
	params["sign_type"] = signType

	return trimSlash(c.cfg.Gateway) + "/" + submitPath + "?" + encodeQuery(params), nil
}

// NotifyResult is the parsed, verified async-notify payload.
type NotifyResult struct {
	OutTradeNo string
	TradeNo    string          // gateway-side transaction id
	Param      string          // our round-tripped userID:orderNo
	Money      decimal.Decimal // amount actually paid (元)
	Type       string
}

// VerifyNotify checks the async notify's signature and trade status. It returns
// the parsed result on success, or an error describing why the notify was
// rejected (bad sign / non-success / malformed) so the caller replies "fail"
// and the gateway retries.
func (c *Client) VerifyNotify(raw map[string]string) (*NotifyResult, error) {
	if !c.cfg.Enabled {
		return nil, ErrDisabled
	}
	expected := sign(raw, c.cfg.MD5Key)
	got := raw["sign"]
	if got == "" || !strings.EqualFold(expected, got) {
		return nil, fmt.Errorf("epay: bad sign for order %s", raw["out_trade_no"])
	}
	if raw["trade_status"] != tradeStatus {
		return nil, fmt.Errorf("epay: non-success status %q for order %s", raw["trade_status"], raw["out_trade_no"])
	}
	money := ParseMoney(raw["money"])
	if money == nil {
		return nil, fmt.Errorf("epay: unparseable money %q for order %s", raw["money"], raw["out_trade_no"])
	}
	return &NotifyResult{
		OutTradeNo: raw["out_trade_no"],
		TradeNo:    raw["trade_no"],
		Param:      raw["param"],
		Money:      *money,
		Type:       raw["type"],
	}, nil
}

// OrderStatus is the subset of an act=order query we rely on.
type OrderStatus struct {
	Paid    bool
	Param   string
	Money   *decimal.Decimal
	TradeNo string
}

// QueryOrder looks an order up by out_trade_no (api.php?act=order). Used as a
// backstop when the async notify never arrives: the return_url handler queries
// and grants idempotently. Returns ErrDisabled when the integration is off.
func (c *Client) QueryOrder(ctx context.Context, outTradeNo string) (*OrderStatus, error) {
	if !c.cfg.Enabled {
		return nil, ErrDisabled
	}
	node, err := c.gatewayGet(ctx, map[string]string{
		"act": "order", "pid": c.cfg.MerchantID, "key": c.cfg.MD5Key, "out_trade_no": outTradeNo,
	})
	if err != nil {
		return nil, err
	}
	if node["code"].Int() != 1 {
		return nil, fmt.Errorf("epay: order query code=%v for %s", node["code"], outTradeNo)
	}
	out := &OrderStatus{
		Paid:    node["status"].Int() == 1, // 1 = paid
		Param:   node["param"].Str(),
		TradeNo: node["trade_no"].Str(),
	}
	out.Money = ParseMoney(node["money"].Str())
	return out, nil
}

// Refund fully refunds a paid order for the given amount (api.php?act=refund).
// Returns nil on success. Full-refund only, mirroring the reference service.
func (c *Client) Refund(ctx context.Context, outTradeNo string, money decimal.Decimal) error {
	if !c.cfg.Enabled {
		return ErrDisabled
	}
	node, err := c.gatewayPostForm(ctx, "refund", map[string]string{
		"pid": c.cfg.MerchantID, "key": c.cfg.MD5Key,
		"out_trade_no": outTradeNo, "money": Money(money),
	})
	if err != nil {
		return err
	}
	if node["code"].Int() != 0 { // refund: code 0 = success
		return fmt.Errorf("epay: refund rejected for %s: %s", outTradeNo, node["msg"].Str())
	}
	return nil
}

// ---- gateway HTTP (api.php — authenticated by `key` in plaintext, no sign) ----

func (c *Client) gatewayGet(ctx context.Context, params map[string]string) (jsonObj, error) {
	u := trimSlash(c.cfg.Gateway) + "/api.php?" + encodeQuery(params)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	return c.doJSON(req)
}

func (c *Client) gatewayPostForm(ctx context.Context, act string, form map[string]string) (jsonObj, error) {
	u := trimSlash(c.cfg.Gateway) + "/api.php?act=" + url.QueryEscape(act)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u, strings.NewReader(encodeQuery(form)))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	return c.doJSON(req)
}

func (c *Client) doJSON(req *http.Request) (jsonObj, error) {
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(body, &m); err != nil {
		return nil, fmt.Errorf("epay: decode gateway response: %w", err)
	}
	out := make(jsonObj, len(m))
	for k, v := range m {
		out[k] = jsonVal(v)
	}
	return out, nil
}

// ---- signing (epay MD5) ----

// sign implements the standard epay MD5: non-empty params except sign/sign_type,
// sorted by key ascending, joined k=v&k=v with NO url-encoding, then the key
// appended directly, MD5 → lowercase hex.
func sign(params map[string]string, key string) string {
	keys := make([]string, 0, len(params))
	for k, v := range params {
		if v == "" || k == "sign" || k == "sign_type" {
			continue
		}
		keys = append(keys, k)
	}
	sort.Strings(keys)

	var b strings.Builder
	for i, k := range keys {
		if i > 0 {
			b.WriteByte('&')
		}
		b.WriteString(k)
		b.WriteByte('=')
		b.WriteString(params[k])
	}
	b.WriteString(key)
	sum := md5.Sum([]byte(b.String()))
	return hex.EncodeToString(sum[:])
}

// ---- helpers ----

// Money renders an amount as 元, 2dp, plain string (e.g. "10.00") — epay expects
// 元 not 分.
func Money(d decimal.Decimal) string {
	return d.StringFixed(2)
}

// ParseMoney parses a 元 amount to a 2dp decimal, or nil when blank/invalid.
func ParseMoney(s string) *decimal.Decimal {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	d, err := decimal.NewFromString(s)
	if err != nil {
		return nil
	}
	d = d.Round(2)
	return &d
}

// encodeQuery builds a URL-encoded query string (values encoded; the sign was
// computed over the raw values). Keys are sorted for deterministic output.
func encodeQuery(params map[string]string) string {
	keys := make([]string, 0, len(params))
	for k, v := range params {
		if v == "" {
			continue
		}
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var b strings.Builder
	for i, k := range keys {
		if i > 0 {
			b.WriteByte('&')
		}
		b.WriteString(url.QueryEscape(k))
		b.WriteByte('=')
		b.WriteString(url.QueryEscape(params[k]))
	}
	return b.String()
}

func trimSlash(s string) string {
	return strings.TrimRight(s, "/")
}

// ---- tiny JSON value wrapper (gateway returns mixed string/number fields) ----

type jsonObj map[string]jsonVal
type jsonVal json.RawMessage

// Int coerces the raw JSON value to an int (handles both 1 and "1").
func (v jsonVal) Int() int {
	if len(v) == 0 {
		return 0
	}
	var n int
	if json.Unmarshal(v, &n) == nil {
		return n
	}
	var s string
	if json.Unmarshal(v, &s) == nil {
		var m int
		if _, err := fmt.Sscanf(strings.TrimSpace(s), "%d", &m); err == nil {
			return m
		}
	}
	return 0
}

// Str coerces the raw JSON value to a string (unquotes a JSON string, else the
// raw token).
func (v jsonVal) Str() string {
	if len(v) == 0 {
		return ""
	}
	var s string
	if json.Unmarshal(v, &s) == nil {
		return s
	}
	return strings.TrimSpace(string(v))
}
