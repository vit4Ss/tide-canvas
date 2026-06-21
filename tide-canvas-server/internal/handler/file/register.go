// Package file owns file/asset routes (/api/files/*) plus their
// handler/service/repo/dto/vo. Uploads use pkg/storage (LocalStorage by
// default), persisting under the configured uploads dir and serving the bytes
// via the engine's /static route (see cmd/api/main.go). presign returns
// {direct:false} for local storage so the frontend's uploadFileSmart falls back
// to this server-mediated upload path.
package file

import (
	"github.com/gin-gonic/gin"

	"tidecanvas/internal/app"
	"tidecanvas/internal/middleware"
)

// Register mounts the file routes on the /api group.
//
// Frontend contract (tide-canvas-web/src/lib/api.ts -> fileApi):
//
//	POST   /api/files/upload         multipart file        -> FileVO          (auth)
//	POST   /api/files/upload/batch   multipart files       -> FileVO[]        (auth)
//	POST   /api/files/presign        {filename,contentType,fileType?} -> FilePresignVO (auth)
//	POST   /api/files/register       {key,originalName,contentType,fileType?} -> FileVO (auth)
//	GET    /api/files                FileQuery -> PageData<FileVO>            (auth)
//	POST   /api/files/save-from-url  {url,fileType?,originalName?} -> FileVO   (auth)
//	GET    /api/files/detail/:id     -> FileVO                                (auth)
//	DELETE /api/files/detail/:id     -> void                                  (auth)
func Register(api *gin.RouterGroup, d *app.Deps) {
	h := newHandler(d)

	// Public fetch-and-stream proxy (no auth — canvas runs without login).
	// Registered on its own group so it does NOT inherit JWTAuth below.
	api.Group("/files").GET("/download", h.download)

	g := api.Group("/files")
	g.Use(middleware.JWTAuth(d))

	g.POST("/upload", h.upload)
	g.POST("/upload/batch", h.uploadBatch)
	g.POST("/presign", h.presign)
	g.POST("/register", h.register)
	g.POST("/save-from-url", h.saveFromURL)
	g.GET("", h.list)
	// Item routes live under the static /detail parent so the :id param is never
	// a sibling of the static action routes above (gin panics on static/param
	// siblings at the same tree position).
	g.GET("/detail/:id", h.get)
	g.DELETE("/detail/:id", h.remove)
}
