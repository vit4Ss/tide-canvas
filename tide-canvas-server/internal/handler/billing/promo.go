package billing

// promo.go — 定价页「限时折扣」活动（sys_config: pricing.promo）。
//
// 与 faq.go 同一套路：单 JSON 文档存 sys_config，公开端点与管理端共用
// Load/Save。从未保存过时回落到关闭状态（enabled=false，前端不渲染）。
//
// 2026-07-19 起横幅升级为活动引擎：Deals 指定参与套餐及其活动绝对价
//（月付/年付分开，0=该周期不参与）。活动价从不写入 plan 表，只在读路径
//（listPlans 附加 promo 字段）与结算路径（effectivePlanPricing）上按
// Active() 判定叠加——endsAt 一过全链路自动回落原价，无需定时任务。

import (
	"encoding/json"
	"errors"
	"time"

	"github.com/shopspring/decimal"
	"gorm.io/gorm"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

// PromoDeal is one participating plan: the activity ABSOLUTE price per billing
// cycle（月付价 / 年付总价，与 plan 原价字段同口径）。0 = 该周期不参与。
type PromoDeal struct {
	PlanID  idgen.ID `json:"planId"`
	Monthly float64  `json:"monthly"`
	Yearly  float64  `json:"yearly"`
}

// PromoVO is the stored / served 限时折扣活动 document. EndsAt is an RFC3339
// timestamp; the activity is live only while Active() holds.
type PromoVO struct {
	Enabled  bool        `json:"enabled"`
	Tag      string      `json:"tag"`
	Title    string      `json:"title"`
	Subtitle string      `json:"subtitle"`
	EndsAt   string      `json:"endsAt"`
	Deals    []PromoDeal `json:"deals"`
}

// Active reports whether the activity is live at `now`: enabled, has a title
// and a valid future end time. All consumers (public promo endpoint, plan
// listing, order pricing) MUST go through this single judgment so the banner,
// the card prices and the charged amount can never disagree.
func (v *PromoVO) Active(now time.Time) bool {
	if !v.Enabled || v.Title == "" {
		return false
	}
	end, err := time.Parse(time.RFC3339, v.EndsAt)
	if err != nil {
		return false
	}
	return now.Before(end)
}

// DealPrice returns the activity price for a plan under the given cycle, and
// whether the plan participates in that cycle (price > 0). It does NOT check
// Active() — callers gate on that first.
func (v *PromoVO) DealPrice(planID idgen.ID, cycle string) (decimal.Decimal, bool) {
	for i := range v.Deals {
		if v.Deals[i].PlanID != planID {
			continue
		}
		p := v.Deals[i].Monthly
		if cycle == CycleYearly {
			p = v.Deals[i].Yearly
		}
		if p > 0 {
			return decimal.NewFromFloat(p).Round(2), true
		}
		return decimal.Zero, false
	}
	return decimal.Zero, false
}

// LoadPromo returns the effective 活动 config: the stored sys_config JSON when
// present/valid, else a disabled zero value.
func LoadPromo(db *gorm.DB) (PromoVO, error) {
	var row model.SysConfig
	err := db.Where("config_key = ?", model.ConfigKeyPricingPromo).First(&row).Error
	if err == nil && row.ConfigValue != "" {
		var vo PromoVO
		if jsonErr := json.Unmarshal([]byte(row.ConfigValue), &vo); jsonErr == nil {
			return vo, nil
		}
	}
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return PromoVO{}, err
	}
	return PromoVO{}, nil
}

// SavePromo persists the 活动 JSON into sys_config (upsert).
func SavePromo(db *gorm.DB, vo PromoVO) error {
	b, err := json.Marshal(vo)
	if err != nil {
		return err
	}
	var row model.SysConfig
	err = db.Where("config_key = ?", model.ConfigKeyPricingPromo).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return db.Create(&model.SysConfig{
			ConfigKey:   model.ConfigKeyPricingPromo,
			ConfigValue: string(b),
			Group:       "pricing",
			Description: "定价页限时折扣活动",
		}).Error
	}
	if err != nil {
		return err
	}
	return db.Model(&row).Update("config_value", string(b)).Error
}
