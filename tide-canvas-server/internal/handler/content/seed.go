package content

import (
	"time"

	"gorm.io/gorm"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

// seed.go inserts demo content (a few notifications for the admin user). It is
// idempotent: each section is skipped when rows already exist.
//（banner 种子已随「发现管理」下线，2026-07-09 用户拍板。）

// Seed populates the content domain with demo data. Safe to call repeatedly.
func Seed(db *gorm.DB) error {
	return seedNotifications(db)
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
