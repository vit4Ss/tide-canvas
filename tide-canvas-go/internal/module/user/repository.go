package user

import (
	"errors"
	"strings"

	"gorm.io/gorm"

	"github.com/tidecanvas/tide-canvas-go/internal/model"
)

type Repository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) *Repository { return &Repository{db: db} }

func (r *Repository) DB() *gorm.DB { return r.db }

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

func (r *Repository) FindByEmail(email string) (*model.SysUser, error) {
	var u model.SysUser
	err := r.db.Where("email = ?", strings.TrimSpace(email)).First(&u).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

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

func (r *Repository) ExistsByEmail(email string) (bool, error) {
	var n int64
	err := r.db.Model(&model.SysUser{}).Where("email = ?", email).Count(&n).Error
	return n > 0, err
}

func (r *Repository) ExistsByUsername(username string) (bool, error) {
	var n int64
	err := r.db.Model(&model.SysUser{}).Where("username = ?", username).Count(&n).Error
	return n > 0, err
}

func (r *Repository) ExistsByNickname(nickname string, excludeID *int64) (bool, error) {
	nickname = strings.TrimSpace(nickname)
	if nickname == "" {
		return false, nil
	}
	tx := r.db.Model(&model.SysUser{}).Where("nickname = ?", nickname)
	if excludeID != nil {
		tx = tx.Where("id <> ?", *excludeID)
	}
	var n int64
	if err := tx.Count(&n).Error; err != nil {
		return false, err
	}
	return n > 0, nil
}

func (r *Repository) DisplayNamesByIDs(ids []int64) (map[int64]string, error) {
	out := make(map[int64]string, len(ids))
	if len(ids) == 0 {
		return out, nil
	}
	type row struct {
		ID       int64
		Username string
		Nickname string
	}
	var rows []row
	if err := r.db.Model(&model.SysUser{}).
		Select("id", "username", "nickname").
		Where("id IN ?", ids).
		Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, r := range rows {
		out[r.ID] = displayName(r.Nickname, r.Username)
	}
	return out, nil
}

func (r *Repository) Create(u *model.SysUser) error {
	return r.db.Create(u).Error
}

func (r *Repository) UpdateColumns(id int64, columns map[string]interface{}) error {
	return r.db.Model(&model.SysUser{}).Where("id = ?", id).Updates(columns).Error
}

func displayName(nickname, username string) string {
	if strings.TrimSpace(nickname) != "" {
		return strings.TrimSpace(nickname)
	}
	return strings.TrimSpace(username)
}
