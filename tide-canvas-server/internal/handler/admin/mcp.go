package admin

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"tidecanvas/internal/app"
	"tidecanvas/internal/middleware"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/eventlog"
	"tidecanvas/internal/pkg/mcpconfig"
	"tidecanvas/internal/pkg/response"
)

type mcpSaveDTO struct {
	Revision            *uint64  `json:"revision"`
	Enabled             *bool    `json:"enabled"`
	ImageEnabled        *bool    `json:"imageEnabled"`
	VideoEnabled        *bool    `json:"videoEnabled"`
	AudioEnabled        *bool    `json:"audioEnabled"`
	PublicURL           string   `json:"publicUrl"`
	AllowedOrigins      []string `json:"allowedOrigins"`
	PollIntervalSeconds int      `json:"pollIntervalSeconds"`
}

func RegisterMCP(g *gin.RouterGroup, d *app.Deps) {
	// Recheck the current account and module permissions: an old JWT's role
	// and the general admin permission cache cannot authorize this live policy.
	g = g.Group("", func(c *gin.Context) {
		var user model.User
		err := d.DB.WithContext(c.Request.Context()).Select("id", "role", "role_id", "status").First(&user, "id = ?", middleware.CurrentUserID(c)).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			response.Fail(c, 500, "暂时无法校验 MCP 配置权限")
			c.Abort()
			return
		}
		allowed := false
		if err == nil && user.Status == 1 {
			for _, permission := range model.AdminPermsForUser(d.DB.WithContext(c.Request.Context()), &user) {
				if permission == "admin.config" {
					allowed = true
					break
				}
			}
		}
		if !allowed {
			response.Fail(c, 403, "当前账号没有 MCP 配置管理权限")
			c.Abort()
			return
		}
		c.Next()
	})
	g.GET("/mcp", func(c *gin.Context) {
		c.Header("Cache-Control", "no-store")
		settings, err := mcpconfig.Read(c.Request.Context(), d.DB)
		if err != nil {
			response.Fail(c, 500, "无法读取 MCP 配置")
			return
		}
		response.OK(c, settings)
	})
	g.PUT("/mcp", func(c *gin.Context) {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 32<<10)
		var dto mcpSaveDTO
		decoder := json.NewDecoder(c.Request.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&dto); err != nil {
			response.Fail(c, 400, "MCP 配置格式不正确")
			return
		}
		if decoder.Decode(new(any)) != io.EOF || dto.Revision == nil || dto.Enabled == nil || dto.ImageEnabled == nil || dto.VideoEnabled == nil || dto.AudioEnabled == nil || *dto.Revision > 1<<53-2 {
			response.Fail(c, 400, "请提交完整配置和当前版本号")
			return
		}
		settings, err := mcpconfig.Normalize(mcpconfig.Settings{Enabled: *dto.Enabled, ImageEnabled: *dto.ImageEnabled, VideoEnabled: *dto.VideoEnabled, AudioEnabled: *dto.AudioEnabled, PublicURL: dto.PublicURL, AllowedOrigins: dto.AllowedOrigins, PollIntervalSeconds: dto.PollIntervalSeconds})
		if err != nil {
			response.Fail(c, 400, err.Error())
			return
		}
		result, err := mcpconfig.Save(c.Request.Context(), d.DB, settings, *dto.Revision)
		if errors.Is(err, mcpconfig.ErrConflict) {
			response.Fail(c, 409, err.Error())
			return
		}
		if err != nil {
			response.Fail(c, 500, "MCP 配置保存失败")
			return
		}
		eventlog.Biz(&model.BizLog{UserID: middleware.CurrentUserID(c), Action: "mcp.configure", Summary: "更新 MCP 接入与生成能力配置"})
		response.OK(c, result)
	})
	g.GET("/mcp/status", middleware.RateLimit(d, 30, time.Minute), func(c *gin.Context) {
		c.Header("Cache-Control", "no-store")
		target := "http://127.0.0.1:8082"
		if d.Cfg != nil && strings.TrimSpace(d.Cfg.MCP.InternalURL) != "" {
			target = strings.TrimSpace(d.Cfg.MCP.InternalURL)
		}
		response.OK(c, probeMCP(c.Request.Context(), target))
	})
}

type mcpStatus struct {
	Reachable       bool      `json:"reachable"`
	CheckedAt       time.Time `json:"checkedAt"`
	LatencyMS       int64     `json:"latencyMs"`
	Message         string    `json:"message"`
	Version         string    `json:"version,omitempty"`
	AdminConfig     bool      `json:"adminConfig"`
	PolicyRevision  uint64    `json:"policyRevision"`
	PolicyAvailable bool      `json:"policyAvailable"`
	InternalURL     string    `json:"internalUrl"`
}

func probeMCP(ctx context.Context, target string) (result mcpStatus) {
	started := time.Now()
	result.CheckedAt = started
	defer func() { result.LatencyMS = time.Since(started).Milliseconds() }()
	u, err := url.Parse(target)
	if err != nil || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || (u.Path != "" && u.Path != "/") || (u.Scheme != "http" && u.Scheme != "https") {
		result.Message = "部署环境的 MCP 内部检测地址不正确"
		return
	}
	result.InternalURL = u.String()
	u.Path = "/healthz"
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		result.Message = "无法创建检测请求"
		return
	}
	client := &http.Client{Timeout: 7 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, err := client.Do(request)
	if err != nil {
		result.Message = "MCP 服务未启动或暂时不可达"
		return
	}
	defer res.Body.Close()
	data, err := io.ReadAll(io.LimitReader(res.Body, 16<<10+1))
	var health struct {
		Status          string `json:"status"`
		Service         string `json:"service"`
		Version         string `json:"version"`
		AdminConfig     bool   `json:"adminConfig"`
		PolicyRevision  uint64 `json:"policyRevision"`
		PolicyAvailable bool   `json:"policyAvailable"`
	}
	if err != nil || len(data) > 16<<10 || res.StatusCode != 200 || json.Unmarshal(data, &health) != nil || health.Status != "ok" || health.Service != "flowlight-mcp" {
		result.Message = "目标地址没有返回有效的 FlowLight MCP 状态"
		return
	}
	result.Reachable = true
	result.Version = health.Version
	result.AdminConfig = health.AdminConfig
	result.PolicyRevision = health.PolicyRevision
	result.PolicyAvailable = health.PolicyAvailable
	switch {
	case !health.AdminConfig:
		result.Message = "服务在线，但需升级 MCP 服务才能读取后台配置"
	case !health.PolicyAvailable:
		result.Message = "服务在线，尚未读取到主站配置，请检查 FLOWLIGHT_BASE_URL 与主站版本"
	default:
		result.Message = "服务在线，已读取主站配置"
	}
	return
}
