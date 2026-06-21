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

// Seed inserts a default admin user (role 9) if no admin exists yet. It is
// idempotent: calling it repeatedly is safe. Call after AutoMigrate.
func Seed(db *gorm.DB) error {
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
