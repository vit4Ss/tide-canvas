package authz

import (
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"tidecanvas/internal/middleware"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

func TestIsActiveAdministratorUsesCurrentAccountState(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:active-administrator?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("get sql db: %v", err)
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })

	if err := db.AutoMigrate(&model.User{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	const userID idgen.ID = 901
	user := model.User{
		ID: userID, Username: "raw-admin", Email: "raw-admin@example.test",
		Role: middleware.AdminRole, Status: 1,
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Set(middleware.CtxUserID, userID)
	c.Set(middleware.CtxRole, middleware.AdminRole)
	if !IsActiveAdministrator(c, db) {
		t.Fatal("active administrator must pass")
	}

	c.Set(middleware.CtxRole, 1)
	if IsActiveAdministrator(c, db) {
		t.Fatal("non-administrator JWT role must be rejected")
	}
	c.Set(middleware.CtxRole, middleware.AdminRole)

	if err := db.Model(&model.User{}).Where("id = ?", userID).Update("role", 1).Error; err != nil {
		t.Fatalf("demote user: %v", err)
	}
	if IsActiveAdministrator(c, db) {
		t.Fatal("a stale administrator JWT must not bypass a current database demotion")
	}

	if err := db.Model(&model.User{}).Where("id = ?", userID).
		Updates(map[string]any{"role": middleware.AdminRole, "status": 0}).Error; err != nil {
		t.Fatalf("disable user: %v", err)
	}
	if IsActiveAdministrator(c, db) {
		t.Fatal("disabled administrator must be rejected")
	}

	if err := db.Model(&model.User{}).Where("id = ?", userID).Update("status", 1).Error; err != nil {
		t.Fatalf("re-enable user: %v", err)
	}
	if err := db.Delete(&model.User{}, "id = ?", userID).Error; err != nil {
		t.Fatalf("soft-delete user: %v", err)
	}
	if IsActiveAdministrator(c, db) {
		t.Fatal("soft-deleted administrator must be rejected")
	}
}
