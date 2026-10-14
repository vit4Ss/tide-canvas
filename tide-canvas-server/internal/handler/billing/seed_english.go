package billing

import (
	"encoding/json"
	"time"

	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

// SeedEnglishCreator publishes the one-time pack approved on 2026-10-14.
// A durable claim prevents restarts from recreating a removed/renamed pack or
// overriding later admin pricing. Unlike demo data this also runs in production.
func SeedEnglishCreator(db *gorm.DB) error {
	return db.Transaction(func(tx *gorm.DB) error {
		now := time.Now()
		claim := model.SysConfig{BaseModel: model.BaseModel{ID: idgen.Next(), CreateTime: now, UpdateTime: now},
			ConfigKey: "billing.en.creatorBootstrap.v1", ConfigValue: "1", Group: "billing",
			Description: "One-time initialization of the approved Creator USD 10 / 600-credit pack"}
		if err := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "config_key"}}, DoNothing: true}).Create(&claim).Error; err != nil {
			return err
		}
		var owner model.SysConfig
		if err := tx.Unscoped().Where("config_key = ?", claim.ConfigKey).First(&owner).Error; err != nil {
			return err
		}
		if owner.ID != claim.ID {
			return nil
		}
		features, err := json.Marshal(planFeatures{Desc: "600 credits for your next creative project. Pay once, create at your own pace.",
			Yearly: 0, VipLevel: 0, Cta: "Buy 600 credits", Featured: true,
			Items: []string{"600 credits added after payment", "Use credits in Studio and the media API", "Choose from available image, video, audio and 3D models", "One-time purchase. No automatic renewal."}})
		if err != nil {
			return err
		}
		plan := model.Plan{BaseModel: model.BaseModel{ID: idgen.Next(), CreateTime: now, UpdateTime: now},
			Market: model.BillingMarketEN, Currency: model.CurrencyUSD, Code: "en_creator", Name: "Creator",
			Description: "One-time purchase of 600 credits. No automatic renewal.", Price: decimal.NewFromInt(10),
			PointsGrant: 600, DurationDays: 0, Features: string(features), Status: 1, SortOrder: 1}
		return tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "code"}}, DoNothing: true}).Create(&plan).Error
	})
}
