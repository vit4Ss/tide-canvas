package content

import (
	"errors"

	"gorm.io/gorm"

	"github.com/tidecanvas/tide-canvas-go/internal/model"
)

// Repository 内容审核数据访问（GORM）。逻辑删除由模型 deleted 字段自动过滤。
type Repository struct {
	db *gorm.DB
}

// NewRepository 构造。
func NewRepository(db *gorm.DB) *Repository { return &Repository{db: db} }

// PageContents 公开作品分页（对齐 AdminContentController.list）：
// 固定 is_public=1；keyword 模糊匹配 name；status 精确过滤；按 create_time 倒序。
// 列表查询不 SELECT canvas_data 大字段。
func (r *Repository) PageContents(q *ContentQuery) ([]model.CanvasProject, int64, error) {
	tx := r.db.Model(&model.CanvasProject{}).Where("is_public = ?", 1)
	if q.Keyword != "" {
		tx = tx.Where("name LIKE ?", "%"+q.Keyword+"%")
	}
	if q.Status != nil {
		tx = tx.Where("status = ?", *q.Status)
	}

	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var records []model.CanvasProject
	if err := tx.
		Select("id", "public_id", "user_id", "name", "thumbnail", "status", "create_time", "update_time").
		Order("create_time DESC").
		Offset(q.Offset()).Limit(q.PageSize).
		Find(&records).Error; err != nil {
		return nil, 0, err
	}
	return records, total, nil
}

// FindByPublicID 按对外ID查询作品，未找到返回 (nil, nil)（对齐 selectById 的存在性判断）。
func (r *Repository) FindByPublicID(publicID string) (*model.CanvasProject, error) {
	var p model.CanvasProject
	err := r.db.Where("public_id = ?", publicID).First(&p).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &p, nil
}

// UpdateStatus 仅更新作品状态（自动维护 update_time），对齐 audit 的局部更新。
func (r *Repository) UpdateStatus(id int64, status int) error {
	return r.db.Model(&model.CanvasProject{}).
		Where("id = ?", id).
		Update("status", status).Error
}

// OwnerNamesByIDs 批量解析 内部用户ID → 展示名（昵称优先，空则用户名）。
// 仅读取 sys_user 的 id/nickname/username 投影，不外泄 user_id 或敏感字段。缺失的ID不在结果中。
func (r *Repository) OwnerNamesByIDs(ids []int64) (map[int64]string, error) {
	result := make(map[int64]string, len(ids))
	if len(ids) == 0 {
		return result, nil
	}
	type row struct {
		ID       int64
		Nickname string
		Username string
	}
	var rows []row
	if err := r.db.Model(&model.SysUser{}).
		Select("id", "nickname", "username").
		Where("id IN ?", ids).
		Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, rw := range rows {
		name := rw.Nickname
		if name == "" {
			name = rw.Username
		}
		result[rw.ID] = name
	}
	return result, nil
}
