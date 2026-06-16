package recharge

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/shopspring/decimal"
	"github.com/tidwall/gjson"

	"github.com/tidecanvas/tide-canvas-go/pkg/ecode"
)

// ===== 易支付 V2 协议（SHA256withRSA）签名工具，对齐 EpaySignUtil =====
//
// 签名规则：剔除 sign/sign_type 与空值参数，按参数名 ASCII 升序拼接为 a=1&b=2（值不做 URL 编码），
// 用商户私钥做 SHA256withRSA 签名后 Base64；验签使用平台公钥。
// 密钥兼容带/不带 PEM 头尾；私钥兼容 PKCS#8 与 PKCS#1，公钥兼容 X.509(SubjectPublicKeyInfo) 与裸 PKCS#1。

// pemHeaderRe 匹配 PEM 头尾（-----BEGIN/END xxx-----），用于剥离得到纯 Base64（对齐 stripPem）。
var pemHeaderRe = regexp.MustCompile(`-----[^-]+-----`)

// buildSignContent 构建待签名字符串：剔除 sign/sign_type 与空值，ASCII 排序后以 & 连接（对齐 EpaySignUtil.buildSignContent）。
func buildSignContent(params map[string]string) string {
	keys := make([]string, 0, len(params))
	for k, v := range params {
		if k == "" || v == "" || k == "sign" || k == "sign_type" {
			continue
		}
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		parts = append(parts, k+"="+params[k])
	}
	return strings.Join(parts, "&")
}

// signRSA 商户私钥签名，返回 Base64 结果（对齐 EpaySignUtil.sign）。
func signRSA(content, merchantPrivateKey string) (string, error) {
	priv, err := parsePrivateKey(merchantPrivateKey)
	if err != nil {
		return "", fmt.Errorf("RSA签名失败,请检查商户私钥配置: %w", err)
	}
	hashed := sha256.Sum256([]byte(content))
	sig, err := rsa.SignPKCS1v15(rand.Reader, priv, crypto.SHA256, hashed[:])
	if err != nil {
		return "", fmt.Errorf("RSA签名失败,请检查商户私钥配置: %w", err)
	}
	return base64.StdEncoding.EncodeToString(sig), nil
}

// verifyRSA 平台公钥验签；参数异常或签名不符均返回 false（对齐 EpaySignUtil.verify）。
func verifyRSA(content, sign, platformPublicKey string) bool {
	if content == "" || sign == "" {
		return false
	}
	pub, err := parsePublicKey(platformPublicKey)
	if err != nil {
		return false
	}
	sig, err := base64.StdEncoding.DecodeString(sign)
	if err != nil {
		return false
	}
	hashed := sha256.Sum256([]byte(content))
	return rsa.VerifyPKCS1v15(pub, crypto.SHA256, hashed[:], sig) == nil
}

// parsePrivateKey 解析商户私钥，兼容 PKCS#8 与 PKCS#1（对齐 parsePrivateKey）。
func parsePrivateKey(raw string) (*rsa.PrivateKey, error) {
	der, err := base64.StdEncoding.DecodeString(stripPem(raw))
	if err != nil {
		return nil, err
	}
	// 优先 PKCS#8（BEGIN PRIVATE KEY）。
	if key, err := x509.ParsePKCS8PrivateKey(der); err == nil {
		rsaKey, ok := key.(*rsa.PrivateKey)
		if !ok {
			return nil, errors.New("非 RSA 私钥")
		}
		return rsaKey, nil
	}
	// 回退 PKCS#1（BEGIN RSA PRIVATE KEY）。
	return x509.ParsePKCS1PrivateKey(der)
}

// parsePublicKey 解析平台公钥，兼容 X.509(SubjectPublicKeyInfo) 与裸 PKCS#1 RSAPublicKey（对齐 parsePublicKey）。
func parsePublicKey(raw string) (*rsa.PublicKey, error) {
	der, err := base64.StdEncoding.DecodeString(stripPem(raw))
	if err != nil {
		return nil, err
	}
	// 优先 X.509 SubjectPublicKeyInfo（BEGIN PUBLIC KEY）。
	if key, err := x509.ParsePKIXPublicKey(der); err == nil {
		rsaKey, ok := key.(*rsa.PublicKey)
		if !ok {
			return nil, errors.New("非 RSA 公钥")
		}
		return rsaKey, nil
	}
	// 回退裸 PKCS#1 RSAPublicKey（BEGIN RSA PUBLIC KEY）。
	return x509.ParsePKCS1PublicKey(der)
}

// stripPem 去除 PEM 头尾与所有空白，得到纯 Base64（对齐 stripPem）。
func stripPem(raw string) string {
	noHeader := pemHeaderRe.ReplaceAllString(raw, "")
	return strings.Join(strings.Fields(noHeader), "")
}

// ===== 易支付配置（来自 sys_config 表 pay.epay.* 配置项），对齐 EpayConfig =====

// epayConfig 易支付网关配置。
type epayConfig struct {
	Enabled            bool
	Gateway            string
	PID                string
	MerchantPrivateKey string
	PlatformPublicKey  string
	NotifyURL          string
	ReturnURL          string
	PayTypes           []string
}

// isComplete 发起支付所需的配置是否齐全（对齐 EpayConfig.isComplete）。
func (c *epayConfig) isComplete() bool {
	return c.Gateway != "" && c.PID != "" && c.MerchantPrivateKey != "" &&
		c.PlatformPublicKey != "" && c.NotifyURL != ""
}

// ===== 易支付 V2 网关客户端，对齐 EpayClient =====
//
// 协议：application/x-www-form-urlencoded 提交，JSON 返回，SHA256withRSA 签名；
// 响应若携带 sign 则必须用平台公钥验签通过，防止伪造查单结果导致错误上分。

const (
	epaySubmitPath  = "/api/pay/submit"
	epayQueryPath   = "/api/pay/query"
	epaySignTypeRSA = "RSA"
)

// epayHTTPClient 网关 HTTP 客户端（连接 10s / 读取 15s，对齐 EpayClient.init 的超时设置）。
var epayHTTPClient = &http.Client{Timeout: 15 * time.Second}

// epayOrderStatus 查单结果：code=0 时 status 有效（对齐 EpayClient.EpayOrderStatus）。
type epayOrderStatus struct {
	Code    int
	Msg     string
	Status  int
	TradeNo string
}

// isPaid 网关侧已支付（status==1，对齐 EpayOrderStatus.isPaid）。
func (s epayOrderStatus) isPaid() bool { return s.Code == 0 && s.Status == 1 }

// submitURL 页面跳转支付的提交地址（对齐 EpayClient.submitUrl）。
func epaySubmitURL(cfg *epayConfig) string {
	return trimTrailingSlash(cfg.Gateway) + epaySubmitPath
}

// buildSubmitParams 构建页面跳转支付参数（含签名）。payType 为空时不传 type，由网关收银台让用户选择
// （对齐 EpayClient.buildSubmitParams）。amount 保留 2 位小数（HALF_UP）。
func buildSubmitParams(cfg *epayConfig, outTradeNo string, amount decimal.Decimal, productName, payType string) (map[string]string, error) {
	params := map[string]string{
		"pid":          cfg.PID,
		"out_trade_no": outTradeNo,
		"notify_url":   cfg.NotifyURL,
		"name":         productName,
		"money":        amount.Round(2).StringFixed(2),
		"timestamp":    currentTimestamp(),
	}
	if strings.TrimSpace(payType) != "" {
		params["type"] = payType
	}
	if strings.TrimSpace(cfg.ReturnURL) != "" {
		params["return_url"] = cfg.ReturnURL
	}
	sign, err := signRSA(buildSignContent(params), cfg.MerchantPrivateKey)
	if err != nil {
		return nil, err
	}
	params["sign"] = sign
	params["sign_type"] = epaySignTypeRSA
	return params, nil
}

// queryOrder 订单查询。网关订单状态：0未支付 1已支付 2已退款 3已冻结 4预授权（对齐 EpayClient.queryOrder）。
// 网关请求/解析失败返回 ecode.PaymentGatewayError。
func queryOrder(cfg *epayConfig, outTradeNo string) (epayOrderStatus, error) {
	params := map[string]string{
		"pid":          cfg.PID,
		"out_trade_no": outTradeNo,
		"timestamp":    currentTimestamp(),
	}
	sign, err := signRSA(buildSignContent(params), cfg.MerchantPrivateKey)
	if err != nil {
		return epayOrderStatus{}, err
	}
	params["sign"] = sign
	params["sign_type"] = epaySignTypeRSA

	body, err := postForm(trimTrailingSlash(cfg.Gateway)+epayQueryPath, params)
	if err != nil {
		return epayOrderStatus{}, err
	}

	if !gjson.Valid(body) {
		return epayOrderStatus{}, ecode.PaymentGatewayError
	}
	root := gjson.Parse(body)
	codeNode := root.Get("code")
	code := -1 // 缺省 -1，对齐旧 node.path("code").asInt(-1)。
	if codeNode.Exists() {
		code = int(codeNode.Int())
	}
	if code != 0 {
		return epayOrderStatus{Code: code, Msg: root.Get("msg").String(), Status: -1}, nil
	}
	if err := verifyResponseSign(root, cfg); err != nil {
		return epayOrderStatus{}, err
	}
	return epayOrderStatus{
		Code:    0,
		Status:  int(root.Get("status").Int()),
		TradeNo: root.Get("trade_no").String(),
	}, nil
}

// verifyResponseSign 响应验签：取所有标量字段（剔除 sign/sign_type）拼接验签；无 sign 字段时跳过（走 HTTPS 直连）
// （对齐 EpayClient.verifyResponseSign）。无 sign 仅信任 TLS；有 sign 验签失败返回 ecode.PaymentGatewayError。
func verifyResponseSign(root gjson.Result, cfg *epayConfig) error {
	sign := root.Get("sign").String()
	if strings.TrimSpace(sign) == "" {
		// 无签名：信任 HTTPS 直连（对齐旧实现仅告警放行）。
		return nil
	}
	resp := make(map[string]string)
	root.ForEach(func(key, value gjson.Result) bool {
		// NullNode/对象/数组不参与签名；仅取标量字段（对齐 isValueNode && !isNull）。
		switch value.Type {
		case gjson.String, gjson.Number, gjson.True, gjson.False:
			resp[key.String()] = value.String()
		}
		return true
	})
	if !verifyRSA(buildSignContent(resp), sign, cfg.PlatformPublicKey) {
		return ecode.PaymentGatewayError
	}
	return nil
}

// postForm 以 application/x-www-form-urlencoded 提交并返回响应体（对齐 RestClient form POST）。
func postForm(endpoint string, params map[string]string) (string, error) {
	form := url.Values{}
	for k, v := range params {
		form.Set(k, v)
	}
	resp, err := epayHTTPClient.Post(endpoint, "application/x-www-form-urlencoded", strings.NewReader(form.Encode()))
	if err != nil {
		return "", ecode.PaymentGatewayError
	}
	defer resp.Body.Close()
	buf := new(strings.Builder)
	if _, err := io.Copy(buf, resp.Body); err != nil {
		return "", ecode.PaymentGatewayError
	}
	return buf.String(), nil
}

// currentTimestamp 当前 Unix 秒（对齐 EpayClient.currentTimestamp）。
func currentTimestamp() string { return strconv.FormatInt(time.Now().Unix(), 10) }

// trimTrailingSlash 去除末尾斜杠（对齐 EpayClient.trimTrailingSlash）。
func trimTrailingSlash(s string) string {
	return strings.TrimSuffix(s, "/")
}
