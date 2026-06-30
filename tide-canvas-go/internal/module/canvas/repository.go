package canvas

import (
	"errors"
	"time"

	"gorm.io/gorm"

	"github.com/tidecanvas/tide-canvas-go/internal/model"
)

// Repository 画布项目数据访问（GORM）。逻辑删除由模型 deleted 字段自动过滤。
type Repository struct {
	db *gorm.DB
}

// NewRepository 构造。
func NewRepository(db *gorm.DB) *Repository { return &Repository{db: db} }

// DB 暴露底层连接（供上层做事务）。
func (r *Repository) DB() *gorm.DB { return r.db }

// listColumns 列表/概要查询的列集合，刻意排除 canvas_data 大字段（LONGTEXT）。
var listColumns = []string{
	"id", "public_id", "user_id", "name", "description", "thumbnail",
	"is_public", "url_token", "status", "create_time", "update_time",
}

// FindByID 按主键查询，未找到返回 (nil, nil)。
func (r *Repository) FindByID(id int64) (*model.CanvasProject, error) {
	var p model.CanvasProject
	err := r.db.First(&p, id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &p, nil
}

// FindByPublicID 按对外ID查询，未找到返回 (nil, nil)。
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

// FindByURLToken 按画布编辑 URL token 查询，未找到返回 (nil, nil)（对齐 getProjectByToken）。
func (r *Repository) FindByURLToken(urlToken string) (*model.CanvasProject, error) {
	var p model.CanvasProject
	err := r.db.Where("url_token = ?", urlToken).First(&p).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &p, nil
}

// ExistsByURLToken url_token 是否已存在（生成唯一短 token 时校验冲突）。
func (r *Repository) ExistsByURLToken(urlToken string) (bool, error) {
	var n int64
	err := r.db.Model(&model.CanvasProject{}).Where("url_token = ?", urlToken).Count(&n).Error
	return n > 0, err
}

// Page 团队可见项目分页（对齐 listProjects）：归属用户在 ownerIDs 内，可选 name 模糊、status 等值，按 update_time 倒序。
// 刻意不 SELECT canvas_data 大字段。返回当前页记录与总数。
func (r *Repository) Page(ownerIDs []int64, keyword string, status *int, pageNum, pageSize int) ([]model.CanvasProject, int64, error) {
	if len(ownerIDs) == 0 {
		return []model.CanvasProject{}, 0, nil
	}
	q := r.db.Model(&model.CanvasProject{}).Where("user_id IN ?", ownerIDs)
	if keyword != "" {
		q = q.Where("name LIKE ?", "%"+keyword+"%")
	}
	if status != nil {
		q = q.Where("status = ?", *status)
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var records []model.CanvasProject
	if total > 0 {
		offset := (pageNum - 1) * pageSize
		if err := q.Select(listColumns).
			Order("update_time DESC").
			Offset(offset).
			Limit(pageSize).
			Find(&records).Error; err != nil {
			return nil, 0, err
		}
	}
	return records, total, nil
}

// Create 新增项目（主键/public_id 由模型 BeforeCreate 注入）。
func (r *Repository) Create(p *model.CanvasProject) error {
	return r.db.Create(p).Error
}

// Save 全量更新项目（对齐 updateById；以主键定位，写入全部列）。
func (r *Repository) Save(p *model.CanvasProject) error {
	return r.db.Save(p).Error
}

// UpdateColumns 局部更新指定列（自动维护 update_time）。
func (r *Repository) UpdateColumns(id int64, columns map[string]interface{}) error {
	return r.db.Model(&model.CanvasProject{}).Where("id = ?", id).Updates(columns).Error
}

func (r *Repository) UpdateColumnsIfUpdateTime(id int64, expected time.Time, columns map[string]interface{}) (bool, error) {
	tx := r.db.Model(&model.CanvasProject{}).Where("id = ? AND update_time = ?", id, expected).Updates(columns)
	if tx.Error != nil {
		return false, tx.Error
	}
	return tx.RowsAffected > 0, nil
}

// DeleteByID 逻辑删除（soft delete：置 deleted 标志）。
func (r *Repository) DeleteByID(id int64) error {
	return r.db.Delete(&model.CanvasProject{}, id).Error
}
