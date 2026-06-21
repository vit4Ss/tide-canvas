package billing

import (
	"encoding/json"
	"time"

	"github.com/shopspring/decimal"
	"gorm.io/gorm"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

// seed.go inserts the default pricing catalog (subscription plans + point
// packages) so the public /pricing page renders against real rows. The data
// mirrors the frontend mock (tide-canvas-web/src/mock/pricing.ts PLANS).

// planSeed is the static shape used to build a model.Plan row.
type planSeed struct {
	name          string
	code          string
	desc          string
	monthly       float64 // shown as the monthly price; stored in Plan.Price
	yearly        float64 // per-month price when paid yearly; stored in Features
	monthlyPoints int     // stored in Plan.PointsGrant
	durationDays  int
	featured      bool
	cta           string
	items         []string
}

// pkgSeed is the static shape used to build a model.PointPackage row.
type pkgSeed struct {
	name        string
	points      int
	bonusPoints int
	price       float64
}

// Seed inserts the default plans and point packages if none exist yet. It is
// idempotent: plans and packages are seeded independently, each skipped when its
// table already has rows. Safe to call repeatedly after AutoMigrate.
func Seed(db *gorm.DB) error {
	if err := seedPlans(db); err != nil {
		return err
	}
	return seedPackages(db)
}

func seedPlans(db *gorm.DB) error {
	var count int64
	if err := db.Model(&model.Plan{}).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return nil
	}

	seeds := []planSeed{
		{
			name: "体验版", code: "free", desc: "适合尝鲜与轻度创作",
			monthly: 0, yearly: 0, monthlyPoints: 100, durationDays: 0,
			featured: false, cta: "免费开始",
			items: []string{"每月 100 积分", "基础图片模型", "标准生成队列", "社区作品广场", "512² 标准分辨率"},
		},
		{
			name: "创作者 Pro", code: "pro", desc: "高频创作者的首选",
			monthly: 68, yearly: 39, monthlyPoints: 3000, durationDays: 30,
			featured: true, cta: "升级 Pro",
			items: []string{"每月 3,000 积分", "全部图片 + 视频模型", "优先生成队列 · 不限速", "高清放大 / 局部重绘", "商用授权", "4K 超高分辨率"},
		},
		{
			name: "企业版", code: "enterprise", desc: "团队协作与品牌量产",
			monthly: 268, yearly: 199, monthlyPoints: 20000, durationDays: 30,
			featured: false, cta: "联系我们",
			items: []string{"无限积分（公平使用）", "团队席位与协作空间", "API 接入与工作流", "专属客户成功经理", "品牌风格私有模型", "SLA 与发票支持"},
		},
	}

	now := time.Now()
	rows := make([]model.Plan, 0, len(seeds))
	for i, s := range seeds {
		features, err := json.Marshal(planFeatures{
			Desc:     s.desc,
			Yearly:   s.yearly,
			Cta:      s.cta,
			Featured: s.featured,
			Items:    s.items,
		})
		if err != nil {
			return err
		}
		rows = append(rows, model.Plan{
			BaseModel: model.BaseModel{
				ID:         idgen.Next(),
				CreateTime: now,
				UpdateTime: now,
			},
			Name:         s.name,
			Code:         s.code,
			Description:  s.desc,
			Price:        decimal.NewFromFloat(s.monthly),
			DurationDays: s.durationDays,
			PointsGrant:  s.monthlyPoints,
			Features:     string(features),
			SortOrder:    i + 1,
			Status:       1,
		})
	}
	return db.Create(&rows).Error
}

func seedPackages(db *gorm.DB) error {
	var count int64
	if err := db.Model(&model.PointPackage{}).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return nil
	}

	seeds := []pkgSeed{
		{name: "入门包", points: 1000, bonusPoints: 0, price: 9.9},
		{name: "标准包", points: 5000, bonusPoints: 500, price: 45},
		{name: "超值包", points: 12000, bonusPoints: 2000, price: 99},
	}

	now := time.Now()
	rows := make([]model.PointPackage, 0, len(seeds))
	for i, s := range seeds {
		rows = append(rows, model.PointPackage{
			BaseModel: model.BaseModel{
				ID:         idgen.Next(),
				CreateTime: now,
				UpdateTime: now,
			},
			Name:        s.name,
			Points:      s.points,
			BonusPoints: s.bonusPoints,
			Price:       decimal.NewFromFloat(s.price),
			SortOrder:   i + 1,
			Status:      1,
		})
	}
	return db.Create(&rows).Error
}
