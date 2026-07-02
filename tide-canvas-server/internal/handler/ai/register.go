// Package ai owns AI generation routes (/api/ai/*) plus their
// handler/service/repo/dto/vo.
package ai

import (
	"context"
	"time"

	"github.com/gin-gonic/gin"

	"tidecanvas/internal/app"
	"tidecanvas/internal/middleware"
)

// staleTaskCutoff bounds how long a task may sit in Processing without an update
// before it's considered orphaned. Longer than the longest generation deadline
// (video ≈ 20m) and equal to the Redis task-state TTL, so a live task is never
// swept.
const staleTaskCutoff = 30 * time.Minute

// SweepStaleTasks reconciles tasks left in Processing by a prior crash/restart —
// their detached goroutine died, so nothing will ever write their terminal
// state. Call once at startup before serving. Returns the number reconciled.
func SweepStaleTasks(d *app.Deps) (int64, error) {
	r := newRepo(d.DB)
	cutoff := time.Now().Add(-staleTaskCutoff)
	return r.sweepStaleTasks(context.Background(), statusProcessing, statusFailed, cutoff,
		"generation interrupted (server restart)")
}

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
