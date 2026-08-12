// Package ai owns AI generation routes (/api/ai/*) plus their
// handler/service/repo/dto/vo.
package ai

import (
	"context"
	"time"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"

	"tidecanvas/internal/app"
	"tidecanvas/internal/middleware"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/logger"
)

// staleTaskCutoff bounds how long a task may sit in Processing without an update
// before it's considered orphaned. Longer than the longest generation deadline
// (video ≈ 20m) and equal to the Redis task-state TTL, so a live task is never
// swept.
const staleTaskCutoff = 30 * time.Minute
const taskReconcileInterval = time.Minute

// SweepStaleTasks reconciles tasks left in Processing by a prior crash/restart —
// their detached goroutine died, so nothing will ever write their terminal
// state. It is safe to call from startup and the periodic reconciler: terminal
// transitions use status predicates and refunds use a durable exactly-once row.
// Returns the number reconciled.
func SweepStaleTasks(d *app.Deps) (int64, error) {
	r := newRepo(d.DB)
	now := time.Now()
	cutoff := now.Add(-staleTaskCutoff)
	ctx := context.Background()
	const interruptedMessage = "generation interrupted (server restart)"

	// A SkillRun action commits its cancellation receipt before making best-
	// effort provider/task cancellation calls. Reconcile any child task that was
	// still Processing when that call transiently failed; runTask's terminal CAS
	// will then drop a late upstream result and the refund pass below repairs the
	// charge exactly once.
	cancelledRuns := d.DB.WithContext(ctx).Model(&model.SkillRun{}).Select("id").Where("status = ?", model.SkillRunCancelled)
	// Preserve cancelTask's billing boundary: queued children are refundable,
	// while dispatched children are settled so recovery cannot turn an already
	// issued provider call into free work.
	cancelledQueued := d.DB.WithContext(ctx).Model(&model.AiTask{}).
		Where("status = ? AND progress < ? AND skill_run_id <> 0 AND skill_run_id IN (?)", statusProcessing, 30, cancelledRuns).
		Updates(map[string]any{"status": statusCancelled, "progress": 100, "error_msg": "generation cancelled by skill run",
			"update_time": now, "complete_time": now})
	if cancelledQueued.Error != nil {
		return 0, cancelledQueued.Error
	}
	cancelledStarted := d.DB.WithContext(ctx).Model(&model.AiTask{}).
		Where("status = ? AND progress >= ? AND skill_run_id <> 0 AND skill_run_id IN (?)", statusProcessing, 30, cancelledRuns).
		Updates(map[string]any{"status": statusCancelled, "progress": 100, "refunded": true,
			"error_msg": "generation cancelled by skill run", "update_time": now, "complete_time": now})
	if cancelledStarted.Error != nil {
		return cancelledQueued.RowsAffected, cancelledStarted.Error
	}

	n, err := r.sweepStaleTasks(ctx, statusProcessing, statusFailed, cutoff,
		interruptedMessage)
	n += cancelledQueued.RowsAffected + cancelledStarted.RowsAffected
	if err != nil {
		return n, err
	}

	// Reconcile every failed/cancelled charged task, not only rows transitioned by
	// this stale sweep. This repairs transient refund failures and process crashes
	// between a terminal status commit and its refund. Unscoped includes a small
	// amount of legacy data deleted before refund completion.
	var pending []model.AiTask
	if qerr := d.DB.WithContext(ctx).Unscoped().Select("id", "user_id", "status", "point_cost", "refunded").
		Where("status IN ? AND refunded = ? AND point_cost > 0", []int{statusFailed, statusCancelled}, false).
		Order("update_time ASC, id ASC").
		Limit(1000).Find(&pending).Error; qerr != nil {
		return n, qerr
	}
	for i := range pending {
		t := &pending[i]
		if rerr := refundTaskOnce(d.DB, t.ID, "generation terminal-state recovery refund"); rerr != nil {
			logger.L().Warn("ai: sweep refund failed",
				zap.String("taskId", t.ID.String()), zap.Error(rerr))
		}
	}
	return n, nil
}

// StartTaskReconciler retries terminal refunds and stale-task recovery without
// coupling AI correctness to the SkillRun scheduler. The initial pass runs in
// this worker rather than on the startup goroutine, and the periodic ticker is
// created only after that pass completes so two sweeps never overlap.
func StartTaskReconciler(ctx context.Context, d *app.Deps) {
	if d == nil || d.DB == nil {
		return
	}
	go func() {
		if n, err := SweepStaleTasks(d); err != nil {
			logger.L().Warn("ai: startup task reconciliation failed", zap.Error(err))
		} else if n > 0 {
			logger.L().Info("ai: reconciled stale tasks", zap.Int64("count", n))
		}

		ticker := time.NewTicker(taskReconcileInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if n, err := SweepStaleTasks(d); err != nil {
					logger.L().Warn("ai: periodic task reconciliation failed", zap.Error(err))
				} else if n > 0 {
					logger.L().Info("ai: periodically reconciled tasks", zap.Int64("count", n))
				}
			}
		}
	}()
}

// Register mounts the AI routes on the /api group.
//
// Frontend contract (tide-canvas-web/src/lib/api.ts -> aiApi):
//
//	POST   /api/ai/generate     AiGenerateDTO -> AiTaskVO                     (auth)
//	POST   /api/ai/upscale-quote -> authoritative duration/rate/point quote    (auth)
//	GET    /api/ai/optimize-cost -> {cost:int}                                (auth)
//	POST   /api/ai/grid-split   {imageUrl,rows,cols,cells?} -> string[]       (auth)
//	POST   /api/ai/tasks/frame-capture capturedFrameDTO -> AiTaskVO          (auth)
//	GET    /api/ai/tasks/:id     -> AiTaskVO                                  (auth)
//	DELETE /api/ai/tasks/:id     -> void                                      (auth)
//	GET    /api/ai/tasks         AiTaskQuery -> PageData<AiTaskVO>            (auth)
//	GET    /api/ai/models        -> AiModelVO[]                              (public catalog)
//	GET    /api/ai/handlers      -> AiHandlerVO[]                            (public catalog)
//	GET    /api/ai/tools         -> AiToolVO[]                               (public catalog; 启用且有独立页的智能工具)
//	GET    /api/ai/logs          AiGenerationLogQuery -> PageData<AiGenerationLogVO> (auth; admins see all)
func Register(api *gin.RouterGroup, d *app.Deps) {
	h := newHandler(d)
	g := api.Group("/ai")

	// Public catalog endpoints (no auth — used by anonymous catalog views too).
	g.GET("/models", h.listModels)
	g.GET("/handlers", h.listHandlers)
	g.GET("/tools", h.listSiteTools)

	authed := g.Group("")
	authed.Use(middleware.JWTAuth(d))
	authed.POST("/generate", h.generate)
	authed.POST("/upscale-quote", h.upscaleQuote)
	authed.POST("/optimize-prompt", h.optimizePrompt)
	authed.GET("/optimize-cost", h.optimizeCost)
	authed.POST("/grid-split", h.gridSplit)
	authed.POST("/tasks/frame-capture", h.registerCapturedFrame)
	authed.GET("/tasks", h.listTasks)
	authed.GET("/tasks/:id", h.getTask)
	authed.DELETE("/tasks/:id", h.cancelTask)
	// Logs are auth-only; the service scopes results to the caller unless they
	// are an admin (then optional userId filter applies).
	authed.GET("/logs", h.listLogs)
}
