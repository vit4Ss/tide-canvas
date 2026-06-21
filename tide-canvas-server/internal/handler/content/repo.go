package content

import (
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

// repo.go is the content domain's persistence layer over *gorm.DB.

// ErrNotFound is returned when a single-row lookup yields no row.
var ErrNotFound = errors.New("content: not found")

// Visibility / status constants shared by repo & service.
const (
	statusVisible   = 1 // banner / category / article published & shown
	postPublished   = 1 // community_post status: 已发布
	modelListed     = 1 // market_model status: 已上架
	articlePublished = 1 // blog_article status: 已发布

	notifUnread = 0
	notifRead   = 1
)

type repo struct {
	db *gorm.DB
}

func newRepo(db *gorm.DB) *repo { return &repo{db: db} }

// --- banners ---

// listBanners returns visible banners, optionally filtered by position, ordered
// by sort_order asc then newest first.
func (r *repo) listBanners(position string) ([]model.Banner, error) {
	tx := r.db.Model(&model.Banner{}).Where("status = ?", statusVisible)
	if position = strings.TrimSpace(position); position != "" {
		tx = tx.Where("position = ?", position)
	}
	var rows []model.Banner
	if err := tx.Order("sort_order ASC, create_time DESC").Find(&rows).Error; err != nil {
		return nil, err
	}
	return rows, nil
}

// --- home feed (live reads of other domains; tolerate empty) ---

// recentPosts returns the most recent published community posts (limit capped).
func (r *repo) recentPosts(limit int) ([]model.CommunityPost, error) {
	var rows []model.CommunityPost
	err := r.db.Model(&model.CommunityPost{}).
		Where("status = ?", postPublished).
		Order("create_time DESC").
		Limit(limit).
		Find(&rows).Error
	if err != nil {
		return nil, err
	}
	return rows, nil
}

// hotModels returns the hottest listed market models by use_count then like_count.
func (r *repo) hotModels(limit int) ([]model.MarketModel, error) {
	var rows []model.MarketModel
	err := r.db.Model(&model.MarketModel{}).
		Where("status = ?", modelListed).
		Order("use_count DESC, like_count DESC, create_time DESC").
		Limit(limit).
		Find(&rows).Error
	if err != nil {
		return nil, err
	}
	return rows, nil
}

// --- blog ---

// listBlogCategories returns visible categories ordered by sort_order asc.
func (r *repo) listBlogCategories() ([]model.BlogCategory, error) {
	var rows []model.BlogCategory
	err := r.db.Model(&model.BlogCategory{}).
		Where("status = ?", statusVisible).
		Order("sort_order ASC, create_time ASC").
		Find(&rows).Error
	if err != nil {
		return nil, err
	}
	return rows, nil
}

// listArticles returns a page of published articles plus the total count.
func (r *repo) listArticles(q *ArticleQuery) ([]model.BlogArticle, int64, error) {
	tx := r.db.Model(&model.BlogArticle{}).Where("status = ?", articlePublished)

	if q.CategoryID != "" {
		if cid, err := idgen.Parse(q.CategoryID); err == nil && cid != 0 {
			tx = tx.Where("category_id = ?", cid)
		}
	}
	if q.Keyword != "" {
		like := "%" + q.Keyword + "%"
		tx = tx.Where("title LIKE ? OR summary LIKE ?", like, like)
	}

	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var rows []model.BlogArticle
	err := tx.Order("publish_time DESC, create_time DESC").
		Limit(q.PageSize).Offset(q.offset()).
		Find(&rows).Error
	if err != nil {
		return nil, 0, err
	}
	return rows, total, nil
}

// findArticle loads a single published article by id.
func (r *repo) findArticle(id idgen.ID) (*model.BlogArticle, error) {
	var a model.BlogArticle
	err := r.db.Where("id = ? AND status = ?", id, articlePublished).First(&a).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &a, nil
}

// incrArticleView best-effort increments the view counter (errors ignored by
// the caller; not part of the read contract).
func (r *repo) incrArticleView(id idgen.ID) error {
	return r.db.Model(&model.BlogArticle{}).
		Where("id = ?", id).
		UpdateColumn("view_count", gorm.Expr("view_count + 1")).Error
}

// --- notifications (scoped to userID) ---

// listNotifications returns a page of the user's notifications plus the total.
func (r *repo) listNotifications(userID idgen.ID, q *NotificationQuery) ([]model.Notification, int64, error) {
	tx := r.db.Model(&model.Notification{}).Where("user_id = ?", userID)
	if q.Type != "" {
		tx = tx.Where("type = ?", q.Type)
	}
	if q.IsRead != nil {
		tx = tx.Where("is_read = ?", *q.IsRead)
	}

	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var rows []model.Notification
	err := tx.Order("create_time DESC").
		Limit(q.PageSize).Offset(q.offset()).
		Find(&rows).Error
	if err != nil {
		return nil, 0, err
	}
	return rows, total, nil
}

// unreadCount returns how many unread notifications the user has.
func (r *repo) unreadCount(userID idgen.ID) (int64, error) {
	var cnt int64
	err := r.db.Model(&model.Notification{}).
		Where("user_id = ? AND is_read = ?", userID, notifUnread).
		Count(&cnt).Error
	return cnt, err
}

// markRead marks one notification (scoped to user) as read. Returns ErrNotFound
// when no owned row matched.
func (r *repo) markRead(userID, id idgen.ID) error {
	now := time.Now()
	res := r.db.Model(&model.Notification{}).
		Where("id = ? AND user_id = ?", id, userID).
		Updates(map[string]any{"is_read": notifRead, "read_time": now})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

// markAllRead marks every unread notification of the user as read.
func (r *repo) markAllRead(userID idgen.ID) error {
	now := time.Now()
	return r.db.Model(&model.Notification{}).
		Where("user_id = ? AND is_read = ?", userID, notifUnread).
		Updates(map[string]any{"is_read": notifRead, "read_time": now}).Error
}

// deleteNotification soft-deletes one notification (scoped to user). Returns
// ErrNotFound when no owned row matched.
func (r *repo) deleteNotification(userID, id idgen.ID) error {
	res := r.db.Where("id = ? AND user_id = ?", id, userID).Delete(&model.Notification{})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}
