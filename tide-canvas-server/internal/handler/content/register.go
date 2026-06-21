// Package content owns the public/promotional content surface plus per-user
// notifications: banners, the aggregated home feed, the blog, and the
// notification center. Structure mirrors internal/handler/project
// (register/handler/service/repo/dto/vo).
package content

import (
	"github.com/gin-gonic/gin"

	"tidecanvas/internal/app"
	"tidecanvas/internal/middleware"
)

// Register mounts the content routes on the /api group.
//
// Frontend contract:
//
//	GET    /api/banners                      ?position -> []BannerVO            (public)
//	GET    /api/home/feed                    -> HomeFeedVO                      (public)
//	GET    /api/blog/categories              -> []BlogCategoryVO               (public)
//	GET    /api/blog/articles                ArticleQuery -> PageData<ArticleVO>(public)
//	GET    /api/blog/articles/:id            -> ArticleDetailVO                 (public)
//	GET    /api/notifications                NotificationQuery -> PageData<...> (auth)
//	GET    /api/notifications/unread-count    -> { count }                      (auth)
//	POST   /api/notifications/items/:id/read  -> void                           (auth)
//	POST   /api/notifications/read-all         -> void                          (auth)
//	DELETE /api/notifications/items/:id        -> void                          (auth)
//
// Route layout keeps every :param under a static parent so gin never sees a
// static-vs-param sibling at the same tree position:
//   - blog: /blog/categories (static) and /blog/articles (static) with
//     /blog/articles/:id nested under the static /articles parent.
//   - notifications: /unread-count and /read-all are static; per-item ops live
//     under the static /items parent (/items/:id, /items/:id/read).
func Register(api *gin.RouterGroup, d *app.Deps) {
	svc := newService(d.DB)
	h := newHandler(svc)

	// Public banners. Admin CRUD lives elsewhere (admin surface).
	api.GET("/banners", h.listBanners) // ?position -> []BannerVO

	// Aggregated homepage feed (banners + recent works + hot models).
	home := api.Group("/home")
	home.GET("/feed", h.homeFeed) // -> HomeFeedVO

	// Public blog reads.
	blog := api.Group("/blog")
	blog.GET("/categories", h.listBlogCategories)  // -> []BlogCategoryVO
	blog.GET("/articles", h.listBlogArticles)      // paged -> PageData<ArticleVO>
	blog.GET("/articles/:id", h.getBlogArticle)    // -> ArticleDetailVO

	// Authenticated notification center.
	notif := api.Group("/notifications")
	notif.Use(middleware.JWTAuth(d))
	notif.GET("", h.listNotifications)                // paged -> PageData<NotificationVO>
	notif.GET("/unread-count", h.unreadCount)         // -> { count }
	notif.POST("/read-all", h.readAll)                // mark all read -> void
	notif.POST("/items/:id/read", h.readOne)          // mark one read -> void
	notif.DELETE("/items/:id", h.deleteOne)           // delete one -> void
}
