package file

import (
	"errors"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

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

// CreateAdminFile 新增管理员资源记录。管理员资源独立于用户素材库 sys_file。
func (r *Repository) CreateAdminFile(f *model.SysAdminFile) error {
	return r.db.Create(f).Error
}

// DeleteByID 删除文件记录（软删，置 deleted=1，对齐旧 deleteById）。
func (r *Repository) DeleteByID(id int64) error {
	return r.db.Delete(&model.SysFile{}, id).Error
}

func (r *Repository) DeleteExtractedDocument(fileID int64) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var documents []model.AiDocument
		if err := tx.Where("file_id = ?", fileID).Find(&documents).Error; err != nil {
			return err
		}
		for _, document := range documents {
			if err := tx.Where("document_id = ?", document.ID).Delete(&model.AiDocumentChunk{}).Error; err != nil {
				return err
			}
		}
		return tx.Where("file_id = ?", fileID).Delete(&model.AiDocument{}).Error
	})
}

// CreateReference records a business reference without duplicating the physical file.
func (r *Repository) CreateReference(ref *model.SysFileReference) error {
	return r.db.Clauses(clause.OnConflict{DoNothing: true}).Create(ref).Error
}

func (r *Repository) DeleteReference(fileID int64, bizType string, bizID int64) error {
	return r.db.Where("file_id = ? AND biz_type = ? AND biz_id = ?", fileID, bizType, bizID).
		Delete(&model.SysFileReference{}).Error
}

func (r *Repository) DeleteReferencesForFile(fileID int64) error {
	return r.db.Where("file_id = ?", fileID).Delete(&model.SysFileReference{}).Error
}

func (r *Repository) CountReferences(fileID int64) (int64, error) {
	var total int64
	err := r.db.Model(&model.SysFileReference{}).Where("file_id = ?", fileID).Count(&total).Error
	return total, err
}

func (r *Repository) FindOwnedByIDs(userID int64, ids []int64) ([]model.SysFile, error) {
	var rows []model.SysFile
	if len(ids) == 0 {
		return rows, nil
	}
	err := r.db.Where("user_id = ? AND id IN ?", userID, ids).Find(&rows).Error
	return rows, err
}

// Page 团队共享素材库分页：归属用户在 ownerIDs 内，可选按 fileType 精确、originalName 模糊，按创建时间倒序。
func (r *Repository) Page(ownerIDs []int64, fileType, keyword string, pageNum, pageSize int) ([]model.SysFile, int64, error) {
	q := r.db.Model(&model.SysFile{}).
		Where("user_id IN ?", ownerIDs).
		Where("EXISTS (SELECT 1 FROM sys_file_reference sfr WHERE sfr.file_id = sys_file.id AND sfr.biz_type = ?)", "asset")
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
