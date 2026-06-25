package storage

import (
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"tidecanvas/internal/config"
	"tidecanvas/internal/model"
)

// config_db.go makes the storage settings editable from the admin 配置管理 screen.
// Each setting is a sys_config key under the 存储配置 group; on first boot the keys
// are seeded from the file/env config, and thereafter the DB values win. Changes
// take effect on the next restart (the strategy is built once at boot).

// storageConfigGroup is the sys_config group the storage keys live under so they
// render together in the admin 配置管理 grid.
const storageConfigGroup = "存储配置"

// storageField binds one sys_config key to a StorageConfig field (read + write)
// plus an admin-facing description, so seeding and loading share one definition.
type storageField struct {
	key  string
	desc string
	get  func(c config.StorageConfig) string
	set  func(c *config.StorageConfig, v string)
}

// storageFields is the canonical list of admin-editable storage settings.
var storageFields = []storageField{
	{"storage.kind", "存储方式：local 或 oss",
		func(c config.StorageConfig) string { return c.Type },
		func(c *config.StorageConfig, v string) { c.Type = v }},
	{"storage.localDir", "本地存储目录（kind=local 时）",
		func(c config.StorageConfig) string { return c.LocalDir },
		func(c *config.StorageConfig, v string) { c.LocalDir = v }},
	{"storage.publicUrl", "本地存储公网前缀（kind=local 时）",
		func(c config.StorageConfig) string { return c.PublicURL },
		func(c *config.StorageConfig, v string) { c.PublicURL = v }},
	{"storage.ossEndpoint", "OSS Endpoint，如 https://oss-cn-shanghai.aliyuncs.com",
		func(c config.StorageConfig) string { return c.Endpoint },
		func(c *config.StorageConfig, v string) { c.Endpoint = v }},
	{"storage.ossBucket", "OSS Bucket 名称",
		func(c config.StorageConfig) string { return c.Bucket },
		func(c *config.StorageConfig, v string) { c.Bucket = v }},
	{"storage.ossAccessKeyId", "OSS AccessKey ID",
		func(c config.StorageConfig) string { return c.AccessKey },
		func(c *config.StorageConfig, v string) { c.AccessKey = v }},
	{"storage.ossAccessKeySecret", "OSS AccessKey Secret",
		func(c config.StorageConfig) string { return c.SecretKey },
		func(c *config.StorageConfig, v string) { c.SecretKey = v }},
	{"storage.ossRegion", "OSS Region（可选）",
		func(c config.StorageConfig) string { return c.Region },
		func(c *config.StorageConfig, v string) { c.Region = v }},
	{"storage.ossPrefix", "对象前缀（项目根目录），如 canvas/uploads/",
		func(c config.StorageConfig) string { return c.Prefix },
		func(c *config.StorageConfig, v string) { c.Prefix = v }},
	{"storage.ossCdnDomain", "CDN 域名（可选），用于生成展示 URL",
		func(c config.StorageConfig) string { return c.CDNDomain },
		func(c *config.StorageConfig, v string) { c.CDNDomain = v }},
	{"storage.ossAccelerateDomain", "OSS 传输加速域名（可选），跨境上游取图用",
		func(c config.StorageConfig) string { return c.AccelerateDomain },
		func(c *config.StorageConfig, v string) { c.AccelerateDomain = v }},
}

// SeedAndLoadConfig seeds the storage sys_config keys from base on first boot
// (idempotent), then returns the effective config with DB values overlaid on
// base. The returned config is what the strategy should be built from.
func SeedAndLoadConfig(db *gorm.DB, base config.StorageConfig) (config.StorageConfig, error) {
	// 1) Seed any missing key from the file/env config (INSERT IGNORE-style).
	for _, f := range storageFields {
		row := model.SysConfig{
			ConfigKey:   f.key,
			ConfigValue: f.get(base),
			Group:       storageConfigGroup,
			Description: f.desc,
		}
		if err := db.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "config_key"}},
			DoNothing: true,
		}).Create(&row).Error; err != nil {
			return base, err
		}
	}

	// 2) Overlay DB values (the admin-editable source of truth) onto base.
	var rows []model.SysConfig
	if err := db.Where("config_key LIKE ?", "storage.%").Find(&rows).Error; err != nil {
		return base, err
	}
	byKey := make(map[string]string, len(rows))
	for i := range rows {
		byKey[rows[i].ConfigKey] = rows[i].ConfigValue
	}
	eff := base
	for _, f := range storageFields {
		if v, ok := byKey[f.key]; ok {
			f.set(&eff, v)
		}
	}
	return eff, nil
}
