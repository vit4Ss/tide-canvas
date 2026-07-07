package epay

import (
	"crypto/md5"
	"encoding/hex"
	"net/url"
	"strings"
	"testing"

	"github.com/shopspring/decimal"
)

// testCfg is an enabled client with fixed credentials for deterministic tests.
func testClient() *Client {
	return New(Config{
		Enabled:    true,
		Gateway:    "https://api.ndow.cn/",
		MerchantID: "1052",
		MD5Key:     "SECRETKEY",
		NotifyURL:  "https://example.com/api/billing/notify",
		ReturnURL:  "https://example.com/billing?pay_status=success",
	}, nil)
}

// TestSignMatchesSpec pins the epay MD5 algorithm: sorted non-empty params
// (minus sign/sign_type), joined k=v&k=v with NO url-encoding, key appended
// directly, MD5 lowercase hex.
func TestSignMatchesSpec(t *testing.T) {
	params := map[string]string{
		"pid":          "1052",
		"type":         "alipay",
		"out_trade_no": "ORD123",
		"money":        "10.00",
		"name":         "pkg",
		"empty":        "", // must be skipped
		"sign":         "IGNORED",
		"sign_type":    "MD5",
	}
	// Expected: keys sorted asc = money,name,out_trade_no,pid,type
	want := "money=10.00&name=pkg&out_trade_no=ORD123&pid=1052&type=alipay" + "SECRETKEY"
	sum := md5.Sum([]byte(want))
	expected := hex.EncodeToString(sum[:])

	got := sign(params, "SECRETKEY")
	if got != expected {
		t.Fatalf("sign mismatch\n got=%s\nwant=%s", got, expected)
	}
}

// TestCheckoutURL verifies the cashier URL carries the signed business params and
// that the embedded sign validates back (round-trip through url decode).
func TestCheckoutURL(t *testing.T) {
	c := testClient()
	u, err := c.CheckoutURL(CheckoutParams{
		Type:       "wxpay",
		OutTradeNo: "ORD-1",
		Name:       "积分包 · 5000 credits",
		Money:      decimal.RequireFromString("45"),
		Param:      "42:ORD-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(u, "https://api.ndow.cn/submit.php?") {
		t.Fatalf("unexpected prefix: %s", u)
	}
	q, err := url.Parse(u)
	if err != nil {
		t.Fatal(err)
	}
	vals := q.Query()
	if vals.Get("money") != "45.00" {
		t.Errorf("money = %q, want 45.00", vals.Get("money"))
	}
	if vals.Get("type") != "wxpay" {
		t.Errorf("type = %q", vals.Get("type"))
	}
	if vals.Get("param") != "42:ORD-1" {
		t.Errorf("param = %q", vals.Get("param"))
	}
	if vals.Get("sign_type") != "MD5" || vals.Get("sign") == "" {
		t.Errorf("missing sign/sign_type")
	}

	// Recompute the sign over the decoded params (values decoded == raw signed).
	recomputed := sign(map[string]string{
		"pid":          vals.Get("pid"),
		"type":         vals.Get("type"),
		"out_trade_no": vals.Get("out_trade_no"),
		"notify_url":   vals.Get("notify_url"),
		"return_url":   vals.Get("return_url"),
		"name":         vals.Get("name"),
		"money":        vals.Get("money"),
		"param":        vals.Get("param"),
	}, "SECRETKEY")
	if recomputed != vals.Get("sign") {
		t.Errorf("sign does not validate: got %s want %s", vals.Get("sign"), recomputed)
	}
}

// TestVerifyNotify checks a well-formed notify passes and tampering fails.
func TestVerifyNotify(t *testing.T) {
	c := testClient()
	raw := map[string]string{
		"pid":          "1052",
		"trade_no":     "TXN-9",
		"out_trade_no": "ORD-1",
		"type":         "alipay",
		"name":         "pkg",
		"money":        "45.00",
		"trade_status": "TRADE_SUCCESS",
		"param":        "42:ORD-1",
	}
	raw["sign"] = sign(raw, "SECRETKEY")
	raw["sign_type"] = "MD5"

	res, err := c.VerifyNotify(raw)
	if err != nil {
		t.Fatalf("valid notify rejected: %v", err)
	}
	if res.OutTradeNo != "ORD-1" || res.TradeNo != "TXN-9" || res.Param != "42:ORD-1" {
		t.Errorf("bad parse: %+v", res)
	}
	if res.Money.Cmp(decimal.RequireFromString("45.00")) != 0 {
		t.Errorf("money = %s", res.Money)
	}

	// Tampered amount → sign no longer matches → rejected.
	tampered := map[string]string{}
	for k, v := range raw {
		tampered[k] = v
	}
	tampered["money"] = "0.01"
	if _, err := c.VerifyNotify(tampered); err == nil {
		t.Error("tampered notify accepted")
	}

	// Non-success status → rejected even with a valid sign.
	pending := map[string]string{
		"pid": "1052", "out_trade_no": "ORD-2", "money": "10.00",
		"trade_status": "WAIT_BUYER_PAY", "param": "1:ORD-2",
	}
	pending["sign"] = sign(pending, "SECRETKEY")
	if _, err := c.VerifyNotify(pending); err == nil {
		t.Error("non-success notify accepted")
	}
}

func TestMoney(t *testing.T) {
	if Money(decimal.RequireFromString("10")) != "10.00" {
		t.Error("Money(10) should be 10.00")
	}
	if got := ParseMoney("45.5"); got == nil || got.String() != "45.5" {
		t.Errorf("ParseMoney(45.5) = %v", got)
	}
	if ParseMoney(" ") != nil {
		t.Error("ParseMoney(blank) should be nil")
	}
}
