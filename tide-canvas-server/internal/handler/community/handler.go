package community

import (
	"errors"

	"github.com/gin-gonic/gin"

	"tidecanvas/internal/middleware"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/response"
)

// handler.go binds requests, invokes the service and writes the unified response
// envelope, mapping lookup errors to the frontend codes. Public reads pass the
// (possibly zero) current user id so the liked flag reflects an authed reader
// when a token is present, while remaining accessible anonymously.

type handler struct {
	svc *service
}

func newHandler(svc *service) *handler { return &handler{svc: svc} }

// feed handles GET /community/posts (public). Returns PageData<PostVO>.
func (h *handler) feed(c *gin.Context) {
	var q FeedQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid query: "+err.Error())
		return
	}
	q.normalize()

	viewerID := middleware.CurrentUserID(c)
	vos, total, err := h.svc.feed(viewerID, &q)
	if err != nil {
		response.Fail(c, response.CodeServerError, "failed to list posts")
		return
	}
	response.Page(c, vos, total, q.PageNum, q.PageSize)
}

// detail handles GET /community/posts/:id (public). Returns PostDetailVO.
func (h *handler) detail(c *gin.Context) {
	id, ok := parseID(c)
	if !ok {
		return
	}
	viewerID := middleware.CurrentUserID(c)
	vo, err := h.svc.detail(viewerID, id)
	if err != nil {
		h.fail(c, err, "failed to load post")
		return
	}
	response.OK(c, vo)
}

// like handles POST /community/posts/:id/like (auth). Returns {liked,likeCount}.
func (h *handler) like(c *gin.Context) {
	h.toggleLike(c, true)
}

// unlike handles DELETE /community/posts/:id/like (auth).
func (h *handler) unlike(c *gin.Context) {
	h.toggleLike(c, false)
}

// toggleLike is shared by like/unlike.
func (h *handler) toggleLike(c *gin.Context, like bool) {
	id, ok := parseID(c)
	if !ok {
		return
	}
	userID := middleware.CurrentUserID(c)
	vo, err := h.svc.setLike(userID, id, like)
	if err != nil {
		h.fail(c, err, "failed to update like")
		return
	}
	response.OK(c, vo)
}

// bookmark handles POST /community/posts/:id/bookmark (auth). Returns {bookmarked}.
func (h *handler) bookmark(c *gin.Context) {
	h.toggleBookmark(c, true)
}

// unbookmark handles DELETE /community/posts/:id/bookmark (auth).
func (h *handler) unbookmark(c *gin.Context) {
	h.toggleBookmark(c, false)
}

// toggleBookmark is shared by bookmark/unbookmark.
func (h *handler) toggleBookmark(c *gin.Context, bookmark bool) {
	id, ok := parseID(c)
	if !ok {
		return
	}
	userID := middleware.CurrentUserID(c)
	vo, err := h.svc.setBookmark(userID, id, bookmark)
	if err != nil {
		h.fail(c, err, "failed to update bookmark")
		return
	}
	response.OK(c, vo)
}

// authorProfile handles GET /community/users/:userId (public). AuthorProfileVO.
func (h *handler) authorProfile(c *gin.Context) {
	uid, ok := parseUserID(c)
	if !ok {
		return
	}
	viewerID := middleware.CurrentUserID(c)
	vo, err := h.svc.authorProfile(viewerID, uid)
	if err != nil {
		h.fail(c, err, "failed to load author")
		return
	}
	response.OK(c, vo)
}

// authorPosts handles GET /community/users/:userId/posts (public). PageData<PostVO>.
func (h *handler) authorPosts(c *gin.Context) {
	uid, ok := parseUserID(c)
	if !ok {
		return
	}
	var q PageQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid query: "+err.Error())
		return
	}
	q.normalize()

	viewerID := middleware.CurrentUserID(c)
	vos, total, err := h.svc.authorPosts(viewerID, uid, &q)
	if err != nil {
		h.fail(c, err, "failed to list author posts")
		return
	}
	response.Page(c, vos, total, q.PageNum, q.PageSize)
}

// comments handles GET /community/posts/:id/comments (public). PageData<CommentVO>.
func (h *handler) comments(c *gin.Context) {
	id, ok := parseID(c)
	if !ok {
		return
	}
	var q PageQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid query: "+err.Error())
		return
	}
	q.normalize()

	vos, total, err := h.svc.listComments(id, &q)
	if err != nil {
		h.fail(c, err, "failed to list comments")
		return
	}
	response.Page(c, vos, total, q.PageNum, q.PageSize)
}

// createComment handles POST /community/posts/:id/comments (auth). CommentVO.
func (h *handler) createComment(c *gin.Context) {
	id, ok := parseID(c)
	if !ok {
		return
	}
	var dto CommentCreateDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
		return
	}
	userID := middleware.CurrentUserID(c)
	vo, err := h.svc.createComment(userID, id, dto)
	if err != nil {
		h.fail(c, err, "failed to create comment")
		return
	}
	response.OK(c, vo)
}

// follow handles POST /follow/users/:userId (auth).
func (h *handler) follow(c *gin.Context) {
	h.toggleFollow(c, true)
}

// unfollow handles DELETE /follow/users/:userId (auth).
func (h *handler) unfollow(c *gin.Context) {
	h.toggleFollow(c, false)
}

// toggleFollow is shared by follow/unfollow.
func (h *handler) toggleFollow(c *gin.Context, follow bool) {
	target, err := idgen.Parse(c.Param("userId"))
	if err != nil || target == 0 {
		response.Fail(c, response.CodeBadRequest, "invalid user id")
		return
	}
	userID := middleware.CurrentUserID(c)
	if err := h.svc.follow(userID, target, follow); err != nil {
		response.Fail(c, response.CodeServerError, "failed to update follow")
		return
	}
	response.OK[any](c, nil)
}

// followers handles GET /follow/followers (auth). PageData<UserSimpleVO>.
func (h *handler) followers(c *gin.Context) {
	h.followList(c, true)
}

// following handles GET /follow/following (auth). PageData<UserSimpleVO>.
func (h *handler) following(c *gin.Context) {
	h.followList(c, false)
}

// followList is shared by followers/following.
func (h *handler) followList(c *gin.Context, followers bool) {
	var q PageQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid query: "+err.Error())
		return
	}
	q.normalize()

	userID := middleware.CurrentUserID(c)
	var (
		vos   []UserSimpleVO
		total int64
		err   error
	)
	if followers {
		vos, total, err = h.svc.followers(userID, &q)
	} else {
		vos, total, err = h.svc.following(userID, &q)
	}
	if err != nil {
		response.Fail(c, response.CodeServerError, "failed to list users")
		return
	}
	response.Page(c, vos, total, q.PageNum, q.PageSize)
}

// fail maps service errors to the appropriate response code.
func (h *handler) fail(c *gin.Context, err error, fallbackMsg string) {
	if errors.Is(err, ErrNotFound) {
		response.Fail(c, response.CodeNotFound, "post not found")
		return
	}
	response.Fail(c, response.CodeServerError, fallbackMsg)
}

// parseID extracts and validates the :id path param, writing a 400 on failure.
func parseID(c *gin.Context) (idgen.ID, bool) {
	id, err := idgen.Parse(c.Param("id"))
	if err != nil || id == 0 {
		response.Fail(c, response.CodeBadRequest, "invalid post id")
		return 0, false
	}
	return id, true
}

// parseUserID extracts and validates the :userId path param, writing a 400 on failure.
func parseUserID(c *gin.Context) (idgen.ID, bool) {
	id, err := idgen.Parse(c.Param("userId"))
	if err != nil || id == 0 {
		response.Fail(c, response.CodeBadRequest, "invalid user id")
		return 0, false
	}
	return id, true
}
