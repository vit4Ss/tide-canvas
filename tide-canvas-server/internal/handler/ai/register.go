// Package ai owns AI generation routes (/api/ai/*) plus their
// handler/service/repo/dto/vo.
package ai

import (
	"github.com/gin-gonic/gin"

	"tidecanvas/internal/app"
	"tidecanvas/internal/middleware"
)

// Register mounts the AI routes on the /api group.
//
// Frontend contract (tide-canvas-web/src/lib/api.ts -> aiApi):
//
//	POST   /api/ai/generate     AiGenerateDTO -> AiTaskVO                     (auth)
//	POST   /api/ai/grid-split   {imageUrl,rows,cols,cells?} -> string[]       (auth)
//	GET    /api/ai/tasks/:id     -> AiTaskVO                                  (auth)
//	DELETE /api/ai/tasks/:id     -> void                                      (auth)
//	GET    /api/ai/tasks         AiTaskQuery -> PageData<AiTaskVO>            (auth)
//	GET    /api/ai/models        -> AiModelVO[]                              (public catalog)
//	GET    /api/ai/handlers      -> AiHandlerVO[]                            (public catalog)
//	GET    /api/ai/logs          AiGenerationLogQuery -> PageData<AiGenerationLogVO> (auth; admins see all)
func Register(api *gin.RouterGroup, d *app.Deps) {
	h := newHandler(d)
	g := api.Group("/ai")

	// Public catalog endpoints (no auth — used by anonymous catalog views too).
	g.GET("/models", h.listModels)
	g.GET("/handlers", h.listHandlers)

	authed := g.Group("")
	authed.Use(middleware.JWTAuth(d))
	authed.POST("/generate", h.generate)
	authed.POST("/optimize-prompt", h.optimizePrompt)
	authed.POST("/grid-split", h.gridSplit)
	authed.GET("/tasks", h.listTasks)
	authed.GET("/tasks/:id", h.getTask)
	authed.DELETE("/tasks/:id", h.cancelTask)
	// Logs are auth-only; the service scopes results to the caller unless they
	// are an admin (then optional userId filter applies).
	authed.GET("/logs", h.listLogs)
}
