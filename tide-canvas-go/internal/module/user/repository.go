// Package user 用户数据访问与资料管理。
package user

import (
	"errors"

	"gorm.io/gorm"

	"github.com/tidecanvas/tide-canvas-go/internal/model"
)

// Repository 用户数据访问（GORM）。逻辑删除由模型 deleted 字段自动过滤。
type Repository struct {
	db *gorm.DB
}

// NewRepository 构造。
func NewRepository(db *gorm.DB) *Repository { return &Repository{db: db} }

// DB 暴露底层连接（供上层做事务或写关联表）。
func (r *Repository) DB() *gorm.DB { return r.db }

// FindByID 按主键查询，未找到返回 (nil, nil)。
func (r *Repository) FindByID(id int64) (*model.SysUser, error) {
	var u model.SysUser
	err := r.db.First(&u, id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// FindByPublicID 按对外ID查询，未找到返回 (nil, nil)。
func (r *Repository) FindByPublicID(publicID string) (*model.SysUser, error) {
	var u model.SysUser
	err := r.db.Where("public_id = ?", publicID).First(&u).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// FindByAccount 按用户名或邮箱查询（对齐旧 selectByAccount），未找到返回 (nil, nil)。
func (r *Repository) FindByAccount(account string) (*model.SysUser, error) {
	var u model.SysUser
	err := r.db.Where("username = ? OR email = ?", account, account).First(&u).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// ExistsByEmail 邮箱是否已注册。
func (r *Repository) ExistsByEmail(email string) (bool, error) {
	var n int64
	err := r.db.Model(&model.SysUser{}).Where("email = ?", email).Count(&n).Error
	return n > 0, err
}

// ExistsByUsername 用户名是否已存在。
func (r *Repository) ExistsByUsername(username string) (bool, error) {
	var n int64
	err := r.db.Model(&model.SysUser{}).Where("username = ?", username).Count(&n).Error
	return n > 0, err
}

// Create 新增用户（主键/public_id 由模型 BeforeCreate 注入）。
func (r *Repository) Create(u *model.SysUser) error {
	return r.db.Create(u).Error
}

// UpdateColumns 局部更新指定列（自动维护 update_time）。
func (r *Repository) UpdateColumns(id int64, columns map[string]interface{}) error {
	return r.db.Model(&model.SysUser{}).Where("id = ?", id).Updates(columns).Error
}
