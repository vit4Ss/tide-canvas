// Package file owns file/asset routes (/api/files/*) plus their
// handler/service/repo/dto/vo. Uploads use pkg/storage (LocalStorage by
// default), persisting under the configured uploads dir and serving the bytes
// via the engine's /static route (see cmd/api/main.go). presign returns
// {direct:false} for local storage so the frontend's uploadFileSmart falls back
// to this server-mediated upload path.
package file

import (
	"time"

	"github.com/gin-gonic/gin"

	"tidecanvas/internal/app"
	"tidecanvas/internal/middleware"
	"tidecanvas/internal/pkg/response"
	"tidecanvas/internal/pkg/token"
)

// downloadTicketOrJWT lets an ordinary API fetch keep using Authorization,
// while a native browser navigation can use a short-lived file-bound ticket.
// Long-lived access tokens never enter URLs or browser history.
func downloadTicketOrJWT(d *app.Deps) gin.HandlerFunc {
	jwtAuth := middleware.JWTAuth(d)
	return func(c *gin.Context) {
		ticket := c.Query("ticket")
		if ticket == "" {
			jwtAuth(c)
			return
		}
		claims, err := token.ParseDownloadTicket(ticket, c.Query("url"), c.Query("name"))
		if err != nil {
			response.Fail(c, response.CodeUnauthorized, "invalid or expired download ticket")
			c.Abort()
			return
		}
		c.Set(middleware.CtxUserID, claims.UserID)
		c.Set(middleware.CtxRole, claims.Role)
		c.Set(middleware.CtxJTI, claims.ID)
		c.Header("Cache-Control", "private, no-store")
		c.Header("Referrer-Policy", "no-referrer")
		c.Next()
	}
}

// Register mounts the file routes on the /api group.
//
// Frontend contract (tide-canvas-web/src/lib/api.ts -> fileApi):
//
//	POST   /api/files/upload         multipart file        -> FileVO          (auth)
//	POST   /api/files/upload/batch   multipart files       -> FileVO[]        (auth)
//	POST   /api/files/presign        {filename,contentType,size,fileType?} -> FilePresignVO (auth)
//	POST   /api/files/register       {key,originalName,contentType,fileType?} -> FileVO (auth)
//	GET    /api/files                FileQuery -> PageData<FileVO>            (auth)
//	GET    /api/files/asset-size     ?url= -> AssetSizeVO                     (auth)
//	POST   /api/files/save-from-url  {url,fileType?,originalName?} -> FileVO   (auth)
//	POST   /api/files/download-ticket {url,name?} -> {url}                    (auth)
//	GET    /api/files/download       ?url=&name=&ticket= -> attachment         (auth or ticket)
//	GET    /api/files/detail/:id     -> FileVO                                (auth)
//	DELETE /api/files/detail/:id     -> void                                  (auth)
func Register(api *gin.RouterGroup, d *app.Deps) {
	h := newHandler(d)
	// Native browser downloads cannot attach Authorization headers. This leaf
	// accepts either the normal JWT or a two-minute, exact-file ticket issued by
	// the authenticated endpoint below.
	api.GET("/files/download", downloadTicketOrJWT(d), h.download)

	g := api.Group("/files")
	g.Use(middleware.JWTAuth(d))

	g.POST("/download-ticket", middleware.RateLimit(d, 60, time.Minute), h.issueDownloadTicket)
	g.POST("/upload", h.upload)
	g.POST("/upload/batch", h.uploadBatch)
	g.POST("/presign", h.presign)
	g.POST("/register", h.register)
	g.POST("/save-from-url", h.saveFromURL)
	// 每次查询都会打一次存储的 HEAD：限流挡住脚本式轮询（正常用法是多选确认
	// 时一批几个，60/分钟绰绰有余）。
	g.GET("/asset-size", middleware.RateLimit(d, 60, time.Minute), h.assetSize)
	g.GET("", h.list)
	// Item routes live under the static /detail parent so the :id param is never
	// a sibling of the static action routes above (gin panics on static/param
	// siblings at the same tree position).
	g.GET("/detail/:id", h.get)
	g.DELETE("/detail/:id", h.remove)
}
