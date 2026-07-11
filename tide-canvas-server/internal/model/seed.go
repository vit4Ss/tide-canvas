package model

import (
	"errors"
	"time"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	"tidecanvas/internal/pkg/idgen"
)

// Default seed admin credentials. Override the password in production.
const (
	defaultAdminUsername = "admin"
	defaultAdminEmail    = "admin@tidecanvas.local"
	defaultAdminPassword = "admin123456"
)

// Seed inserts a default admin user (role 9) if no admin exists yet, plus the
// baseline pay channels. It is idempotent: calling it repeatedly is safe.
// Call after AutoMigrate.
func Seed(db *gorm.DB) error {
	// 支付渠道默认值：收银台真实支持的两个渠道（易联达聚合网关，
	// payKey 只认 alipay/wechat 系）。表空才种，后台「支付渠道」的
	// 增删改不会被覆盖；渠道为空时用户端收银台会显示"未开通"。
	// 必须在下面的 admin 早退之前执行，已有库重启也能补上。
	if err := seedIfEmpty(db, &PayChannel{}, []PayChannel{
		{Name: "支付宝", Type: "alipay", Enabled: true, SortOrder: 1},
		{Name: "微信支付", Type: "wechat", Enabled: true, SortOrder: 2},
	}); err != nil {
		return err
	}

	var count int64
	if err := db.Model(&User{}).Where("role = ?", 9).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return nil
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(defaultAdminPassword), bcrypt.DefaultCost)
	if err != nil {
		return err
	}

	admin := &User{
		ID:            idgen.Next(),
		Username:      defaultAdminUsername,
		Email:         defaultAdminEmail,
		PasswordHash:  string(hash),
		Nickname:      "Administrator",
		Role:          9,
		Status:        1,
		ApiQuota:      1000000,
		Points:        1000000,
		StorageQuota:  1 << 40, // 1 TiB
		LastLoginTime: time.Now(),
	}

	if err := db.Create(admin).Error; err != nil {
		// Tolerate a race where another instance seeded concurrently.
		if errors.Is(err, gorm.ErrDuplicatedKey) {
			return nil
		}
		return err
	}
	return nil
}
