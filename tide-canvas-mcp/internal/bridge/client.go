package bridge

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

const maxResponseBytes = 8 << 20

type credentialsKey struct{}
type Credentials struct {
	APIKey      string
	ForwardedIP string
	Identity    *Identity
}
type Identity struct {
	UserID string `json:"userId"`
	Points int64  `json:"points"`
}

func WithCredentials(ctx context.Context, credentials Credentials) context.Context {
	return context.WithValue(ctx, credentialsKey{}, credentials)
}

type Client struct {
	base          string
	http          *http.Client
	policyMu      sync.Mutex
	policy        Policy
	policyExpires time.Time
	policyErr     error
	policyFlight  *policyFlight
}

func NewClient(base string) (*Client, error) {
	u, err := url.Parse(strings.TrimSpace(base))
	if err != nil || u.Hostname() == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" {
		return nil, errors.New("FLOWLIGHT_BASE_URL 必须是主站的 HTTP/HTTPS 地址，不包含凭据、查询参数或片段")
	}
	if strings.TrimRight(u.Path, "/") == "/api" || strings.Contains(u.Path, "/api/") {
		return nil, errors.New("FLOWLIGHT_BASE_URL 请填写主站地址，不要包含 /api/open/v1 等接口路径")
	}
	return &Client{base: strings.TrimRight(u.String(), "/"), http: &http.Client{
		Timeout: 30 * time.Second,
		// Never forward a user's key through a server redirect.
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}}, nil
}

type APIError struct {
	Code       int
	Message    string
	RetryAfter string
}

func (e *APIError) Error() string {
	return fmt.Sprintf("主站请求失败（%d）：%s", e.Code, e.Message)
}

func safeMessage(message, secret string) string {
	message = strings.ReplaceAll(message, secret, "[已隐藏密钥]")
	runes := []rune(message)
	if len(runes) > 1000 {
		message = string(runes[:1000]) + "…"
	}
	return message
}

func (c *Client) request(ctx context.Context, method, path string, body any, envelope bool, out any) (requestErr error) {
	// A timeout, truncated response or server error can happen after a paid
	// task was committed. Always preserve the user's original idempotency key.
	defer func() {
		var apiErr *APIError
		if method == http.MethodPost && path == "/api/open/v1/generations" && errors.As(requestErr, &apiErr) && apiErr.Code >= 500 && apiErr.Code < 600 {
			apiErr.Message += "；提交结果未确认，请沿用原 clientRequestId 和原参数重试，不要换新编号"
		}
	}()
	credentials, _ := ctx.Value(credentialsKey{}).(Credentials)
	if strings.TrimSpace(credentials.APIKey) == "" {
		return &APIError{Code: 401, Message: "请配置主站用户 API Key"}
	}
	var reader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return errors.New("生成参数无法序列化")
		}
		if len(data) > 2<<20 {
			return errors.New("生成参数超过 2 MiB，请先通过主站上传素材，再传入 URL")
		}
		reader = bytes.NewReader(data)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base+path, reader)
	if err != nil {
		return errors.New("无法创建主站请求")
	}
	req.Header.Set("Authorization", "Bearer "+credentials.APIKey)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if credentials.ForwardedIP != "" {
		req.Header.Set("X-Real-IP", credentials.ForwardedIP)
		req.Header.Set("X-Forwarded-For", credentials.ForwardedIP)
	}
	res, err := c.http.Do(req)
	if err != nil {
		return &APIError{Code: 503, Message: "无法连接主站或请求超时"}
	}
	defer res.Body.Close()
	data, err := io.ReadAll(io.LimitReader(res.Body, maxResponseBytes+1))
	if err != nil || len(data) > maxResponseBytes {
		code := 502
		if res.StatusCode >= 400 {
			code = res.StatusCode
		}
		return &APIError{Code: code, Message: "主站响应读取失败或过大", RetryAfter: res.Header.Get("Retry-After")}
	}
	var response struct {
		Success bool            `json:"success"`
		Code    int             `json:"code"`
		Message string          `json:"message"`
		Data    json.RawMessage `json:"data"`
		Error   struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(data, &response); err != nil {
		if res.StatusCode >= 400 {
			return &APIError{Code: res.StatusCode, Message: "主站返回 HTTP " + fmt.Sprint(res.StatusCode) + "，请按状态检查鉴权、限流或服务状态", RetryAfter: res.Header.Get("Retry-After")}
		}
		return &APIError{Code: 502, Message: "主站未返回有效 JSON，请检查地址和部署版本"}
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 || (envelope && !response.Success) {
		code, message := response.Code, response.Message
		if code == 0 {
			code = res.StatusCode
			if code < 400 {
				code = 502
			}
		}
		if message == "" {
			message = response.Error.Message
		}
		if message == "" {
			message = "服务暂时不可用，请稍后重试"
		}
		return &APIError{Code: code, Message: safeMessage(message, credentials.APIKey), RetryAfter: res.Header.Get("Retry-After")}
	}
	if envelope {
		data = response.Data
		if len(data) == 0 || bytes.Equal(bytes.TrimSpace(data), []byte("null")) {
			return &APIError{Code: 502, Message: "主站响应缺少有效 data，请检查部署版本"}
		}
	}
	if out != nil {
		if err := json.Unmarshal(data, out); err != nil {
			return &APIError{Code: 502, Message: "主站响应格式不兼容，请更新主站服务"}
		}
	}
	return nil
}

func (c *Client) Identity(ctx context.Context) (*Identity, error) {
	var result Identity
	if err := c.request(ctx, http.MethodGet, "/api/integrations/identity", nil, false, &result); err != nil {
		return nil, err
	}
	if result.UserID == "" {
		return nil, &APIError{Code: 502, Message: "主站未返回用户身份"}
	}
	return &result, nil
}

func (c *Client) get(ctx context.Context, path string, out any) error {
	return c.request(ctx, http.MethodGet, "/api/open/v1"+path, nil, true, out)
}

type Task struct {
	ID           string `json:"id"`
	Handler      string `json:"handler"`
	ModelID      string `json:"modelId"`
	ModelName    string `json:"modelName"`
	Status       int    `json:"status"`
	Progress     int    `json:"progress"`
	PointCost    int64  `json:"pointCost"`
	IsAPICall    bool   `json:"isApiCall"`
	ResultURL    string `json:"resultUrl"`
	ResultMeta   any    `json:"resultMeta"`
	ErrorMsg     string `json:"errorMsg"`
	Input        any    `json:"input"`
	CreateTime   string `json:"createTime"`
	CompleteTime string `json:"completeTime"`
}

type Model struct {
	ID                string   `json:"id"`
	ModelID           string   `json:"modelId"`
	Name              string   `json:"name"`
	Type              string   `json:"type"`
	SupportedHandlers []string `json:"supportedHandlers"`
	Config            string   `json:"config"`
	PointCost         int64    `json:"pointCost"`
}
