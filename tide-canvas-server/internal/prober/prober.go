// Package prober runs the model-availability probe loop behind the admin
// 「模型状态」page. Every cycle it probes each LISTED (status=1) market model
// with a non-empty model key:
//
//   - text models   → a real streaming chat completion（1 条 "ping" 消息），
//     记录首字时延（FirstMs）与完成时延（TotalMs）——真实链路探活。
//   - image/video/audio → 上游目录可达性（GET /v1/models 一次/周期，检查
//     model_key 是否仍在目录中）——生成类探测一次就是一次真实扣费，
//     不能拿来做周期探活，目录在即视为调度健康。
//
// Samples land in model_probe; rows older than the retention window are pruned
// each cycle. The interval lives in sys_config (model.ConfigKeyProbeInterval,
// seconds; 0 = disabled) and is re-read every cycle so admin edits apply
// without a restart.
package prober

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"time"

	"go.uber.org/zap"
	"gorm.io/gorm"

	"tidecanvas/internal/app"
	"tidecanvas/internal/handler/admin"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/logger"
	"tidecanvas/internal/pkg/relaychat"
)

const (
	// probeTimeout bounds one text-model probe.
	probeTimeout = 60 * time.Second
	// retention keeps enough history for the 7-day availability window.
	retention = 8 * 24 * time.Hour
)

// Run blocks probing until ctx is cancelled. Call in a goroutine from main.
func Run(ctx context.Context, d *app.Deps) {
	if strings.TrimSpace(d.Cfg.Relay.APIKey) == "" {
		logger.L().Info("prober: relay not configured, model probing disabled")
		return
	}
	chat := relaychat.New(d.Cfg.Relay.BaseURL, d.Cfg.Relay.APIKey)
	ensureIntervalConfig(d.DB)

	for {
		sec := model.ProbeIntervalSec(d.DB)
		if sec <= 0 {
			// 0 = 管理员停用；每分钟复查配置，改回后自动恢复。
			if !sleep(ctx, time.Minute) {
				return
			}
			continue
		}
		probeOnce(ctx, d, chat)
		prune(d.DB)
		if !sleep(ctx, time.Duration(sec)*time.Second) {
			return
		}
	}
}

// probeOnce probes every listed model once and records the samples.
func probeOnce(ctx context.Context, d *app.Deps, chat *relaychat.Client) {
	var models []model.MarketModel
	if err := d.DB.Where("status = 1 AND model_key <> ''").Find(&models).Error; err != nil {
		logger.L().Warn("prober: load models failed", zap.Error(err))
		return
	}
	if len(models) == 0 {
		return
	}

	// 目录探测一次覆盖所有媒体模型（每周期一个 GET，成本恒定）。
	catStart := time.Now()
	catalog, catErr := admin.FetchRelayModels(d.Cfg.Relay.BaseURL, d.Cfg.Relay.APIKey)
	catMs := time.Since(catStart).Milliseconds()
	inCatalog := map[string]bool{}
	for i := range catalog {
		inCatalog[strings.TrimSpace(catalog[i].ID)] = true
	}

	for i := range models {
		if ctx.Err() != nil {
			return
		}
		m := &models[i]
		var row model.ModelProbe
		if m.Type == "text" {
			row = probeChat(ctx, chat, m)
		} else {
			row = model.ModelProbe{
				ModelID:  m.ID,
				ModelKey: m.ModelKey,
				Kind:     "catalog",
				OK:       catErr == nil && inCatalog[m.ModelKey],
				TotalMs:  catMs,
			}
			if catErr != nil {
				row.ErrorMsg = truncate(catErr.Error())
			} else if !inCatalog[m.ModelKey] {
				row.ErrorMsg = "上游目录中不存在该模型"
			}
		}
		if err := d.DB.Create(&row).Error; err != nil {
			logger.L().Warn("prober: record failed", zap.String("model", m.Name), zap.Error(err))
		}
	}
}

// probeChat runs one streaming completion against a text model, measuring
// first-token and completion latency.
func probeChat(ctx context.Context, chat *relaychat.Client, m *model.MarketModel) model.ModelProbe {
	pctx, cancel := context.WithTimeout(ctx, probeTimeout)
	defer cancel()

	start := time.Now()
	var firstMs int64
	_, err := chat.ChatStream(pctx, m.ModelKey,
		[]relaychat.Msg{relaychat.TextMsg("user", "ping")},
		func(string) {
			if firstMs == 0 {
				firstMs = time.Since(start).Milliseconds()
			}
		})
	row := model.ModelProbe{
		ModelID:  m.ID,
		ModelKey: m.ModelKey,
		Kind:     "chat",
		OK:       err == nil,
		FirstMs:  firstMs,
		TotalMs:  time.Since(start).Milliseconds(),
	}
	if err != nil && !errors.Is(err, context.Canceled) {
		row.ErrorMsg = truncate(err.Error())
	}
	return row
}

// prune drops samples older than the retention window.
func prune(db *gorm.DB) {
	if err := db.Where("create_time < ?", time.Now().Add(-retention)).
		Delete(&model.ModelProbe{}).Error; err != nil {
		logger.L().Warn("prober: prune failed", zap.Error(err))
	}
}

// ensureIntervalConfig seeds the interval key so it shows up in 配置管理
// (never overwrites an existing value).
func ensureIntervalConfig(db *gorm.DB) {
	var row model.SysConfig
	err := db.Where(model.SysConfig{ConfigKey: model.ConfigKeyProbeInterval}).
		Attrs(model.SysConfig{
			ConfigKey:   model.ConfigKeyProbeInterval,
			ConfigValue: strconv.Itoa(model.DefaultProbeIntervalSec),
			Group:       "models",
			Description: "模型可用性探测间隔（秒，0=停用；text 模型为真实补全调用，过密会消耗上游额度），后台「模型状态」页数据源",
		}).
		FirstOrCreate(&row).Error
	if err != nil {
		logger.L().Warn("prober: seed interval config failed", zap.Error(err))
	}
}

// sleep waits d or until ctx is done; reports whether to keep running.
func sleep(ctx context.Context, d time.Duration) bool {
	select {
	case <-ctx.Done():
		return false
	case <-time.After(d):
		return true
	}
}

// truncate caps an error message to the column width.
func truncate(s string) string {
	r := []rune(s)
	if len(r) > 500 {
		return string(r[:500])
	}
	return s
}
