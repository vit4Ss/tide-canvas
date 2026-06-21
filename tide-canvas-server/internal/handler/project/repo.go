package project

import (
	"errors"
	"strings"

	"gorm.io/gorm"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

// repo.go is the project domain's persistence layer over *gorm.DB.

// ErrNotFound is returned when a project (or owner) lookup yields no row.
var ErrNotFound = errors.New("project: not found")

type repo struct {
	db *gorm.DB
}

func newRepo(db *gorm.DB) *repo { return &repo{db: db} }

// list returns a page of the owner's projects plus the total count. Results are
// scoped to ownerID; keyword filters name/description; status (when non-nil)
// filters by draft/published. Ordering is by update_time desc unless overridden.
func (r *repo) list(ownerID idgen.ID, q *ListQuery) ([]model.Project, int64, error) {
	tx := r.db.Model(&model.Project{}).Where("owner_id = ?", ownerID)

	if kw := strings.TrimSpace(q.Keyword); kw != "" {
		like := "%" + kw + "%"
		tx = tx.Where("name LIKE ? OR description LIKE ?", like, like)
	}
	if q.Status != nil {
		tx = tx.Where("status = ?", *q.Status)
	}

	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	tx = tx.Order(orderClause(q))

	var rows []model.Project
	if err := tx.Limit(q.PageSize).Offset(q.offset()).Find(&rows).Error; err != nil {
		return nil, 0, err
	}
	return rows, total, nil
}

// findByID loads a project by primary key (any owner).
func (r *repo) findByID(id idgen.ID) (*model.Project, error) {
	var p model.Project
	err := r.db.Where("id = ?", id).First(&p).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &p, nil
}

// findByToken loads a project by its public url_token or share_token (public
// share lookup). Only projects that are public OR have a share token set are
// considered; the service enforces visibility rules.
func (r *repo) findByToken(tok string) (*model.Project, error) {
	var p model.Project
	err := r.db.Where("url_token = ? OR share_token = ?", tok, tok).First(&p).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &p, nil
}

// create inserts a new project.
func (r *repo) create(p *model.Project) error {
	return r.db.Create(p).Error
}

// updateFields applies a partial update scoped to (id, ownerID) so a user can
// only mutate their own project. It returns ErrNotFound when no row matched.
func (r *repo) updateFields(id, ownerID idgen.ID, fields map[string]any) error {
	if len(fields) == 0 {
		return nil
	}
	res := r.db.Model(&model.Project{}).
		Where("id = ? AND owner_id = ?", id, ownerID).
		Updates(fields)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

// delete removes a project scoped to (id, ownerID). Returns ErrNotFound when no
// row matched.
func (r *repo) delete(id, ownerID idgen.ID) error {
	res := r.db.Where("id = ? AND owner_id = ?", id, ownerID).Delete(&model.Project{})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

// findOwner loads the minimal owner record for embedding in detail VOs.
func (r *repo) findOwner(ownerID idgen.ID) (*model.User, error) {
	var u model.User
	err := r.db.Select("id", "username", "nickname", "avatar").Where("id = ?", ownerID).First(&u).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &u, nil
}

// orderClause builds a safe ORDER BY from the query, whitelisting columns to
// avoid SQL injection via orderBy.
func orderClause(q *ListQuery) string {
	col := "update_time"
	switch q.OrderBy {
	case "createTime", "create_time":
		col = "create_time"
	case "updateTime", "update_time":
		col = "update_time"
	case "name":
		col = "name"
	}
	dir := "DESC"
	if strings.EqualFold(q.OrderDirection, "asc") {
		dir = "ASC"
	}
	return col + " " + dir
}
