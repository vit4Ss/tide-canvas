package content

import (
	"errors"
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
	statusVisible = 1 // banner / floor visible
	postPublished = 1 // community_post status: 已发布
	modelListed   = 1 // market_model status: 已上架

	notifUnread = 0
	notifRead   = 1
)

type repo struct {
	db *gorm.DB
}

func newRepo(db *gorm.DB) *repo { return &repo{db: db} }

// enabledFloors returns the enabled home floors in display order — the public
// homepage renders its sections from these rows (admin 首页楼层 managed).
func (r *repo) enabledFloors() ([]model.HomeFloor, error) {
	var rows []model.HomeFloor
	err := r.db.Where("enabled = ?", true).
		Order("sort_order ASC, create_time ASC").Find(&rows).Error
	if err != nil {
		return nil, err
	}
	return rows, nil
}

// configValue reads one sys_config value by key ("" when the key is unset).
func (r *repo) configValue(key string) (string, error) {
	var row model.SysConfig
	err := r.db.Select("config_value").Where("config_key = ?", key).First(&row).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", nil
		}
		return "", err
	}
	return row.ConfigValue, nil
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

// recentPostCovers returns only the usable cover URLs needed by smart-tool
// cards. Keeping this projection separate from homeFeed avoids loading post
// metadata and the unrelated model rail on every tools-page navigation.
func (r *repo) recentPostCovers(limit int) ([]string, error) {
	covers := make([]string, 0, limit)
	err := recentPostCoversScope(r.db, limit).Pluck("cover_url", &covers).Error
	return covers, err
}

func recentPostCoversScope(db *gorm.DB, limit int) *gorm.DB {
	return db.Model(&model.CommunityPost{}).
		Where("status = ? AND cover_url IS NOT NULL AND cover_url <> ''", postPublished).
		Order("create_time DESC").
		Limit(limit)
}

// hotPosts returns the hottest published community posts, ranked by a
// like/view weighted score then recency (limit capped). 作品流「实时热度」内容源
// 用它：热度 = 点赞*3 + 浏览，与 recentPosts（最新发布）并列为两个可选/可合并
// 的作品来源。
func (r *repo) hotPosts(limit int) ([]model.CommunityPost, error) {
	var rows []model.CommunityPost
	err := r.db.Model(&model.CommunityPost{}).
		Where("status = ?", postPublished).
		Order("(like_count * 3 + view_count) DESC, create_time DESC").
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
	if q.ActiveOnly {
		// 活跃过滤（紧急横幅用）：带截止时间的通知过期即不再返回；铃铛历史
		// 列表不带此参数，过期项仍可回看。
		tx = tx.Where("expire_time IS NULL OR expire_time > ?", time.Now())
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
