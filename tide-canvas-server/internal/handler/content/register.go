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
//	GET    /api/site/footer                  -> []FooterColVO                   (public)
//	GET    /api/site/floors                  -> []HomeFloorLiteVO               (public)
//	GET    /api/site/home-config             -> HomeGlobalVO                    (public)
//	GET    /api/home/feed                    -> HomeFeedVO                      (public)
//	GET    /api/home/work-covers             -> []string                        (public)
//	GET    /api/notifications                NotificationQuery -> PageData<...> (auth)
//	GET    /api/notifications/unread-count    -> { count }                      (auth)
//	POST   /api/notifications/items/:id/read  -> void                           (auth)
//	POST   /api/notifications/read-all         -> void                          (auth)
//	DELETE /api/notifications/items/:id        -> void                          (auth)
//
// Route layout keeps every :param under a static parent so gin never sees a
// static-vs-param sibling at the same tree position:
//   - notifications: /unread-count and /read-all are static; per-item ops live
//     under the static /items parent (/items/:id, /items/:id/read).
func Register(api *gin.RouterGroup, d *app.Deps) {
	svc := newService(d.DB)
	h := newHandler(svc)

	// 站点页脚链接：后台「配置管理」的 site.footerLinks 驱动，带出厂默认兜底。
	api.GET("/site/footer", h.footerLinks) // -> []FooterColVO
	// 首页楼层：后台「首页楼层」的启用/排序/数量驱动首页区块渲染。
	api.GET("/site/floors", h.siteFloors) // -> []HomeFloorLiteVO
	// 首页全局配置：后台「首页楼层」的背景流光/首屏 CTA，带出厂默认兜底。
	api.GET("/site/home-config", h.homeGlobal) // -> HomeGlobalVO

	// Aggregated homepage feed (recent works + hot models).
	home := api.Group("/home")
	home.GET("/feed", h.homeFeed)              // -> HomeFeedVO
	home.GET("/work-covers", h.homeWorkCovers) // -> []string

	// Blog（公开读取；写入面在后台 /admin/blog，自建 + Telegram 频道同步同表）。
	blog := api.Group("/blog")
	blog.GET("/posts", h.blogList)       // paged -> PageData<BlogPostLiteVO>
	blog.GET("/posts/:id", h.blogDetail) // -> BlogPostVO（草稿 404）

	// Authenticated notification center.
	notif := api.Group("/notifications")
	notif.Use(middleware.JWTAuth(d))
	notif.GET("", h.listNotifications)        // paged -> PageData<NotificationVO>
	notif.GET("/unread-count", h.unreadCount) // -> { count }
	notif.POST("/read-all", h.readAll)        // mark all read -> void
	notif.POST("/items/:id/read", h.readOne)  // mark one read -> void
	notif.DELETE("/items/:id", h.deleteOne)   // delete one -> void
}
