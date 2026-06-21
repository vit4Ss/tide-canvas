package market

import (
	"errors"
	"strings"

	"gorm.io/gorm"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

// repo.go is the market domain's persistence layer over *gorm.DB.

// ErrNotFound is returned when a market model (or category) lookup yields no row.
var ErrNotFound = errors.New("market: not found")

// statusListed is the MarketModel.Status value for an on-shelf (visible) model.
const statusListed = 1

type repo struct {
	db *gorm.DB
}

func newRepo(db *gorm.DB) *repo { return &repo{db: db} }

// categories returns visible categories ordered by sort_order then id.
func (r *repo) categories() ([]model.ModelCategory, error) {
	var rows []model.ModelCategory
	err := r.db.Where("status = ?", 1).
		Order("sort_order ASC, id ASC").
		Find(&rows).Error
	if err != nil {
		return nil, err
	}
	return rows, nil
}

// list returns a page of listed market models plus the total count. Filtering by
// base / type is applied against the tags column (the base/type values are
// stored as "base:X" / "type:X" pseudo-tags); keyword fuzzy-matches name,
// description and tags. Ordering follows the sort key (runs|name|new).
func (r *repo) list(q *ListQuery) ([]model.MarketModel, int64, error) {
	tx := r.db.Model(&model.MarketModel{}).Where("status = ?", statusListed)

	if q.Base != "" {
		// Match the "base:X" pseudo-tag (case-insensitive on the value).
		tx = tx.Where("tags LIKE ?", "%base:"+q.Base+"%")
	}
	if q.Type != "" {
		tx = tx.Where("tags LIKE ?", "%type:"+q.Type+"%")
	}
	if kw := strings.TrimSpace(q.Keyword); kw != "" {
		like := "%" + kw + "%"
		tx = tx.Where("name LIKE ? OR description LIKE ? OR tags LIKE ?", like, like, like)
	}

	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	tx = tx.Order(orderClause(q.Sort))

	var rows []model.MarketModel
	if err := tx.Limit(q.PageSize).Offset(q.offset()).Find(&rows).Error; err != nil {
		return nil, 0, err
	}
	return rows, total, nil
}

// findByID loads a single listed market model by primary key.
func (r *repo) findByID(id idgen.ID) (*model.MarketModel, error) {
	var m model.MarketModel
	err := r.db.Where("id = ? AND status = ?", id, statusListed).First(&m).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &m, nil
}

// incLikes atomically adds delta (+1) to like_count for a listed model. Returns
// ErrNotFound when no row matched.
func (r *repo) incLikes(id idgen.ID, delta int) error {
	res := r.db.Model(&model.MarketModel{}).
		Where("id = ? AND status = ?", id, statusListed).
		UpdateColumn("like_count", gorm.Expr("like_count + ?", delta))
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

// incUse atomically adds 1 to use_count for a listed model. Returns ErrNotFound
// when no row matched.
func (r *repo) incUse(id idgen.ID) error {
	res := r.db.Model(&model.MarketModel{}).
		Where("id = ? AND status = ?", id, statusListed).
		UpdateColumn("use_count", gorm.Expr("use_count + ?", 1))
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

// authorNames resolves the display name (nickname, falling back to username) for
// the given author ids in a single query. Missing ids are simply absent.
func (r *repo) authorNames(ids []idgen.ID) (map[idgen.ID]string, error) {
	out := map[idgen.ID]string{}
	if len(ids) == 0 {
		return out, nil
	}
	var users []model.User
	if err := r.db.Select("id", "username", "nickname").Where("id IN ?", ids).Find(&users).Error; err != nil {
		return nil, err
	}
	for i := range users {
		out[users[i].ID] = authorDisplayName(&users[i])
	}
	return out, nil
}

// categoryNames resolves category names for the given ids in a single query.
func (r *repo) categoryNames(ids []idgen.ID) (map[idgen.ID]string, error) {
	out := map[idgen.ID]string{}
	if len(ids) == 0 {
		return out, nil
	}
	var cats []model.ModelCategory
	if err := r.db.Select("id", "name").Where("id IN ?", ids).Find(&cats).Error; err != nil {
		return nil, err
	}
	for i := range cats {
		out[cats[i].ID] = cats[i].Name
	}
	return out, nil
}

// authorDisplayName picks nickname, falling back to username, falling back to "".
func authorDisplayName(u *model.User) string {
	if n := strings.TrimSpace(u.Nickname); n != "" {
		return n
	}
	return strings.TrimSpace(u.Username)
}

// orderClause builds a safe ORDER BY from the sort key, whitelisting columns to
// avoid SQL injection. Defaults to newest-first.
func orderClause(sort string) string {
	switch sort {
	case "runs":
		return "use_count DESC, id DESC"
	case "name":
		return "name ASC, id DESC"
	case "new", "":
		return "create_time DESC, id DESC"
	default:
		return "create_time DESC, id DESC"
	}
}
