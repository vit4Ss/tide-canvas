// Package community owns the community / 作品广场 / inspiration-feed routes
// (/api/community/* and the social /api/follow/*) plus their
// handler/service/repo/dto/vo. It mirrors the structure & conventions of the
// project domain package.
package community

import (
	"strings"

	"github.com/gin-gonic/gin"

	"tidecanvas/internal/app"
	"tidecanvas/internal/middleware"
	"tidecanvas/internal/pkg/token"
)

// Register mounts the community routes on the /api group.
//
// Routes (the community product is publicly browsable; writes require auth):
//
//	GET    /api/community/posts                 [pub]  FeedQuery -> PageData<PostVO>
//	GET    /api/community/posts/:id             [pub]  -> PostDetailVO
//	POST   /api/community/posts/:id/like        [auth] -> {liked,likeCount}
//	DELETE /api/community/posts/:id/like        [auth] -> {liked,likeCount}
//	GET    /api/community/posts/:id/comments    [pub]  -> PageData<CommentVO>
//	POST   /api/community/posts/:id/comments    [auth] CommentCreateDTO -> CommentVO
//	POST   /api/follow/users/:userId            [auth] -> void
//	DELETE /api/follow/users/:userId            [auth] -> void
//	GET    /api/follow/followers                [auth] -> PageData<UserSimpleVO>
//	GET    /api/follow/following                [auth] -> PageData<UserSimpleVO>
//
// Public reads use optionalAuth so a logged-in viewer's liked flag is populated
// when a token is present, while anonymous readers are still served (no 401).
// Authed writes attach JWTAuth on the leaf route so they never collide with the
// public reads on the same /posts/:id sub-tree (gin requires consistent
// middleware along a path, applied per-route here to keep reads public).
func Register(api *gin.RouterGroup, d *app.Deps) {
	svc := newService(d.DB)
	h := newHandler(svc)

	opt := optionalAuth()
	auth := middleware.JWTAuth(d)

	// Community group. Public reads carry optionalAuth; the two write leaves add
	// JWTAuth in front so only those require a token.
	g := api.Group("/community")
	g.GET("/posts", opt, h.feed)
	g.GET("/posts/:id", opt, h.detail)
	g.GET("/posts/:id/comments", opt, h.comments)
	g.POST("/posts/:id/like", auth, h.like)
	g.DELETE("/posts/:id/like", auth, h.unlike)
	g.POST("/posts/:id/comments", auth, h.createComment)

	// Social follow graph — all authed. The :userId param lives under the static
	// /users parent so it is never a sibling of /followers and /following.
	f := api.Group("/follow")
	f.Use(auth)
	f.POST("/users/:userId", h.follow)
	f.DELETE("/users/:userId", h.unfollow)
	f.GET("/followers", h.followers)
	f.GET("/following", h.following)
}

// optionalAuth populates the current-user context from a Bearer token when one
// is present and valid, but never aborts: a missing/invalid token simply yields
// an anonymous request. Used on public reads so the liked flag reflects an
// authenticated viewer without forcing login.
func optionalAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		authz := c.GetHeader("Authorization")
		if strings.HasPrefix(authz, "Bearer ") {
			raw := strings.TrimSpace(strings.TrimPrefix(authz, "Bearer "))
			if raw != "" {
				if claims, err := token.ParseAccess(raw); err == nil {
					c.Set(middleware.CtxUserID, claims.UserID)
					c.Set(middleware.CtxRole, claims.Role)
					c.Set(middleware.CtxJTI, claims.JTI)
				}
			}
		}
		c.Next()
	}
}
