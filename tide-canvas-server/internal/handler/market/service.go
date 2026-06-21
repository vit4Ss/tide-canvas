package market

import (
	"gorm.io/gorm"

	"tidecanvas/internal/pkg/idgen"
)

// service.go holds market business logic: catalog reads (with author/category
// name resolution) and the like/use interaction counters.

type service struct {
	repo *repo
}

func newService(db *gorm.DB) *service {
	return &service{repo: newRepo(db)}
}

// categories returns the visible category VOs.
func (s *service) categories() ([]ModelCategoryVO, error) {
	rows, err := s.repo.categories()
	if err != nil {
		return nil, err
	}
	vos := make([]ModelCategoryVO, 0, len(rows))
	for i := range rows {
		vos = append(vos, toCategoryVO(&rows[i]))
	}
	return vos, nil
}

// list returns a page of market-model VOs with author and category names
// resolved in batch (avoiding an N+1 query per row).
func (s *service) list(q *ListQuery) ([]MarketModelVO, int64, error) {
	rows, total, err := s.repo.list(q)
	if err != nil {
		return nil, 0, err
	}

	authorIDs := make([]idgen.ID, 0, len(rows))
	catIDs := make([]idgen.ID, 0, len(rows))
	for i := range rows {
		authorIDs = append(authorIDs, rows[i].AuthorID)
		if rows[i].CategoryID != nil {
			catIDs = append(catIDs, *rows[i].CategoryID)
		}
	}
	authors, err := s.repo.authorNames(authorIDs)
	if err != nil {
		return nil, 0, err
	}
	cats, err := s.repo.categoryNames(catIDs)
	if err != nil {
		return nil, 0, err
	}

	vos := make([]MarketModelVO, 0, len(rows))
	for i := range rows {
		catName := ""
		if rows[i].CategoryID != nil {
			catName = cats[*rows[i].CategoryID]
		}
		vos = append(vos, toMarketModelVO(&rows[i], authors[rows[i].AuthorID], catName))
	}
	return vos, total, nil
}

// get returns a single market-model VO with author/category names resolved.
func (s *service) get(id idgen.ID) (*MarketModelVO, error) {
	m, err := s.repo.findByID(id)
	if err != nil {
		return nil, err
	}

	authorName := ""
	if names, err := s.repo.authorNames([]idgen.ID{m.AuthorID}); err == nil {
		authorName = names[m.AuthorID]
	}
	catName := ""
	if m.CategoryID != nil {
		if names, err := s.repo.categoryNames([]idgen.ID{*m.CategoryID}); err == nil {
			catName = names[*m.CategoryID]
		}
	}

	vo := toMarketModelVO(m, authorName, catName)
	return &vo, nil
}

// like records a like for a model. The current schema has no per-user like
// table, so this increments the aggregate like_count (best-effort toggle is not
// possible without a join table; a plain increment matches the counter column).
func (s *service) like(id idgen.ID) error {
	return s.repo.incLikes(id, 1)
}

// use records a usage of a model, incrementing its use_count (the "runs" stat).
func (s *service) use(id idgen.ID) error {
	return s.repo.incUse(id)
}
