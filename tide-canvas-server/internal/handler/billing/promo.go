package billing

// promo.go — 定价页「限时折扣」横幅（sys_config: pricing.promo）。
//
// 与 faq.go 同一套路：单 JSON 文档存 sys_config，公开端点与管理端共用
// Load/Save。从未保存过时回落到关闭状态（enabled=false，前端不渲染）。

import (
	"encoding/json"
	"errors"

	"gorm.io/gorm"

	"tidecanvas/internal/model"
)

// PromoVO is the stored / served 限时折扣横幅 document. EndsAt is an RFC3339
// timestamp; the client hides the banner when enabled=false or the countdown
// reaches zero.
type PromoVO struct {
	Enabled  bool   `json:"enabled"`
	Tag      string `json:"tag"`
	Title    string `json:"title"`
	Subtitle string `json:"subtitle"`
	EndsAt   string `json:"endsAt"`
}

// LoadPromo returns the effective 横幅 config: the stored sys_config JSON when
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

// SavePromo persists the 横幅 JSON into sys_config (upsert).
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
			Description: "定价页限时折扣横幅",
		}).Error
	}
	if err != nil {
		return err
	}
	return db.Model(&row).Update("config_value", string(b)).Error
}
