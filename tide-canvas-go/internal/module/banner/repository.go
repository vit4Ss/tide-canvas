package banner

import (
	"errors"

	"gorm.io/gorm"

	"github.com/tidecanvas/tide-canvas-go/internal/model"
)

// Repository Banner 数据访问（GORM）。逻辑删除由模型 deleted 字段自动过滤。
type Repository struct {
	db *gorm.DB
}

// NewRepository 构造。
func NewRepository(db *gorm.DB) *Repository { return &Repository{db: db} }

// DB 暴露底层连接。
func (r *Repository) DB() *gorm.DB { return r.db }

// ListEnabled 启用中的 Banner（status=1），按 sort_order 升序（首页轮播展示）。
func (r *Repository) ListEnabled() ([]model.SysBanner, error) {
	var list []model.SysBanner
	err := r.db.Where("status = ?", 1).Order("sort_order asc").Find(&list).Error
	return list, err
}

// ListAll 全部 Banner，按 sort_order 升序（管理端列表）。
func (r *Repository) ListAll() ([]model.SysBanner, error) {
	var list []model.SysBanner
	err := r.db.Order("sort_order asc").Find(&list).Error
	return list, err
}

// FindByID 按主键查询，未找到返回 (nil, nil)。
func (r *Repository) FindByID(id int64) (*model.SysBanner, error) {
	var b model.SysBanner
	err := r.db.First(&b, id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &b, nil
}

// Create 新增 Banner（主键由模型 BeforeCreate 注入）。
func (r *Repository) Create(b *model.SysBanner) error {
	return r.db.Create(b).Error
}

// Save 整行保存（更新所有列，对齐旧 updateById 按实体更新）。
func (r *Repository) Save(b *model.SysBanner) error {
	return r.db.Save(b).Error
}

// DeleteByID 逻辑删除（soft_delete 自动置 deleted=1）。
func (r *Repository) DeleteByID(id int64) error {
	return r.db.Delete(&model.SysBanner{}, id).Error
}
