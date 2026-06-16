package redeem

import (
	"errors"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/tidecanvas/tide-canvas-go/internal/model"
)

// Repository 兑换码数据访问（GORM）。逻辑删除由模型 deleted 字段自动过滤。
type Repository struct {
	db *gorm.DB
}

// NewRepository 构造。
func NewRepository(db *gorm.DB) *Repository { return &Repository{db: db} }

// DB 暴露底层连接（供上层做事务）。
func (r *Repository) DB() *gorm.DB { return r.db }

// LockByCodeForUpdate 行锁读取兑换码（SELECT ... FOR UPDATE，对齐旧 last("FOR UPDATE")），
// 防并发重复兑换。须在事务中调用。未找到返回 (nil, nil)。
func (r *Repository) LockByCodeForUpdate(tx *gorm.DB, code string) (*model.RedeemCode, error) {
	var rc model.RedeemCode
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("code = ?", code).First(&rc).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &rc, nil
}

// FindByID 按主键查询兑换码，未找到返回 (nil, nil)。
func (r *Repository) FindByID(id int64) (*model.RedeemCode, error) {
	var rc model.RedeemCode
	err := r.db.First(&rc, id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &rc, nil
}

// ExistsByCode 兑换码是否已存在（对齐 uniqueCode 的 selectCount，用于生成去重）。
func (r *Repository) ExistsByCode(code string) (bool, error) {
	var n int64
	err := r.db.Model(&model.RedeemCode{}).Where("code = ?", code).Count(&n).Error
	return n > 0, err
}

// Create 新增兑换码（主键由模型 BeforeCreate 注入）。
func (r *Repository) Create(rc *model.RedeemCode) error {
	return r.db.Create(rc).Error
}

// MarkUsed 在事务内将兑换码置为已使用并记录使用者与时间（对齐 redeem 的 updateById）。
func (r *Repository) MarkUsed(tx *gorm.DB, rc *model.RedeemCode) error {
	return tx.Model(&model.RedeemCode{}).
		Where("id = ?", rc.ID).
		Updates(map[string]interface{}{
			"status":    rc.Status,
			"used_by":   rc.UsedBy,
			"used_time": rc.UsedTime,
		}).Error
}

// UpdateStatus 更新兑换码状态（对齐 updateStatus 的 updateById）。
func (r *Repository) UpdateStatus(id int64, status int) error {
	return r.db.Model(&model.RedeemCode{}).
		Where("id = ?", id).
		UpdateColumn("status", status).Error
}

// Delete 逻辑删除兑换码（GORM 软删除，对齐 deleteById）。
func (r *Repository) Delete(id int64) error {
	return r.db.Delete(&model.RedeemCode{}, id).Error
}

// Page 分页查询兑换码：按条件过滤并按 id 倒序，返回当页记录与总数（对齐 list）。
func (r *Repository) Page(q *RedeemCodeQuery) ([]model.RedeemCode, int64, error) {
	tx := r.db.Model(&model.RedeemCode{})
	if q.Code != "" {
		tx = tx.Where("code LIKE ?", "%"+q.Code+"%")
	}
	if q.Status != nil {
		tx = tx.Where("status = ?", *q.Status)
	}
	if q.BatchNo != "" {
		tx = tx.Where("batch_no = ?", q.BatchNo)
	}

	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var records []model.RedeemCode
	if err := tx.Order("id DESC").
		Offset((q.PageNum - 1) * q.PageSize).
		Limit(q.PageSize).
		Find(&records).Error; err != nil {
		return nil, 0, err
	}
	return records, total, nil
}
