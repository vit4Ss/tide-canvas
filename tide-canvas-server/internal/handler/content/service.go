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
	// maxFloorWorks 是单个作品流楼层解析作品数的硬上限(挡住管理员超大 Count 配置)。
	maxFloorWorks = 50
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
	Title string         `json:"title"`
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

// --- site home global settings ---

// HomeGlobalVO is the public view of the homepage's global settings（后台
// 首页楼层「楼层全局配置」panel）: the 背景流光 shader defaults plus the
// hero's primary CTA. FluxPreset is a client-side palette key (aurora/nebula/
// ocean/ember/verdant/ink — the client falls back on unknown keys), and
// CtaTarget is a route key (studio/pricing) the client maps to a path.
type HomeGlobalVO struct {
	FluxPreset     string  `json:"fluxPreset"`
	FluxIntensity  float64 `json:"fluxIntensity"`
	FluxUserSwitch bool    `json:"fluxUserSwitch"`
	CtaLabel       string  `json:"ctaLabel"`
	CtaTarget      string  `json:"ctaTarget"`
}

// homeGlobal returns the admin-configured homepage globals (sys_config
// home.global). A missing / unparseable value falls back to the factory
// default so the homepage always gets a complete settings object.
func (s *service) homeGlobal() HomeGlobalVO {
	raw, err := s.repo.configValue(model.ConfigKeyHomeGlobal)
	if err != nil || strings.TrimSpace(raw) == "" {
		raw = model.DefaultHomeGlobalJSON
	}
	if vo, ok := parseHomeGlobal(raw); ok {
		return vo
	}
	vo, _ := parseHomeGlobal(model.DefaultHomeGlobalJSON)
	return vo
}

// parseHomeGlobal decodes + sanitizes the home.global JSON: intensity is
// clamped to the shader's usable 0–1.5 band, and blank strings fall back to
// the factory defaults so a partially-filled save never blanks the homepage.
func parseHomeGlobal(raw string) (HomeGlobalVO, bool) {
	var vo HomeGlobalVO
	if json.Unmarshal([]byte(raw), &vo) != nil {
		return HomeGlobalVO{}, false
	}
	if strings.TrimSpace(vo.FluxPreset) == "" {
		vo.FluxPreset = "aurora"
	}
	if vo.FluxIntensity <= 0 {
		vo.FluxIntensity = 0.78
	}
	if vo.FluxIntensity > 1.5 {
		vo.FluxIntensity = 1.5
	}
	if strings.TrimSpace(vo.CtaLabel) == "" {
		vo.CtaLabel = "生成"
	}
	if vo.CtaTarget != "pricing" {
		vo.CtaTarget = "studio"
	}
	return vo, true
}

// --- site home floors ---

// HomeFloorLiteVO is the slim public view of one enabled homepage floor. Type
// is the machine key the homepage matches its sections on (英雄区/能力展示/
// 无限画布/作品流/模型跑马灯/FAQ/价格)；unknown types are delivered but the
// client ignores them. Works is populated only for works-backed floors (作品流):
// the server resolves the floor's 内容源 (实时热度/最新发布, single or combined)
// into审核通过 works so the client just renders them.
type HomeFloorLiteVO struct {
	Type      string       `json:"type"`
	Name      string       `json:"name"`
	Count     int          `json:"count"`
	SortOrder int          `json:"sortOrder"`
	Works     []PostLiteVO `json:"works,omitempty"`
}

// floorTypeWorks is the only floor type that renders dynamic community works
// today (作品流); its 内容源 selects/combines the work sources below. Other floor
// types are static or draw from their own intrinsic source (模型跑马灯 = models),
// so they carry no 内容源.
const floorTypeWorks = "作品流"

// Valid 作品流 content sources. Stored on home_floor.content_source as a
// comma-separated key list ("hot" / "latest" / "hot,latest"), resolved in order.
const (
	floorSourceHot    = "hot"    // 实时热度：like*3 + view 加权
	floorSourceLatest = "latest" // 最新发布：create_time 倒序
)

// siteFloors returns the enabled homepage floors in display order (admin
// 首页楼层 managed; model.CanonicalHomeFloors keeps the rows in existence). For
// 作品流 floors it also resolves the configured 内容源 into审核通过 works.
func (s *service) siteFloors() ([]HomeFloorLiteVO, error) {
	rows, err := s.repo.enabledFloors()
	if err != nil {
		return nil, err
	}
	vos := make([]HomeFloorLiteVO, 0, len(rows))
	for i := range rows {
		vo := HomeFloorLiteVO{
			Type:      rows[i].Type,
			Name:      rows[i].Name,
			Count:     rows[i].Count,
			SortOrder: rows[i].SortOrder,
		}
		if rows[i].Type == floorTypeWorks {
			// 单个作品流楼层查询失败不应让整个首页楼层接口失败 —— 该楼层留空作品即可。
			if works, err := s.resolveFloorWorks(rows[i].ContentSource, rows[i].Count); err == nil {
				vo.Works = works
			}
		}
		vos = append(vos, vo)
	}
	return vos, nil
}

// resolveFloorWorks turns a 作品流 floor's 内容源 into a deduped slice of审核通过
// works, capped at count. Multiple sources are BLENDED by quota, not stacked:
// count is split evenly across the selected sources (e.g. "hot,latest" with
// count=8 → 4 hottest + 4 newest, deduped), so 组合来源真正体现两种口味而不是被
// 第一个来源占满。实时热度/最新发布抽的是同一批已发布作品、仅排序不同，若按
// 顺序填充组合会退化成纯热度——配额混合正是为此。去重/池子不足时按来源顺序回
// 填补齐。空/遗留内容源回退实时热度，未配置的楼层也有内容。
func (s *service) resolveFloorWorks(source string, count int) ([]PostLiteVO, error) {
	if count <= 0 {
		count = homeWorksLimit
	}
	if count > maxFloorWorks {
		count = maxFloorWorks // 防止管理员配置超大 Count → 超大 LIMIT/分配
	}
	sources := parseFloorSources(source)

	// 预取每个来源的作品池（每源最多 count，足够任意配额与回填）。
	pools := make([][]model.CommunityPost, 0, len(sources))
	for _, src := range sources {
		var (
			posts []model.CommunityPost
			err   error
		)
		switch src {
		case floorSourceHot:
			posts, err = s.repo.hotPosts(count)
		case floorSourceLatest:
			posts, err = s.repo.recentPosts(count)
		}
		if err != nil {
			return nil, err
		}
		pools = append(pools, posts)
	}

	seen := make(map[idgen.ID]bool, count)
	out := make([]PostLiteVO, 0, count)
	add := func(p *model.CommunityPost) bool {
		if len(out) >= count || seen[p.ID] {
			return false
		}
		seen[p.ID] = true
		out = append(out, toPostLiteVO(p))
		return true
	}

	// 配额混合：各来源均分 count（向上取整），按来源顺序各取其配额（去重）。
	perSource := (count + len(pools) - 1) / len(pools)
	for pi := range pools {
		taken := 0
		for i := range pools[pi] {
			if taken >= perSource || len(out) >= count {
				break
			}
			if add(&pools[pi][i]) {
				taken++
			}
		}
	}
	// 回填：配额上取整 + 去重可能没填满，按来源顺序补齐到 count。
	for pi := range pools {
		if len(out) >= count {
			break
		}
		for i := range pools[pi] {
			if len(out) >= count {
				break
			}
			add(&pools[pi][i])
		}
	}
	return out, nil
}

// parseFloorSources normalizes a comma-separated content_source into an ordered,
// deduped list of valid source keys. Legacy values from before 内容源 was wired
// map forward (auto→hot, manual→latest); anything unknown/empty falls back to
// 实时热度. 旧配置从未真正生效，这里在读取时归一化，无需破坏性数据迁移。
func parseFloorSources(raw string) []string {
	out := make([]string, 0, 2)
	seen := map[string]bool{}
	for _, p := range strings.Split(raw, ",") {
		p = strings.TrimSpace(p)
		switch p {
		case "auto":
			p = floorSourceHot
		case "manual":
			p = floorSourceLatest
		}
		if p != floorSourceHot && p != floorSourceLatest {
			continue
		}
		if seen[p] {
			continue
		}
		seen[p] = true
		out = append(out, p)
	}
	if len(out) == 0 {
		out = append(out, floorSourceHot)
	}
	return out
}

// --- home feed ---

// homeFeed aggregates recent community works and hot market models. Each
// section is read live and tolerates emptiness (always returns a non-nil
// slice). （运营推荐位 banners 已随「发现管理」一并下线，2026-07-09 用户拍板。）
func (s *service) homeFeed() (*HomeFeedVO, error) {
	feed := &HomeFeedVO{
		Works:  []PostLiteVO{},
		Models: []ModelLiteVO{},
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
