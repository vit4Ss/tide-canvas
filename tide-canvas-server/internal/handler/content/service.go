package content

import (
	"gorm.io/gorm"

	"tidecanvas/internal/pkg/idgen"
)

// service.go holds content business logic: VO assembly for banners/blog/home
// feed and the user-scoped notification operations.

// Home feed rail sizes.
const (
	homeWorksLimit  = 8
	homeModelsLimit = 6
)

type service struct {
	repo *repo
}

func newService(db *gorm.DB) *service {
	return &service{repo: newRepo(db)}
}

// --- banners ---

func (s *service) listBanners(position string) ([]BannerVO, error) {
	rows, err := s.repo.listBanners(position)
	if err != nil {
		return nil, err
	}
	vos := make([]BannerVO, 0, len(rows))
	for i := range rows {
		vos = append(vos, toBannerVO(&rows[i]))
	}
	return vos, nil
}

// --- home feed ---

// homeFeed aggregates home_top banners, recent community works and hot market
// models. Each section is read live and tolerates emptiness (always returns a
// non-nil slice).
func (s *service) homeFeed() (*HomeFeedVO, error) {
	feed := &HomeFeedVO{
		Banners: []BannerVO{},
		Works:   []PostLiteVO{},
		Models:  []ModelLiteVO{},
	}

	// Banners for the home carousel (home_top placement).
	banners, err := s.repo.listBanners("home_top")
	if err != nil {
		return nil, err
	}
	for i := range banners {
		feed.Banners = append(feed.Banners, toBannerVO(&banners[i]))
	}

	// Recent published community posts as "works".
	posts, err := s.repo.recentPosts(homeWorksLimit)
	if err != nil {
		return nil, err
	}
	for i := range posts {
		feed.Works = append(feed.Works, toPostLiteVO(&posts[i]))
	}

	// Hot listed market models.
	models, err := s.repo.hotModels(homeModelsLimit)
	if err != nil {
		return nil, err
	}
	for i := range models {
		feed.Models = append(feed.Models, toModelLiteVO(&models[i]))
	}

	return feed, nil
}

// --- blog ---

func (s *service) listBlogCategories() ([]BlogCategoryVO, error) {
	rows, err := s.repo.listBlogCategories()
	if err != nil {
		return nil, err
	}
	vos := make([]BlogCategoryVO, 0, len(rows))
	for i := range rows {
		vos = append(vos, toBlogCategoryVO(&rows[i]))
	}
	return vos, nil
}

func (s *service) listArticles(q *ArticleQuery) ([]ArticleVO, int64, error) {
	rows, total, err := s.repo.listArticles(q)
	if err != nil {
		return nil, 0, err
	}
	vos := make([]ArticleVO, 0, len(rows))
	for i := range rows {
		vos = append(vos, toArticleVO(&rows[i]))
	}
	return vos, total, nil
}

func (s *service) getArticle(id idgen.ID) (*ArticleDetailVO, error) {
	a, err := s.repo.findArticle(id)
	if err != nil {
		return nil, err
	}
	// Best-effort view bump; failure does not affect the read.
	_ = s.repo.incrArticleView(id)
	a.ViewCount++ // reflect the bump in this response
	d := toArticleDetailVO(a)
	return &d, nil
}

// --- notifications ---

func (s *service) listNotifications(userID idgen.ID, q *NotificationQuery) ([]NotificationVO, int64, error) {
	rows, total, err := s.repo.listNotifications(userID, q)
	if err != nil {
		return nil, 0, err
	}
	vos := make([]NotificationVO, 0, len(rows))
	for i := range rows {
		vos = append(vos, toNotificationVO(&rows[i]))
	}
	return vos, total, nil
}

func (s *service) unreadCount(userID idgen.ID) (int64, error) {
	return s.repo.unreadCount(userID)
}

func (s *service) markRead(userID, id idgen.ID) error {
	return s.repo.markRead(userID, id)
}

func (s *service) markAllRead(userID idgen.ID) error {
	return s.repo.markAllRead(userID)
}

func (s *service) deleteNotification(userID, id idgen.ID) error {
	return s.repo.deleteNotification(userID, id)
}
