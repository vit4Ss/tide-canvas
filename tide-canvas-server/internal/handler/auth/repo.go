package auth

import (
	"errors"

	"gorm.io/gorm"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

// repo.go is the auth domain's persistence layer over *gorm.DB. It owns all
// User queries used by the auth service.

// ErrNotFound is returned when a user lookup yields no row.
var ErrNotFound = errors.New("auth: user not found")

type repo struct {
	db *gorm.DB
}

func newRepo(db *gorm.DB) *repo { return &repo{db: db} }

// findByID loads a user by primary key.
func (r *repo) findByID(id idgen.ID) (*model.User, error) {
	var u model.User
	err := r.db.Where("id = ?", id).First(&u).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &u, nil
}

// findByAccount loads a user by username, email or phone (login accepts any).
func (r *repo) findByAccount(account string) (*model.User, error) {
	var u model.User
	err := r.db.Where("username = ? OR email = ? OR phone = ?", account, account, account).First(&u).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &u, nil
}

// existsUsername reports whether a username is already taken.
func (r *repo) existsUsername(username string) (bool, error) {
	var n int64
	if err := r.db.Model(&model.User{}).Where("username = ?", username).Count(&n).Error; err != nil {
		return false, err
	}
	return n > 0, nil
}

// existsEmail reports whether an email is already registered.
func (r *repo) existsEmail(email string) (bool, error) {
	var n int64
	if err := r.db.Model(&model.User{}).Where("email = ?", email).Count(&n).Error; err != nil {
		return false, err
	}
	return n > 0, nil
}

// create inserts a new user.
func (r *repo) create(u *model.User) error {
	return r.db.Create(u).Error
}

// updateFields applies a partial update to the user identified by id.
func (r *repo) updateFields(id idgen.ID, fields map[string]any) error {
	if len(fields) == 0 {
		return nil
	}
	return r.db.Model(&model.User{}).Where("id = ?", id).Updates(fields).Error
}

// teamPriceFactor returns the price markup factor of the user's team, or 1 when
// the user is in no team (or the team row is missing).
func (r *repo) teamPriceFactor(teamID idgen.ID) (float64, error) {
	if teamID == 0 {
		return 1, nil
	}
	var t model.Team
	err := r.db.Select("price_factor").Where("id = ?", teamID).First(&t).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return 1, nil
		}
		return 1, err
	}
	if t.PriceFactor <= 0 {
		return 1, nil
	}
	return t.PriceFactor, nil
}
