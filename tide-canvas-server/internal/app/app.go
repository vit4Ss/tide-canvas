// Package app holds the shared dependency container passed to every domain's
// route registrar. Handlers/services/repos pull what they need from Deps.
package app

import (
	"github.com/redis/go-redis/v9"
	"gorm.io/gorm"

	"tidecanvas/internal/config"
	"tidecanvas/internal/pkg/storage"
)

// Deps is the application-wide dependency container.
type Deps struct {
	DB      *gorm.DB
	RDB     *redis.Client
	Cfg     *config.Config
	Storage storage.StorageStrategy
}
