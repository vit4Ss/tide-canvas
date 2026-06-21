package community

import (
	"strings"

	"gorm.io/gorm"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

// service.go holds community business logic: assembling feed/detail VOs with
// their authors and the caller's liked flags, the like toggle, comment creation
// and the follow graph. The reader's user id may be 0 (anonymous) for public
// reads; liked is then always false.

type service struct {
	repo *repo
}

func newService(db *gorm.DB) *service { return &service{repo: newRepo(db)} }

// feed returns a page of post VOs. viewerID may be 0 (anonymous reader).
func (s *service) feed(viewerID idgen.ID, q *FeedQuery) ([]PostVO, int64, error) {
	rows, total, err := s.repo.listPosts(q)
	if err != nil {
		return nil, 0, err
	}
	if len(rows) == 0 {
		return []PostVO{}, total, nil
	}

	authorIDs := make([]idgen.ID, 0, len(rows))
	postIDs := make([]idgen.ID, 0, len(rows))
	for i := range rows {
		authorIDs = append(authorIDs, rows[i].UserID)
		postIDs = append(postIDs, rows[i].ID)
	}

	authors, err := s.repo.usersByIDs(authorIDs)
	if err != nil {
		return nil, 0, err
	}
	liked, err := s.repo.likedPostIDs(viewerID, postIDs)
	if err != nil {
		return nil, 0, err
	}

	vos := make([]PostVO, 0, len(rows))
	for i := range rows {
		p := &rows[i]
		vos = append(vos, toPostVO(p, authors[p.UserID], liked[p.ID]))
	}
	return vos, total, nil
}

// detail returns the full post detail VO. viewerID may be 0 (anonymous reader).
func (s *service) detail(viewerID, postID idgen.ID) (*PostDetailVO, error) {
	p, err := s.repo.findPost(postID)
	if err != nil {
		return nil, err
	}
	author, _ := s.repo.usersByIDs([]idgen.ID{p.UserID})
	liked, err := s.repo.isLiked(viewerID, postID)
	if err != nil {
		return nil, err
	}
	commentCount, err := s.repo.countComments(postID)
	if err != nil {
		return nil, err
	}
	d := toPostDetailVO(p, author[p.UserID], liked, commentCount)
	return &d, nil
}

// setLike toggles (or sets) the caller's like on a post and returns the new
// state. It validates the post exists first so a missing post is a 404 rather
// than a silent no-op.
func (s *service) setLike(userID, postID idgen.ID, like bool) (*LikeVO, error) {
	if _, err := s.repo.findPost(postID); err != nil {
		return nil, err
	}
	count, liked, err := s.repo.setLike(userID, postID, like)
	if err != nil {
		return nil, err
	}
	return &LikeVO{Liked: liked, LikeCount: count}, nil
}

// listComments returns a page of comment VOs for a post.
func (s *service) listComments(postID idgen.ID, q *PageQuery) ([]CommentVO, int64, error) {
	if _, err := s.repo.findPost(postID); err != nil {
		return nil, 0, err
	}
	rows, total, err := s.repo.listComments(postID, q)
	if err != nil {
		return nil, 0, err
	}
	if len(rows) == 0 {
		return []CommentVO{}, total, nil
	}

	authorIDs := make([]idgen.ID, 0, len(rows))
	for i := range rows {
		authorIDs = append(authorIDs, rows[i].UserID)
	}
	authors, err := s.repo.usersByIDs(authorIDs)
	if err != nil {
		return nil, 0, err
	}

	vos := make([]CommentVO, 0, len(rows))
	for i := range rows {
		cm := &rows[i]
		vos = append(vos, toCommentVO(cm, authors[cm.UserID]))
	}
	return vos, total, nil
}

// createComment posts a comment (optionally a reply) and returns its VO.
func (s *service) createComment(userID, postID idgen.ID, dto CommentCreateDTO) (*CommentVO, error) {
	if _, err := s.repo.findPost(postID); err != nil {
		return nil, err
	}

	var parentID *idgen.ID
	if strings.TrimSpace(dto.ParentID) != "" {
		pid, err := idgen.Parse(strings.TrimSpace(dto.ParentID))
		if err == nil && pid != 0 {
			parentID = &pid
		}
	}

	cm := &model.PostComment{
		BaseModel: model.BaseModel{ID: idgen.Next()},
		PostID:    postID,
		UserID:    userID,
		ParentID:  parentID,
		Content:   strings.TrimSpace(dto.Content),
		Status:    commentVisible,
	}
	if err := s.repo.createComment(cm); err != nil {
		return nil, err
	}

	author, _ := s.repo.usersByIDs([]idgen.ID{userID})
	vo := toCommentVO(cm, author[userID])
	return &vo, nil
}

// follow creates or removes a follow edge from the caller to targetID. Following
// yourself is a no-op (returns nil without writing).
func (s *service) follow(followerID, targetID idgen.ID, follow bool) error {
	if followerID == targetID {
		return nil
	}
	return s.repo.setFollow(followerID, targetID, follow)
}

// followers returns a page of users following the caller.
func (s *service) followers(userID idgen.ID, q *PageQuery) ([]UserSimpleVO, int64, error) {
	rows, total, err := s.repo.listFollowers(userID, q)
	if err != nil {
		return nil, 0, err
	}
	return toUserSimpleVOs(rows), total, nil
}

// following returns a page of users the caller follows.
func (s *service) following(userID idgen.ID, q *PageQuery) ([]UserSimpleVO, int64, error) {
	rows, total, err := s.repo.listFollowing(userID, q)
	if err != nil {
		return nil, 0, err
	}
	return toUserSimpleVOs(rows), total, nil
}

// toUserSimpleVOs maps user rows to the compact VO slice.
func toUserSimpleVOs(rows []model.User) []UserSimpleVO {
	vos := make([]UserSimpleVO, 0, len(rows))
	for i := range rows {
		vos = append(vos, toUserSimpleVO(&rows[i]))
	}
	return vos
}
