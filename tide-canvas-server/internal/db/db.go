// Package db opens the MySQL connection via GORM, configures the connection
// pool, and exposes the migration hook (delegating to model.AutoMigrate).
package db

import (
	"fmt"
	"time"

	"gorm.io/driver/mysql"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"tidecanvas/internal/config"
	"tidecanvas/internal/model"
)

// Open connects to MySQL using the provided config and configures the pool.
func Open(cfg config.MySQLConfig) (*gorm.DB, error) {
	// Ensure the target database exists (GORM AutoMigrate creates tables, not the
	// database). Skipped when a raw DSN is supplied (then it's the operator's
	// responsibility) or no database name is set.
	if err := ensureDatabase(cfg); err != nil {
		return nil, err
	}

	gormCfg := &gorm.Config{
		Logger:                 logger.Default.LogMode(logger.Warn),
		SkipDefaultTransaction: true,
		PrepareStmt:            true,
	}

	gdb, err := gorm.Open(mysql.Open(cfg.BuildDSN()), gormCfg)
	if err != nil {
		return nil, fmt.Errorf("db: open mysql: %w", err)
	}

	sqlDB, err := gdb.DB()
	if err != nil {
		return nil, fmt.Errorf("db: get sql.DB: %w", err)
	}

	maxOpen := cfg.MaxOpenConns
	if maxOpen <= 0 {
		maxOpen = 100
	}
	maxIdle := cfg.MaxIdleConns
	if maxIdle <= 0 {
		maxIdle = 10
	}
	lifetime := cfg.MaxLifetime
	if lifetime <= 0 {
		lifetime = 3600
	}
	sqlDB.SetMaxOpenConns(maxOpen)
	sqlDB.SetMaxIdleConns(maxIdle)
	sqlDB.SetConnMaxLifetime(time.Duration(lifetime) * time.Second)

	if err := sqlDB.Ping(); err != nil {
		return nil, fmt.Errorf("db: ping mysql: %w", err)
	}

	return gdb, nil
}

// ensureDatabase creates the configured database if it does not yet exist, by
// connecting to the MySQL server without selecting a schema and issuing
// CREATE DATABASE IF NOT EXISTS. No-op when a raw DSN is provided or the
// database name is empty.
func ensureDatabase(cfg config.MySQLConfig) error {
	if cfg.DSN != "" || cfg.Database == "" {
		return nil
	}
	serverDSN := fmt.Sprintf("%s:%s@tcp(%s:%d)/?%s", cfg.User, cfg.Password, cfg.Host, cfg.Port, cfg.Params)
	tmp, err := gorm.Open(mysql.Open(serverDSN), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		return fmt.Errorf("db: connect mysql server: %w", err)
	}
	defer func() {
		if s, e := tmp.DB(); e == nil {
			_ = s.Close()
		}
	}()
	stmt := fmt.Sprintf("CREATE DATABASE IF NOT EXISTS `%s` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci", cfg.Database)
	if err := tmp.Exec(stmt).Error; err != nil {
		return fmt.Errorf("db: create database %q: %w", cfg.Database, err)
	}
	return nil
}

// Migrate runs AutoMigrate for every registered model.
func Migrate(gdb *gorm.DB) error {
	if err := model.AutoMigrate(gdb); err != nil {
		return fmt.Errorf("db: auto migrate: %w", err)
	}
	return nil
}
