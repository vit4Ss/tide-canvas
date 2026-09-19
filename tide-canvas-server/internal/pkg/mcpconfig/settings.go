package mcpconfig

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"
	"time"

	"golang.org/x/net/idna"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"tidecanvas/internal/model"
)

var ErrConflict = errors.New("MCP 配置已被其他管理员修改，请重新加载后保存")

type Settings struct {
	Enabled             bool     `json:"enabled"`
	ImageEnabled        bool     `json:"imageEnabled"`
	VideoEnabled        bool     `json:"videoEnabled"`
	AudioEnabled        bool     `json:"audioEnabled"`
	PublicURL           string   `json:"publicUrl"`
	AllowedOrigins      []string `json:"allowedOrigins"`
	PollIntervalSeconds int      `json:"pollIntervalSeconds"`
}

type Snapshot struct {
	Settings
	SchemaVersion int        `json:"schemaVersion"`
	Revision      uint64     `json:"revision"`
	Configured    bool       `json:"configured"`
	UpdatedAt     *time.Time `json:"updatedAt,omitempty"`
}

func Defaults() Settings {
	return Settings{Enabled: true, ImageEnabled: true, VideoEnabled: true, AudioEnabled: true, AllowedOrigins: []string{}, PollIntervalSeconds: 5}
}

// Addresses are display/configuration values only; request handlers never
// connect to a user-editable public URL to probe the internal service.
func validURL(raw string, origin bool) (*url.URL, error) {
	if len(raw) > 2048 || strings.ContainsAny(raw, "\r\n\t") {
		return nil, errors.New("地址过长或包含非法字符")
	}
	u, err := url.Parse(raw)
	if err != nil || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || (u.Scheme != "http" && u.Scheme != "https") {
		return nil, errors.New("请填写 HTTP/HTTPS 地址，不包含账号、密钥、查询参数或片段")
	}
	if origin && u.Path != "" && u.Path != "/" {
		return nil, errors.New("允许来源只填写协议、域名和端口，不包含路径")
	}
	if origin {
		u.Path = ""
		u.RawPath = ""
	}
	host := strings.ToLower(u.Hostname())
	if strings.Contains(host, "*") {
		return nil, errors.New("地址不支持通配符")
	}
	if net.ParseIP(host) == nil {
		ascii, err := idna.Lookup.ToASCII(host)
		if err != nil || ascii == "" {
			return nil, errors.New("域名格式不正确")
		}
		host = ascii
	}
	port := u.Port()
	if strings.HasSuffix(u.Host, ":") {
		return nil, errors.New("端口不能为空")
	}
	if port != "" {
		n, err := strconv.Atoi(port)
		if err != nil || n < 1 || n > 65535 {
			return nil, errors.New("端口应为 1–65535")
		}
		port = strconv.Itoa(n)
		if (u.Scheme == "http" && port == "80") || (u.Scheme == "https" && port == "443") {
			port = ""
		}
	}
	if port != "" {
		u.Host = net.JoinHostPort(host, port)
	} else if strings.Contains(host, ":") {
		u.Host = "[" + host + "]"
	} else {
		u.Host = host
	}
	return u, nil
}

func Normalize(s Settings) (Settings, error) {
	s.PublicURL = strings.TrimSpace(s.PublicURL)
	if s.PublicURL != "" {
		u, err := validURL(s.PublicURL, false)
		if err != nil {
			return s, fmt.Errorf("对外接入地址：%w", err)
		}
		s.PublicURL = u.String()
	}
	if s.PollIntervalSeconds < 3 || s.PollIntervalSeconds > 60 {
		return s, errors.New("建议轮询间隔应为 3–60 秒")
	}
	if len(s.AllowedOrigins) > 32 {
		return s, errors.New("允许来源最多 32 条")
	}
	origins := []string{}
	seen := map[string]bool{}
	for _, raw := range s.AllowedOrigins {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			continue
		}
		u, err := validURL(raw, true)
		if err != nil {
			return s, fmt.Errorf("允许来源：%w", err)
		}
		value := u.String()
		if !seen[value] {
			seen[value] = true
			origins = append(origins, value)
		}
	}
	s.AllowedOrigins = origins
	payload, err := json.Marshal(s)
	if err != nil || len(payload) > 32<<10 {
		return s, errors.New("MCP 配置过大，请缩短地址或减少允许来源")
	}
	return s, nil
}

func Read(ctx context.Context, db *gorm.DB) (Snapshot, error) {
	result := Snapshot{Settings: Defaults(), SchemaVersion: 1}
	var row model.MCPSettings
	err := db.WithContext(ctx).First(&row, "id = ?", 1).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return result, nil
	}
	if err != nil {
		return result, err
	}
	var flags map[string]json.RawMessage
	if err := json.Unmarshal([]byte(row.Payload), &flags); err != nil || flags == nil {
		return result, errors.New("MCP 配置不是有效对象")
	}
	for _, key := range []string{"enabled", "imageEnabled", "videoEnabled", "audioEnabled"} {
		var value *bool
		if json.Unmarshal(flags[key], &value) != nil || value == nil {
			return result, errors.New("MCP 配置缺少有效开关")
		}
	}
	if err := json.Unmarshal([]byte(row.Payload), &result.Settings); err != nil {
		return result, err
	}
	settings, err := Normalize(result.Settings)
	if err != nil {
		return result, err
	}
	result.Settings = settings
	result.Revision = row.Revision
	result.Configured = true
	result.UpdatedAt = &row.UpdatedAt
	return result, nil
}

func Save(ctx context.Context, db *gorm.DB, settings Settings, revision uint64) (Snapshot, error) {
	settings, err := Normalize(settings)
	if err != nil {
		return Snapshot{}, err
	}
	payload, err := json.Marshal(settings)
	if err != nil {
		return Snapshot{}, err
	}
	now := time.Now()
	if revision == 0 {
		row := model.MCPSettings{ID: 1, Revision: 1, Payload: string(payload), UpdatedAt: now}
		result := db.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(&row)
		if result.Error != nil {
			return Snapshot{}, result.Error
		}
		if result.RowsAffected != 1 {
			return Snapshot{}, ErrConflict
		}
	} else {
		result := db.WithContext(ctx).Model(&model.MCPSettings{}).Where("id = 1 AND revision = ?", revision).
			Updates(map[string]any{"payload": string(payload), "revision": revision + 1, "updated_at": now})
		if result.Error != nil {
			return Snapshot{}, result.Error
		}
		if result.RowsAffected != 1 {
			return Snapshot{}, ErrConflict
		}
	}
	return Snapshot{Settings: settings, SchemaVersion: 1, Revision: revision + 1, Configured: true, UpdatedAt: &now}, nil
}
