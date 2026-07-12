package admin

// g3_model_status.go — 后台「模型状态」页的聚合接口。数据源是统一模型调用
// 日志 model_call_log（文本 chat/optimize/blog-polish + 媒体 image/video 的
// 真实用户调用，internal/pkg/eventlog 落库）：不再主动探测（用户定稿
// 2026-07-13，internal/prober 已整链下线——text 探测消耗上游额度，媒体目录
// 探测反映不了真实生成链路）。本文件只读聚合，不发任何上游请求。

import (
	"encoding/json"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/response"
)

// AdminModelCallVO is one real user call in the status view.
type AdminModelCallVO struct {
	OK      bool   `json:"ok"`
	TotalMs int64  `json:"totalMs"`
	Scene   string `json:"scene"` // chat|optimize|blog-polish|image|video…
	Error   string `json:"error"`
	Time    string `json:"time"`
}

// AdminModelStatusVO is one model card on the 模型状态 page.
type AdminModelStatusVO struct {
	ID       idgen.ID `json:"id"`
	Name     string   `json:"name"`
	Type     string   `json:"type"`
	ModelKey string   `json:"modelKey"`
	Icon     string   `json:"icon"` // config.icon（可空，前端回退品牌图标）
	Enabled  bool     `json:"enabled"`
	Current  *AdminModelCallVO `json:"current"` // 最近一次真实调用；nil = 暂无调用
	// Avail24h / Avail7d 为成功率百分比（0–100）；nil = 窗口内无调用。
	Avail24h *float64 `json:"avail24h"`
	Avail7d  *float64 `json:"avail7d"`
	// Calls24h / Calls7d 为窗口内的真实调用次数。
	Calls24h int64 `json:"calls24h"`
	Calls7d  int64 `json:"calls7d"`
	// Recent are the latest calls oldest→newest（≤60，驱动状态条）。
	Recent []AdminModelCallVO `json:"recent"`
}

// callAgg is one GROUP BY row of the success-rate windows.
type callAgg struct {
	Model string
	Total int64
	Okays int64
}

// modelStatus handles GET /admin/models/status?scope=enabled|all.
// scope=enabled（默认）只出已上架模型；scope=all 额外带上已下架但 7 天内仍有
// 真实调用记录的模型。
func (h *modelsHandler) modelStatus(c *gin.Context) {
	scope := strings.TrimSpace(c.Query("scope"))
	if scope != "all" {
		scope = "enabled"
	}

	var models []model.MarketModel
	if err := h.db.Where("model_key <> ''").Find(&models).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to load models")
		return
	}

	now := time.Now()
	agg24 := h.callWindow(now.Add(-24 * time.Hour))
	agg7d := h.callWindow(now.Add(-7 * 24 * time.Hour))

	vos := make([]AdminModelStatusVO, 0, len(models))
	for i := range models {
		m := &models[i]
		enabled := m.Status == 1
		_, hasHistory := agg7d[m.ModelKey]
		if !enabled && (scope == "enabled" || !hasHistory) {
			continue
		}

		vo := AdminModelStatusVO{
			ID:       m.ID,
			Name:     m.Name,
			Type:     m.Type,
			ModelKey: m.ModelKey,
			Icon:     configIcon(m.Config),
			Enabled:  enabled,
			Avail24h: callPct(agg24[m.ModelKey]),
			Avail7d:  callPct(agg7d[m.ModelKey]),
			Recent:   []AdminModelCallVO{},
		}
		if a := agg24[m.ModelKey]; a != nil {
			vo.Calls24h = a.Total
		}
		if a := agg7d[m.ModelKey]; a != nil {
			vo.Calls7d = a.Total
		}

		var rows []model.ModelCallLog
		if err := h.db.Select("success, duration_ms, scene, error_msg, create_time").
			Where("model = ?", m.ModelKey).
			Order("create_time DESC").Limit(60).Find(&rows).Error; err == nil && len(rows) > 0 {
			cur := toCallVO(&rows[0])
			vo.Current = &cur
			// 倒序取回，正序展示（旧→新）。
			for j := len(rows) - 1; j >= 0; j-- {
				vo.Recent = append(vo.Recent, toCallVO(&rows[j]))
			}
		}
		vos = append(vos, vo)
	}
	response.OK(c, vos)
}

// callWindow aggregates ok/total per model key since the cut-off.
func (h *modelsHandler) callWindow(since time.Time) map[string]*callAgg {
	var rows []callAgg
	out := map[string]*callAgg{}
	if err := h.db.Model(&model.ModelCallLog{}).
		Select("model, COUNT(*) AS total, SUM(success) AS okays").
		Where("create_time > ? AND model <> ''", since).
		Group("model").Scan(&rows).Error; err != nil {
		return out
	}
	for i := range rows {
		out[rows[i].Model] = &rows[i]
	}
	return out
}

// callPct converts an aggregate to a 0–100 percentage (nil when no calls).
func callPct(a *callAgg) *float64 {
	if a == nil || a.Total == 0 {
		return nil
	}
	pct := float64(a.Okays) / float64(a.Total) * 100
	return &pct
}

func toCallVO(l *model.ModelCallLog) AdminModelCallVO {
	return AdminModelCallVO{
		OK:      l.Success == 1,
		TotalMs: l.DurationMs,
		Scene:   l.Scene,
		Error:   l.ErrorMsg,
		Time:    g3FmtTime(l.CreateTime),
	}
}

// configIcon extracts just the icon field from the stored config object.
func configIcon(cfg string) string {
	cfg = strings.TrimSpace(cfg)
	if cfg == "" {
		return ""
	}
	var v struct {
		Icon string `json:"icon"`
	}
	_ = json.Unmarshal([]byte(cfg), &v)
	return v.Icon
}
