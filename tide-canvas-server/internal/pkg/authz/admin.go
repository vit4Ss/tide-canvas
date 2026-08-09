// Package authz contains authorization checks that require current database
// state in addition to the identity cached in a JWT.
package authz

import (
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"tidecanvas/internal/middleware"
	"tidecanvas/internal/model"
)

// IsActiveAdministrator verifies both the authenticated token and the current
// account row. Use it for sensitive data and actions where a demotion, disable
// or soft-delete must take effect without waiting for the token to expire.
func IsActiveAdministrator(c *gin.Context, db *gorm.DB) bool {
	if c == nil || db == nil || middleware.CurrentRole(c) != middleware.AdminRole {
		return false
	}

	userID := middleware.CurrentUserID(c)
	if userID == 0 {
		return false
	}

	var current struct {
		Role   int
		Status int
	}
	if err := db.Model(&model.User{}).
		Select("role, status").
		Where("id = ?", userID).
		Take(&current).Error; err != nil {
		return false
	}
	return current.Role == middleware.AdminRole && current.Status == 1
}
