package file

import (
	"context"
	"errors"

	"gorm.io/gorm"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

// repo is the file domain's data-access layer over *gorm.DB.
type repo struct {
	db *gorm.DB
}

func newRepo(db *gorm.DB) *repo { return &repo{db: db} }

func (r *repo) create(ctx context.Context, f *model.File) error {
	return r.db.WithContext(ctx).Create(f).Error
}

// get fetches a file by id. Returns (nil, nil) when not found.
func (r *repo) get(ctx context.Context, id idgen.ID) (*model.File, error) {
	var f model.File
	err := r.db.WithContext(ctx).First(&f, "id = ?", id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &f, nil
}

func (r *repo) delete(ctx context.Context, id idgen.ID) error {
	return r.db.WithContext(ctx).Delete(&model.File{}, "id = ?", id).Error
}

// list returns a page of the owner's files filtered by the query.
func (r *repo) list(ctx context.Context, ownerID idgen.ID, q fileQuery, offset, limit int) ([]model.File, int64, error) {
	tx := r.db.WithContext(ctx).Model(&model.File{}).Where("owner_id = ?", ownerID)
	if q.FileType != "" {
		tx = tx.Where("file_type = ?", q.FileType)
	}
	if q.Keyword != "" {
		tx = tx.Where("original_name LIKE ?", "%"+q.Keyword+"%")
	}

	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var rows []model.File
	if err := tx.Order("create_time DESC").Offset(offset).Limit(limit).Find(&rows).Error; err != nil {
		return nil, 0, err
	}
	return rows, total, nil
}

// addStorageUsed atomically increments the user's storage usage counter.
func (r *repo) addStorageUsed(ctx context.Context, ownerID idgen.ID, delta int64) error {
	if delta == 0 {
		return nil
	}
	return r.db.WithContext(ctx).Model(&model.User{}).
		Where("id = ?", ownerID).
		UpdateColumn("storage_used", gorm.Expr("GREATEST(storage_used + ?, 0)", delta)).Error
}
