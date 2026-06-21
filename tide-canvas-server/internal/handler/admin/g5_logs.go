package admin

import (
	"github.com/gin-gonic/gin"

	"tidecanvas/internal/app"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/response"
)

// g5_logs.go: admin system/operation log viewer (model.SysLog), read-only paged
// list with optional level / module filters.

// LogVO is the list view of a system log entry.
type LogVO struct {
	ID         idgen.ID `json:"id"`
	Level      string   `json:"level"`
	Module     string   `json:"module"`
	Message    string   `json:"message"`
	IP         string   `json:"ip"`
	Operator   string   `json:"operator"`
	CreateTime string   `json:"createTime"`
}

func toLogVO(m *model.SysLog) LogVO {
	return LogVO{
		ID:         m.ID,
		Level:      m.Level,
		Module:     m.Module,
		Message:    m.Message,
		IP:         m.IP,
		Operator:   m.Operator,
		CreateTime: g5FmtTime(m.CreateTime),
	}
}

// RegisterLogs mounts the log admin route on the admin group.
//
//	GET /logs  g5PageQuery (level?, module?, keyword?) -> PageData<LogVO>
func RegisterLogs(g *gin.RouterGroup, d *app.Deps) {
	db := d.DB

	g.GET("/logs", func(c *gin.Context) {
		var q g5PageQuery
		if err := c.ShouldBindQuery(&q); err != nil {
			response.Fail(c, response.CodeBadRequest, "invalid query: "+err.Error())
			return
		}
		q.normalize()

		tx := db.Model(&model.SysLog{})
		if q.Level != "" {
			tx = tx.Where("level = ?", q.Level)
		}
		if q.Module != "" {
			tx = tx.Where("module = ?", q.Module)
		}
		if q.Keyword != "" {
			tx = tx.Where("message LIKE ? OR operator LIKE ?", "%"+q.Keyword+"%", "%"+q.Keyword+"%")
		}

		var total int64
		if err := tx.Count(&total).Error; err != nil {
			response.Fail(c, response.CodeServerError, "failed to count logs")
			return
		}
		var rows []model.SysLog
		if err := tx.Order("create_time DESC").Limit(q.PageSize).Offset(q.offset()).Find(&rows).Error; err != nil {
			response.Fail(c, response.CodeServerError, "failed to list logs")
			return
		}
		vos := make([]LogVO, 0, len(rows))
		for i := range rows {
			vos = append(vos, toLogVO(&rows[i]))
		}
		response.Page(c, vos, total, q.PageNum, q.PageSize)
	})
}
