package admin

import (
	"github.com/gin-gonic/gin"

	"tidecanvas/internal/app"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/response"
)

// cacheClearPatterns are the transient application-cache key patterns purged by
// POST /resources/cache/clear. Deliberately excludes auth:* (refresh tokens,
// blacklist, email codes) so clearing the cache never logs users out or breaks
// in-flight verification — only regenerable transient state is dropped.
var cacheClearPatterns = []string{
	"ai:task:*",   // transient AI task progress/state
	"ratelimit:*", // token-bucket rate-limit counters
}

// g5_resources.go: admin resource inventory (model.AdminResource), read-only
// paged list plus a cache-clear action (no-op so the screen's button succeeds).

// ResourceVO is the list view of a tracked platform resource.
type ResourceVO struct {
	ID         idgen.ID `json:"id"`
	Name       string   `json:"name"`
	Type       string   `json:"type"`
	Size       int64    `json:"size"`
	Refs       int      `json:"refs"`
	Status     string   `json:"status"`
	UpdateTime string   `json:"updateTime"`
}

func toResourceVO(m *model.AdminResource) ResourceVO {
	return ResourceVO{
		ID:         m.ID,
		Name:       m.Name,
		Type:       m.Type,
		Size:       m.Size,
		Refs:       m.Refs,
		Status:     m.Status,
		UpdateTime: g5FmtTime(m.UpdateTime),
	}
}

// RegisterResources mounts the resource admin routes on the admin group.
//
//	GET  /resources              g5PageQuery -> PageData<ResourceVO>
//	POST /resources/cache/clear  -> {cleared:true}
func RegisterResources(g *gin.RouterGroup, d *app.Deps) {
	db := d.DB

	r := g.Group("/resources")

	r.GET("", func(c *gin.Context) {
		var q g5PageQuery
		if err := c.ShouldBindQuery(&q); err != nil {
			response.Fail(c, response.CodeBadRequest, "invalid query: "+err.Error())
			return
		}
		q.normalize()

		tx := db.Model(&model.AdminResource{})
		if q.Keyword != "" {
			tx = tx.Where("name LIKE ?", "%"+q.Keyword+"%")
		}
		if q.Type != "" {
			tx = tx.Where("type = ?", q.Type)
		}
		if q.Status != "" {
			tx = tx.Where("status = ?", q.Status)
		}

		var total int64
		if err := tx.Count(&total).Error; err != nil {
			response.Fail(c, response.CodeServerError, "failed to count resources")
			return
		}
		var rows []model.AdminResource
		if err := tx.Order("create_time DESC").Limit(q.PageSize).Offset(q.offset()).Find(&rows).Error; err != nil {
			response.Fail(c, response.CodeServerError, "failed to list resources")
			return
		}
		vos := make([]ResourceVO, 0, len(rows))
		for i := range rows {
			vos = append(vos, toResourceVO(&rows[i]))
		}
		response.Page(c, vos, total, q.PageNum, q.PageSize)
	})

	// cache/clear purges transient application-cache keys (AI task state +
	// rate-limit counters) from Redis via SCAN, leaving auth/session keys intact.
	// Returns how many keys were removed.
	r.POST("/cache/clear", func(c *gin.Context) {
		if d.RDB == nil {
			response.OK(c, gin.H{"cleared": true, "keys": 0})
			return
		}
		ctx := c.Request.Context()
		var removed int64
		for _, pattern := range cacheClearPatterns {
			var cursor uint64
			for {
				keys, next, err := d.RDB.Scan(ctx, cursor, pattern, 200).Result()
				if err != nil {
					response.Fail(c, response.CodeServerError, "failed to scan cache keys")
					return
				}
				if len(keys) > 0 {
					n, err := d.RDB.Del(ctx, keys...).Result()
					if err != nil {
						response.Fail(c, response.CodeServerError, "failed to delete cache keys")
						return
					}
					removed += n
				}
				cursor = next
				if cursor == 0 {
					break
				}
			}
		}
		response.OK(c, gin.H{"cleared": true, "keys": removed})
	})
}
