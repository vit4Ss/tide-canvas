package community

import (
	"errors"
	"strings"

	"gorm.io/gorm"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

// repo.go is the community domain's persistence layer over *gorm.DB. It covers
// the post feed/detail, the like toggle, comments and the follow graph, plus the
// batch author/liked lookups the service uses to assemble VOs without N+1 reads.

// ErrNotFound is returned when a post / comment lookup yields no row.
var ErrNotFound = errors.New("community: not found")

// statusPublished is the CommunityPost.Status value for a live post.
const statusPublished = 1

// commentVisible is the PostComment.Status value for a visible comment.
const commentVisible = 1

type repo struct {
	db *gorm.DB
}

func newRepo(db *gorm.DB) *repo { return &repo{db: db} }

// listPosts returns a page of published posts matching the feed query plus the
// total count. type filtering and category use the JSON metadata stored in the
// content column, so they are matched with a LIKE against that blob; keyword
// matches title/content/tags.
func (r *repo) listPosts(q *FeedQuery) ([]model.CommunityPost, int64, error) {
	tx := r.db.Model(&model.CommunityPost{}).Where("status = ?", statusPublished)

	if q.Type == "image" || q.Type == "video" {
		// The type lives in the content metadata blob as `"type":"image"`.
		tx = tx.Where("content LIKE ?", `%"type":"`+q.Type+`"%`)
	}
	if q.Cat != "" {
		tx = tx.Where("content LIKE ?", `%"cat":"`+escapeLike(q.Cat)+`"%`)
	}
	if q.Keyword != "" {
		like := "%" + escapeLike(q.Keyword) + "%"
		tx = tx.Where("title LIKE ? OR content LIKE ? OR tags LIKE ?", like, like, like)
	}

	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	tx = tx.Order(feedOrder(q.Sort))

	var rows []model.CommunityPost
	if err := tx.Limit(q.PageSize).Offset(q.offset()).Find(&rows).Error; err != nil {
		return nil, 0, err
	}
	return rows, total, nil
}

// findPost loads a published post by id.
func (r *repo) findPost(id idgen.ID) (*model.CommunityPost, error) {
	var p model.CommunityPost
	err := r.db.Where("id = ? AND status = ?", id, statusPublished).First(&p).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &p, nil
}

// usersByIDs loads the given users keyed by id for embedding as authors. Missing
// ids are simply absent from the map.
func (r *repo) usersByIDs(ids []idgen.ID) (map[idgen.ID]*model.User, error) {
	out := map[idgen.ID]*model.User{}
	if len(ids) == 0 {
		return out, nil
	}
	var users []model.User
	err := r.db.Select("id", "username", "nickname", "avatar").
		Where("id IN ?", ids).Find(&users).Error
	if err != nil {
		return nil, err
	}
	for i := range users {
		out[users[i].ID] = &users[i]
	}
	return out, nil
}

// likedPostIDs returns the subset of postIDs the given user has liked. Returns an
// empty set when userID is 0 (anonymous reader).
func (r *repo) likedPostIDs(userID idgen.ID, postIDs []idgen.ID) (map[idgen.ID]bool, error) {
	out := map[idgen.ID]bool{}
	if userID == 0 || len(postIDs) == 0 {
		return out, nil
	}
	var liked []idgen.ID
	err := r.db.Model(&model.PostLike{}).
		Where("user_id = ? AND post_id IN ?", userID, postIDs).
		Pluck("post_id", &liked).Error
	if err != nil {
		return nil, err
	}
	for _, id := range liked {
		out[id] = true
	}
	return out, nil
}

// isLiked reports whether the user has liked the single post.
func (r *repo) isLiked(userID, postID idgen.ID) (bool, error) {
	if userID == 0 {
		return false, nil
	}
	var count int64
	err := r.db.Model(&model.PostLike{}).
		Where("user_id = ? AND post_id = ?", userID, postID).Count(&count).Error
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

// setLike inserts or removes a like and adjusts the post's denormalized
// like_count atomically, returning the post's resulting like count and the new
// liked state. like=true ensures a like exists; like=false removes it. The
// operation is idempotent for the requested target state.
func (r *repo) setLike(userID, postID idgen.ID, like bool) (likeCount int, liked bool, err error) {
	err = r.db.Transaction(func(tx *gorm.DB) error {
		var existing model.PostLike
		findErr := tx.Where("user_id = ? AND post_id = ?", userID, postID).First(&existing).Error
		has := findErr == nil
		if findErr != nil && !errors.Is(findErr, gorm.ErrRecordNotFound) {
			return findErr
		}

		switch {
		case like && !has:
			row := &model.PostLike{PostID: postID, UserID: userID}
			if err := tx.Create(row).Error; err != nil {
				return err
			}
			if err := tx.Model(&model.CommunityPost{}).Where("id = ?", postID).
				UpdateColumn("like_count", gorm.Expr("like_count + 1")).Error; err != nil {
				return err
			}
		case !like && has:
			if err := tx.Where("user_id = ? AND post_id = ?", userID, postID).
				Delete(&model.PostLike{}).Error; err != nil {
				return err
			}
			if err := tx.Model(&model.CommunityPost{}).
				Where("id = ? AND like_count > 0", postID).
				UpdateColumn("like_count", gorm.Expr("like_count - 1")).Error; err != nil {
				return err
			}
		}

		var p model.CommunityPost
		if err := tx.Select("like_count").Where("id = ?", postID).First(&p).Error; err != nil {
			return err
		}
		likeCount = p.LikeCount
		return nil
	})
	return likeCount, like, err
}

// setBookmark inserts or removes the caller's bookmark (idempotent), returning
// the resulting bookmarked state.
func (r *repo) setBookmark(userID, postID idgen.ID, bookmark bool) (bool, error) {
	if bookmark {
		var existing model.PostBookmark
		err := r.db.Where("user_id = ? AND post_id = ?", userID, postID).First(&existing).Error
		if err == nil {
			return true, nil // already bookmarked
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return false, err
		}
		row := &model.PostBookmark{PostID: postID, UserID: userID}
		if err := r.db.Create(row).Error; err != nil {
			return false, err
		}
		return true, nil
	}
	if err := r.db.Where("user_id = ? AND post_id = ?", userID, postID).
		Delete(&model.PostBookmark{}).Error; err != nil {
		return false, err
	}
	return false, nil
}

// isBookmarked reports whether the user has bookmarked the post (false for anon).
func (r *repo) isBookmarked(userID, postID idgen.ID) (bool, error) {
	if userID == 0 {
		return false, nil
	}
	var n int64
	err := r.db.Model(&model.PostBookmark{}).
		Where("user_id = ? AND post_id = ?", userID, postID).Count(&n).Error
	return n > 0, err
}

// isFollowing reports whether followerID follows followeeID (false for anon/self).
func (r *repo) isFollowing(followerID, followeeID idgen.ID) (bool, error) {
	if followerID == 0 || followerID == followeeID {
		return false, nil
	}
	var n int64
	err := r.db.Model(&model.UserFollow{}).
		Where("follower_id = ? AND followee_id = ?", followerID, followeeID).Count(&n).Error
	return n > 0, err
}

// incrementViews bumps a post's view counter (best-effort; errors are ignored by
// the caller — a failed view bump must never break the detail read).
func (r *repo) incrementViews(postID idgen.ID) {
	_ = r.db.Model(&model.CommunityPost{}).Where("id = ?", postID).
		UpdateColumn("view_count", gorm.Expr("view_count + 1")).Error
}

// userByID loads one user with the fields a public profile needs.
func (r *repo) userByID(id idgen.ID) (*model.User, error) {
	var u model.User
	err := r.db.Select("id", "username", "nickname", "avatar", "create_time").
		Where("id = ?", id).First(&u).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &u, nil
}

// listUserPosts returns a page of a user's published posts (newest first).
func (r *repo) listUserPosts(userID idgen.ID, q *PageQuery) ([]model.CommunityPost, int64, error) {
	tx := r.db.Model(&model.CommunityPost{}).
		Where("user_id = ? AND status = ?", userID, statusPublished)

	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var rows []model.CommunityPost
	err := tx.Order("create_time DESC").
		Limit(q.PageSize).Offset(q.offset()).Find(&rows).Error
	if err != nil {
		return nil, 0, err
	}
	return rows, total, nil
}

// authorStats returns an author's published-works count, the sum of likes across
// those works, and their follower / following counts.
func (r *repo) authorStats(userID idgen.ID) (works, likes, followers, following int64, err error) {
	if err = r.db.Model(&model.CommunityPost{}).
		Where("user_id = ? AND status = ?", userID, statusPublished).
		Count(&works).Error; err != nil {
		return
	}
	if err = r.db.Model(&model.CommunityPost{}).
		Where("user_id = ? AND status = ?", userID, statusPublished).
		Select("COALESCE(SUM(like_count),0)").Scan(&likes).Error; err != nil {
		return
	}
	if err = r.db.Model(&model.UserFollow{}).
		Where("followee_id = ?", userID).Count(&followers).Error; err != nil {
		return
	}
	err = r.db.Model(&model.UserFollow{}).
		Where("follower_id = ?", userID).Count(&following).Error
	return
}

// countComments returns the number of visible comments on a post.
func (r *repo) countComments(postID idgen.ID) (int, error) {
	var n int64
	err := r.db.Model(&model.PostComment{}).
		Where("post_id = ? AND status = ?", postID, commentVisible).Count(&n).Error
	return int(n), err
}

// listComments returns a page of visible comments (newest first) plus the total.
func (r *repo) listComments(postID idgen.ID, q *PageQuery) ([]model.PostComment, int64, error) {
	tx := r.db.Model(&model.PostComment{}).
		Where("post_id = ? AND status = ?", postID, commentVisible)

	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var rows []model.PostComment
	err := tx.Order("create_time DESC").
		Limit(q.PageSize).Offset(q.offset()).Find(&rows).Error
	if err != nil {
		return nil, 0, err
	}
	return rows, total, nil
}

// createComment inserts a comment and bumps the post's comment_count. It returns
// the persisted row (with generated id + timestamps).
func (r *repo) createComment(cm *model.PostComment) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(cm).Error; err != nil {
			return err
		}
		return tx.Model(&model.CommunityPost{}).Where("id = ?", cm.PostID).
			UpdateColumn("comment_count", gorm.Expr("comment_count + 1")).Error
	})
}

// setFollow creates or removes a follow edge (follower -> followee). It is
// idempotent for the requested state.
func (r *repo) setFollow(followerID, followeeID idgen.ID, follow bool) error {
	if follow {
		var existing model.UserFollow
		err := r.db.Where("follower_id = ? AND followee_id = ?", followerID, followeeID).
			First(&existing).Error
		if err == nil {
			return nil // already following
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		row := &model.UserFollow{FollowerID: followerID, FolloweeID: followeeID}
		return r.db.Create(row).Error
	}
	return r.db.Where("follower_id = ? AND followee_id = ?", followerID, followeeID).
		Delete(&model.UserFollow{}).Error
}

// listFollowers returns a page of users who follow followeeID.
func (r *repo) listFollowers(followeeID idgen.ID, q *PageQuery) ([]model.User, int64, error) {
	return r.followGraph("followee_id", "follower_id", followeeID, q)
}

// listFollowing returns a page of users that followerID follows.
func (r *repo) listFollowing(followerID idgen.ID, q *PageQuery) ([]model.User, int64, error) {
	return r.followGraph("follower_id", "followee_id", followerID, q)
}

// followGraph is the shared paging query for followers/following. matchCol is the
// side of the edge equal to the subject; selectCol is the side whose users are
// returned.
func (r *repo) followGraph(matchCol, selectCol string, subject idgen.ID, q *PageQuery) ([]model.User, int64, error) {
	edge := r.db.Model(&model.UserFollow{}).Where(matchCol+" = ?", subject)

	var total int64
	if err := edge.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if total == 0 {
		return nil, 0, nil
	}

	var ids []idgen.ID
	err := r.db.Model(&model.UserFollow{}).
		Where(matchCol+" = ?", subject).
		Order("create_time DESC").
		Limit(q.PageSize).Offset(q.offset()).
		Pluck(selectCol, &ids).Error
	if err != nil {
		return nil, 0, err
	}
	if len(ids) == 0 {
		return nil, total, nil
	}

	usersByID, err := r.usersByIDs(ids)
	if err != nil {
		return nil, 0, err
	}
	// Preserve the follow-recency order from ids.
	out := make([]model.User, 0, len(ids))
	for _, id := range ids {
		if u := usersByID[id]; u != nil {
			out = append(out, *u)
		}
	}
	return out, total, nil
}

// feedOrder builds a safe ORDER BY for the feed from a whitelisted sort key.
func feedOrder(sort string) string {
	switch sort {
	case "hot":
		// Hot blends likes + comments + views with recency as the tiebreaker.
		return "(like_count * 3 + comment_count * 2 + view_count) DESC, create_time DESC"
	case "like":
		return "like_count DESC, create_time DESC"
	default: // "new" or unspecified
		return "create_time DESC"
	}
}

// escapeLike escapes the LIKE wildcards so user input is matched literally.
func escapeLike(s string) string {
	r := strings.NewReplacer("\\", "\\\\", "%", "\\%", "_", "\\_")
	return r.Replace(s)
}
