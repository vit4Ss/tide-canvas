package file

import (
	"errors"

	"gorm.io/gorm"

	"github.com/tidecanvas/tide-canvas-go/internal/model"
)

// Repository 文件数据访问（GORM）。逻辑删除由模型 deleted 字段自动过滤。
type Repository struct {
	db *gorm.DB
}

// NewRepository 构造。
func NewRepository(db *gorm.DB) *Repository { return &Repository{db: db} }

// DB 暴露底层连接（供上层做事务等）。
func (r *Repository) DB() *gorm.DB { return r.db }

// FindByID 按主键查询，未找到返回 (nil, nil)。
func (r *Repository) FindByID(id int64) (*model.SysFile, error) {
	var f model.SysFile
	err := r.db.First(&f, id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &f, nil
}

// FindByPublicID 按对外ID查询，未找到返回 (nil, nil)。
func (r *Repository) FindByPublicID(publicID string) (*model.SysFile, error) {
	var f model.SysFile
	err := r.db.Where("public_id = ?", publicID).First(&f).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &f, nil
}

// FindByUserAndURL 按用户 + 文件 URL 查首条（saveFromUrl 去重用），未找到返回 (nil, nil)。
func (r *Repository) FindByUserAndURL(userID int64, url string) (*model.SysFile, error) {
	var f model.SysFile
	err := r.db.Where("user_id = ? AND file_url = ?", userID, url).
		Limit(1).First(&f).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &f, nil
}

// Create 新增文件记录（主键/public_id 由模型 BeforeCreate 注入）。
func (r *Repository) Create(f *model.SysFile) error {
	return r.db.Create(f).Error
}

// DeleteByID 删除文件记录（软删，置 deleted=1，对齐旧 deleteById）。
func (r *Repository) DeleteByID(id int64) error {
	return r.db.Delete(&model.SysFile{}, id).Error
}

// Page 团队共享素材库分页：归属用户在 ownerIDs 内，可选按 fileType 精确、originalName 模糊，按创建时间倒序。
func (r *Repository) Page(ownerIDs []int64, fileType, keyword string, pageNum, pageSize int) ([]model.SysFile, int64, error) {
	q := r.db.Model(&model.SysFile{}).Where("user_id IN ?", ownerIDs)
	if fileType != "" {
		q = q.Where("file_type = ?", fileType)
	}
	if keyword != "" {
		q = q.Where("original_name LIKE ?", "%"+keyword+"%")
	}
	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var records []model.SysFile
	if total == 0 {
		return records, 0, nil
	}
	err := q.Order("create_time DESC").
		Offset((pageNum - 1) * pageSize).
		Limit(pageSize).
		Find(&records).Error
	if err != nil {
		return nil, 0, err
	}
	return records, total, nil
}

// SumSizeByUserIDs 统计给定用户已占用的存储字节数（存储额度校验用）。
func (r *Repository) SumSizeByUserIDs(userIDs []int64) (int64, error) {
	var total *int64
	err := r.db.Model(&model.SysFile{}).
		Where("user_id IN ?", userIDs).
		Select("COALESCE(SUM(file_size), 0)").
		Scan(&total).Error
	if err != nil {
		return 0, err
	}
	if total == nil {
		return 0, nil
	}
	return *total, nil
}
