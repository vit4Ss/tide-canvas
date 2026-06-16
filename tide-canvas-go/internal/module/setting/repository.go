// Package setting 系统设置模块：基于 sys_config(key-value) 的管理端读取与批量保存，
// 忠实迁移旧后端 AdminSettingController（SysConfigMapper）。
//
// 管理端路由统一前缀 /api/admin/settings，全程 JWTAuth + AdminOnly + RBAC 按钮级权限
// （setting:view / setting:edit）。复用 recharge/team/points 等模块同一张 sys_config 表。
package setting

import (
	"errors"

	"gorm.io/gorm"

	"github.com/tidecanvas/tide-canvas-go/internal/model"
)

// Repository 系统设置数据访问（GORM）。逻辑删除由模型 deleted 字段自动过滤。
type Repository struct {
	db *gorm.DB
}

// NewRepository 构造。
func NewRepository(db *gorm.DB) *Repository { return &Repository{db: db} }

// LoadAll 读取全部系统配置为 key→value 映射（对齐 AdminSettingController.get 的 selectList(null)）。
func (r *Repository) LoadAll() (map[string]string, error) {
	var configs []model.SysConfig
	if err := r.db.Find(&configs).Error; err != nil {
		return nil, err
	}
	out := make(map[string]string, len(configs))
	for i := range configs {
		out[configs[i].ConfigKey] = configs[i].ConfigValue
	}
	return out, nil
}

// Upsert 写入单个配置项：键已存在则更新 value，否则插入（对齐 update 中的 selectOne→update/insert）。
// create_time/update_time 由模型基类(autoCreateTime/autoUpdateTime)与 BeforeCreate 维护。
func (r *Repository) Upsert(key, value string) error {
	var cfg model.SysConfig
	err := r.db.Where("config_key = ?", key).First(&cfg).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		// 不存在则插入，保证新增配置项（如支付配置）无需手工建行即可保存。
		return r.db.Create(&model.SysConfig{ConfigKey: key, ConfigValue: value}).Error
	}
	if err != nil {
		return err
	}
	return r.db.Model(&model.SysConfig{}).
		Where("id = ?", cfg.ID).
		Update("config_value", value).Error
}
