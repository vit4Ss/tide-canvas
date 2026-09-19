package bridge

import (
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/url"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// NewHTTPHandler serves a multi-user, stateless Streamable HTTP endpoint. Every
// request authenticates against the main site; no user's key is stored globally
// or accepted via query parameters. The SDK retains localhost Host protection.
func NewHTTPHandler(client *Client, allowedOrigins []string) (http.Handler, error) {
	allowed := map[string]bool{}
	for _, origin := range allowedOrigins {
		origin = strings.TrimSpace(origin)
		if origin == "" {
			continue
		}
		u, err := url.Parse(origin)
		if err != nil || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" || (u.Scheme != "https" && u.Scheme != "http") {
			return nil, errors.New("MCP_ALLOWED_ORIGINS 只接受完整来源（协议和域名，可带端口），不包含路径")
		}
		allowed[origin] = true
	}
	server := NewServer(client)
	transport := mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return server }, &mcp.StreamableHTTPOptions{
		Stateless: true, JSONResponse: true, MaxRequestBodyBytes: 2 << 20,
	})
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		policy, err := client.Policy(r.Context())
		_ = json.NewEncoder(w).Encode(map[string]any{"status": "ok", "service": "flowlight-mcp", "version": serverVersion, "adminConfig": true, "policyRevision": policy.Revision, "policyAvailable": err == nil && policy.SchemaVersion == 1})
	})
	mux.HandleFunc("/mcp", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		parts := strings.Fields(r.Header.Get("Authorization"))
		if r.Method == http.MethodPost && (len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer")) {
			writeHTTPError(w, 401, "需要主站用户的 Authorization: Bearer API_KEY", "")
			return
		}
		policy, err := client.Policy(r.Context())
		if err != nil {
			writeHTTPError(w, 503, err.Error(), "")
			return
		}
		currentAllowed := allowed
		if policy.Configured {
			currentAllowed = map[string]bool{}
			for _, origin := range policy.AllowedOrigins {
				currentAllowed[origin] = true
			}
		}
		origin := r.Header.Get("Origin")
		scheme := "http"
		if r.TLS != nil {
			scheme = "https"
		}
		if origin != "" && !currentAllowed[origin] && origin != scheme+"://"+r.Host {
			writeHTTPError(w, 403, "不允许的请求来源", "")
			return
		}
		if origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
			w.Header().Set("Access-Control-Expose-Headers", "MCP-Protocol-Version, Retry-After")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept, MCP-Protocol-Version, Mcp-Method, Mcp-Name")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", "POST, OPTIONS")
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		if !policy.Enabled {
			writeHTTPError(w, 403, "MCP 接入已被管理员停用", "")
			return
		}
		credentials := Credentials{APIKey: parts[1], ForwardedIP: clientIP(r)}
		ctx := WithCredentials(r.Context(), credentials)
		identity, err := client.Identity(ctx)
		if err != nil {
			status, message, retry := 503, "暂时无法验证主站 API Key", ""
			var apiError *APIError
			if errors.As(err, &apiError) {
				if apiError.Code == 401 || apiError.Code == 403 || apiError.Code == 429 {
					status = apiError.Code
				}
				message, retry = apiError.Error(), apiError.RetryAfter
			}
			writeHTTPError(w, status, message, retry)
			return
		}
		credentials.Identity = identity
		transport.ServeHTTP(w, r.WithContext(WithCredentials(r.Context(), credentials)))
	})
	return mux, nil
}

// Only a loopback reverse proxy may assert the actual caller's IP. Public
// callers cannot forge X-Forwarded-For to bypass the main site's rate limits.
func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return ""
	}
	peer := net.ParseIP(host)
	if peer == nil {
		return ""
	}
	if peer.IsLoopback() {
		if real := net.ParseIP(r.Header.Get("X-Real-IP")); real != nil {
			return real.String()
		}
	}
	return peer.String()
}

func writeHTTPError(w http.ResponseWriter, status int, message, retry string) {
	w.Header().Set("Content-Type", "application/json")
	if status == 401 {
		w.Header().Set("WWW-Authenticate", `Bearer realm="FlowLight MCP"`)
	}
	if retry != "" {
		w.Header().Set("Retry-After", retry)
	}
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]any{"message": message, "code": status}})
}
