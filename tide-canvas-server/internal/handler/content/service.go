package content

import (
	"encoding/json"
	"strings"

	"gorm.io/gorm"

	"tidecanvas/internal/model"
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

// --- site footer ---

// FooterLinkVO is one footer link; FooterColVO one titled column of links.
type FooterLinkVO struct {
	Label string `json:"label"`
	Href  string `json:"href"`
}
type FooterColVO struct {
	Title string `json:"title"`
	Links []FooterLinkVO `json:"links"`
}

// footerLinks returns the admin-configured footer columns (sys_config
// site.footerLinks). A missing / unparseable value falls back to the factory
// default so the site footer is never empty.
func (s *service) footerLinks() []FooterColVO {
	raw, err := s.repo.configValue(model.ConfigKeyFooterLinks)
	if err != nil || strings.TrimSpace(raw) == "" {
		raw = model.DefaultFooterLinksJSON
	}
	if cols, ok := parseFooterCols(raw); ok {
		return cols
	}
	cols, _ := parseFooterCols(model.DefaultFooterLinksJSON)
	return cols
}

// parseFooterCols decodes + sanitizes the footer JSON: blank titles/labels/
// hrefs are dropped; ok=false when nothing usable remains.
func parseFooterCols(raw string) ([]FooterColVO, bool) {
	var cols []FooterColVO
	if json.Unmarshal([]byte(raw), &cols) != nil {
		return nil, false
	}
	out := make([]FooterColVO, 0, len(cols))
	for _, c := range cols {
		links := make([]FooterLinkVO, 0, len(c.Links))
		for _, l := range c.Links {
			if strings.TrimSpace(l.Label) != "" && strings.TrimSpace(l.Href) != "" {
				links = append(links, l)
			}
		}
		if strings.TrimSpace(c.Title) != "" && len(links) > 0 {
			out = append(out, FooterColVO{Title: c.Title, Links: links})
		}
	}
	if len(out) == 0 {
		return nil, false
	}
	return out, true
}

// --- site home floors ---

// HomeFloorLiteVO is the slim public view of one enabled homepage floor. Type
// is the machine key the homepage matches its sections on (英雄区/能力展示/
// 无限画布/作品流/模型跑马灯/FAQ/价格)；unknown types are delivered but the
// client ignores them.
type HomeFloorLiteVO struct {
	Type      string `json:"type"`
	Name      string `json:"name"`
	Count     int    `json:"count"`
	SortOrder int    `json:"sortOrder"`
}

// siteFloors returns the enabled homepage floors in display order (admin
// 首页楼层 managed; model.CanonicalHomeFloors keeps the rows in existence).
func (s *service) siteFloors() ([]HomeFloorLiteVO, error) {
	rows, err := s.repo.enabledFloors()
	if err != nil {
		return nil, err
	}
	vos := make([]HomeFloorLiteVO, 0, len(rows))
	for i := range rows {
		vos = append(vos, HomeFloorLiteVO{
			Type:      rows[i].Type,
			Name:      rows[i].Name,
			Count:     rows[i].Count,
			SortOrder: rows[i].SortOrder,
		})
	}
	return vos, nil
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
