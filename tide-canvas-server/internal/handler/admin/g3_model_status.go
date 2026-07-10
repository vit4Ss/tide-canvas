package admin

// g3_model_status.go — 后台「模型状态」页的聚合接口。数据源是 internal/prober
// 定时写入的 model_probe 表：text 模型为真实流式补全探测（首字/完成时延），
// 其余媒体类型为上游目录可达性探测。本文件只读聚合，不发探测请求。

import (
	"encoding/json"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/response"
)

// AdminModelProbeVO is one probe sample in the status view.
type AdminModelProbeVO struct {
	OK      bool   `json:"ok"`
	TotalMs int64  `json:"totalMs"`
	FirstMs int64  `json:"firstMs"`
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
	// Kind: chat（流式补全探测，展示首字/完成时延）/ catalog（目录可达探测）。
	Kind    string             `json:"kind"`
	Current *AdminModelProbeVO `json:"current"` // 最近一次探测；nil = 尚无数据
	// Avail24h / Avail7d 为可用率百分比（0–100）；nil = 窗口内无样本。
	Avail24h *float64 `json:"avail24h"`
	Avail7d  *float64 `json:"avail7d"`
	// Recent are the latest samples oldest→newest（≤60，驱动检测条）。
	Recent      []AdminModelProbeVO `json:"recent"`
	IntervalSec int                 `json:"intervalSec"`
	NextInSec   int                 `json:"nextInSec"`
}

// probeAgg is one GROUP BY row of the availability windows.
type probeAgg struct {
	ModelID idgen.ID
	Total   int64
	Okays   int64
}

// modelStatus handles GET /admin/models/status?scope=enabled|all.
// scope=enabled（默认）只出已上架模型；scope=all 额外带上已下架但仍有探测
// 历史的模型（历史按保留期滚动，约 8 天）。
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
	agg24 := h.probeWindow(now.Add(-24 * time.Hour))
	agg7d := h.probeWindow(now.Add(-7 * 24 * time.Hour))

	interval := model.ProbeIntervalSec(h.db)

	vos := make([]AdminModelStatusVO, 0, len(models))
	for i := range models {
		m := &models[i]
		enabled := m.Status == 1
		_, hasHistory := agg7d[m.ID]
		if !enabled && (scope == "enabled" || !hasHistory) {
			continue
		}

		kind := "catalog"
		if m.Type == "text" {
			kind = "chat"
		}
		vo := AdminModelStatusVO{
			ID:          m.ID,
			Name:        m.Name,
			Type:        m.Type,
			ModelKey:    m.ModelKey,
			Icon:        configIcon(m.Config),
			Enabled:     enabled,
			Kind:        kind,
			Avail24h:    availPct(agg24[m.ID]),
			Avail7d:     availPct(agg7d[m.ID]),
			Recent:      []AdminModelProbeVO{},
			IntervalSec: interval,
		}

		var rows []model.ModelProbe
		if err := h.db.Where("model_id = ?", m.ID).
			Order("create_time DESC").Limit(60).Find(&rows).Error; err == nil && len(rows) > 0 {
			latest := rows[0]
			cur := toProbeVO(&latest)
			vo.Current = &cur
			// 下次检测倒计时按探测器节奏推算（interval=0 时探测已停用）。
			if interval > 0 {
				next := interval - int(now.Sub(latest.CreateTime).Seconds())
				if next < 0 {
					next = 0
				}
				if next > interval {
					next = interval
				}
				vo.NextInSec = next
			}
			// 倒序取回，正序展示（旧→新）。
			for j := len(rows) - 1; j >= 0; j-- {
				vo.Recent = append(vo.Recent, toProbeVO(&rows[j]))
			}
		}
		vos = append(vos, vo)
	}
	response.OK(c, vos)
}

// probeWindow aggregates ok/total per model since the cut-off.
func (h *modelsHandler) probeWindow(since time.Time) map[idgen.ID]*probeAgg {
	var rows []probeAgg
	out := map[idgen.ID]*probeAgg{}
	if err := h.db.Model(&model.ModelProbe{}).
		Select("model_id, COUNT(*) AS total, SUM(ok) AS okays").
		Where("create_time > ?", since).
		Group("model_id").Scan(&rows).Error; err != nil {
		return out
	}
	for i := range rows {
		out[rows[i].ModelID] = &rows[i]
	}
	return out
}

// availPct converts an aggregate to a 0–100 percentage (nil when no samples).
func availPct(a *probeAgg) *float64 {
	if a == nil || a.Total == 0 {
		return nil
	}
	pct := float64(a.Okays) / float64(a.Total) * 100
	return &pct
}

func toProbeVO(p *model.ModelProbe) AdminModelProbeVO {
	return AdminModelProbeVO{
		OK:      p.OK,
		TotalMs: p.TotalMs,
		FirstMs: p.FirstMs,
		Error:   p.ErrorMsg,
		Time:    g3FmtTime(p.CreateTime),
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
