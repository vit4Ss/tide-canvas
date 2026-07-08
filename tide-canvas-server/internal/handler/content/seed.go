package content

import (
	"time"

	"gorm.io/gorm"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

// seed.go inserts demo content (banners and a few notifications for the admin
// user). It is idempotent: each section is skipped when rows already exist.

// Seed populates the content domain with demo data. Safe to call repeatedly.
func Seed(db *gorm.DB) error {
	if err := seedBanners(db); err != nil {
		return err
	}
	if err := seedNotifications(db); err != nil {
		return err
	}
	return nil
}

// seedBanners inserts ~3 home banners when none exist.
func seedBanners(db *gorm.DB) error {
	var count int64
	if err := db.Model(&model.Banner{}).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	banners := []model.Banner{
		{
			BaseModel: model.BaseModel{ID: idgen.Next()},
			Title:     "AI 创意画布，灵感即刻成形",
			ImageURL:  "https://picsum.photos/seed/tide-banner-1/1600/600",
			LinkURL:   "/studio",
			Position:  "home_top",
			SortOrder: 1,
			Status:    1,
		},
		{
			BaseModel: model.BaseModel{ID: idgen.Next()},
			Title:     "探索社区精选作品",
			ImageURL:  "https://picsum.photos/seed/tide-banner-2/1600/600",
			LinkURL:   "/explore",
			Position:  "home_top",
			SortOrder: 2,
			Status:    1,
		},
		{
			BaseModel: model.BaseModel{ID: idgen.Next()},
			Title:     "模型市场限时上新",
			ImageURL:  "https://picsum.photos/seed/tide-banner-3/1600/600",
			LinkURL:   "/models",
			Position:  "home_top",
			SortOrder: 3,
			Status:    1,
		},
	}
	return db.Create(&banners).Error
}

// seedNotifications inserts a few demo notifications for the admin user when the
// admin has none yet.
func seedNotifications(db *gorm.DB) error {
	admin := adminUserID(db)
	if admin == 0 {
		return nil // no admin yet (model.Seed not run); nothing to attach to.
	}

	var count int64
	if err := db.Model(&model.Notification{}).Where("user_id = ?", admin).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return nil
	}

	notifs := []model.Notification{
		{
			BaseModel: model.BaseModel{ID: idgen.Next()},
			UserID:    admin,
			Type:      "system",
			Title:     "欢迎使用 TideCanvas",
			Content:   "感谢注册！开始创建你的第一个 AI 画布项目吧。",
			LinkURL:   "/studio",
			IsRead:    0,
		},
		{
			BaseModel: model.BaseModel{ID: idgen.Next()},
			UserID:    admin,
			Type:      "system",
			Title:     "积分赠送到账",
			Content:   "新用户专属积分已发放到你的账户，可用于 AI 生成。",
			LinkURL:   "/pricing",
			IsRead:    0,
		},
		{
			BaseModel: model.BaseModel{ID: idgen.Next()},
			UserID:    admin,
			Type:      "system",
			Title:     "模型市场上新提醒",
			Content:   "本周有多款热门模型上架，快去模型市场看看吧。",
			LinkURL:   "/models",
			IsRead:    1,
			ReadTime:  ptrTime(time.Now().Add(-time.Hour)),
		},
	}
	return db.Create(&notifs).Error
}

// adminUserID returns the first admin (role 9) user id, or 0 when none exists.
func adminUserID(db *gorm.DB) idgen.ID {
	var u model.User
	if err := db.Select("id").Where("role = ?", 9).Order("create_time ASC").First(&u).Error; err != nil {
		return 0
	}
	return u.ID
}

// ptrTime returns a pointer to t.
func ptrTime(t time.Time) *time.Time { return &t }
