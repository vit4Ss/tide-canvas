package admin

// g5_notify.go — 消息管理（notification 表，与用户端通知中心同源）。
//
// LINKAGE：读写的就是 /api/notifications 用户端通知中心消费的同一张表——
// 后台发送的公告立即出现在创作台/后台的铃铛面板里，删除亦同步。
//
// Routes:
//
//	GET    /notifications        g5PageQuery (type?, keyword?, userId?) -> PageData<g5NotifyVO>
//	POST   /notifications        g5NotifySendDTO -> { sent }（target=all 广播 / user 定向）
//	DELETE /notifications/:id    -> void

import (
	"strings"

	"github.com/gin-gonic/gin"

	"tidecanvas/internal/app"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/response"
)

// g5NotifyVO is one notification row plus the recipient's display identity.
type g5NotifyVO struct {
	ID         idgen.ID `json:"id"`
	UserID     idgen.ID `json:"userId"`
	Username   string   `json:"username"`
	Email      string   `json:"email"`
	Type       string   `json:"type"`
	Title      string   `json:"title"`
	Content    string   `json:"content"`
	LinkURL    string   `json:"linkUrl"`
	IsRead     int      `json:"isRead"`
	CreateTime string   `json:"createTime"`
}

// g5NotifySendDTO is the send body. Target "all" broadcasts to every active
// user; "user" requires email (recipient lookup by login email).
type g5NotifySendDTO struct {
	Title   string `json:"title" binding:"required"`
	Content string `json:"content"`
	LinkURL string `json:"linkUrl"`
	Type    string `json:"type"`
	Target  string `json:"target"` // "all" | "user"
	Email   string `json:"email"`
}

// RegisterNotifications mounts the notification-admin routes on the
// (already admin-gated) group g.
func RegisterNotifications(g *gin.RouterGroup, d *app.Deps) {
	db := d.DB

	// 分页列表：LEFT JOIN users 带出接收者身份，便于运营排查。
	g.GET("/notifications", func(c *gin.Context) {
		var q g5PageQuery
		if err := c.ShouldBindQuery(&q); err != nil {
			response.Fail(c, response.CodeBadRequest, "invalid query: "+err.Error())
			return
		}
		q.normalize()

		tx := db.Table("notification AS n").
			Joins("LEFT JOIN users u ON u.id = n.user_id").
			Where("n.deleted IS NULL")
		if q.Type != "" {
			tx = tx.Where("n.type = ?", q.Type)
		}
		if q.UserID != "" {
			if uid, err := idgen.Parse(q.UserID); err == nil {
				tx = tx.Where("n.user_id = ?", uid)
			}
		}
		if q.Keyword != "" {
			kw := "%" + q.Keyword + "%"
			tx = tx.Where("n.title LIKE ? OR n.content LIKE ? OR u.username LIKE ? OR u.email LIKE ?", kw, kw, kw, kw)
		}

		var total int64
		if err := tx.Count(&total).Error; err != nil {
			response.Fail(c, response.CodeServerError, "failed to count notifications")
			return
		}
		var rows []struct {
			model.Notification
			Username string
			Email    string
		}
		if err := tx.Select("n.*, u.username AS username, u.email AS email").
			Order("n.create_time DESC").
			Limit(q.PageSize).Offset(q.offset()).
			Scan(&rows).Error; err != nil {
			response.Fail(c, response.CodeServerError, "failed to list notifications")
			return
		}
		vos := make([]g5NotifyVO, 0, len(rows))
		for i := range rows {
			r := &rows[i]
			vos = append(vos, g5NotifyVO{
				ID:         r.ID,
				UserID:     r.UserID,
				Username:   r.Username,
				Email:      r.Email,
				Type:       r.Type,
				Title:      r.Title,
				Content:    r.Content,
				LinkURL:    r.LinkURL,
				IsRead:     r.IsRead,
				CreateTime: g5FmtTime(r.CreateTime),
			})
		}
		response.Page(c, vos, total, q.PageNum, q.PageSize)
	})

	// 发送：target=all 给全部正常用户广播（每人一行）；target=user 按邮箱定向。
	g.POST("/notifications", func(c *gin.Context) {
		var dto g5NotifySendDTO
		if err := c.ShouldBindJSON(&dto); err != nil {
			response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
			return
		}
		dto.Title = strings.TrimSpace(dto.Title)
		if dto.Title == "" {
			response.Fail(c, response.CodeBadRequest, "标题不能为空")
			return
		}
		if dto.Type == "" {
			dto.Type = "system"
		}

		var userIDs []idgen.ID
		if dto.Target == "user" {
			email := strings.TrimSpace(dto.Email)
			if email == "" {
				response.Fail(c, response.CodeBadRequest, "定向发送需要指定用户邮箱")
				return
			}
			var u model.User
			if err := db.Where("email = ?", email).First(&u).Error; err != nil {
				response.Fail(c, response.CodeNotFound, "未找到该邮箱对应的用户")
				return
			}
			userIDs = []idgen.ID{u.ID}
		} else {
			if err := db.Model(&model.User{}).Where("status = ?", 1).Pluck("id", &userIDs).Error; err != nil {
				response.Fail(c, response.CodeServerError, "failed to resolve recipients")
				return
			}
		}
		if len(userIDs) == 0 {
			response.Fail(c, response.CodeBadRequest, "没有可发送的用户")
			return
		}

		rows := make([]model.Notification, 0, len(userIDs))
		for _, uid := range userIDs {
			rows = append(rows, model.Notification{
				UserID:  uid,
				Type:    dto.Type,
				Title:   dto.Title,
				Content: dto.Content,
				LinkURL: dto.LinkURL,
			})
		}
		if err := db.CreateInBatches(rows, 200).Error; err != nil {
			response.Fail(c, response.CodeServerError, "failed to send notifications")
			return
		}
		response.OK(c, gin.H{"sent": len(rows)})
	})

	g.DELETE("/notifications/:id", func(c *gin.Context) {
		id, ok := g5ParseID(c)
		if !ok {
			return
		}
		res := db.Delete(&model.Notification{}, "id = ?", id)
		if res.Error != nil {
			response.Fail(c, response.CodeServerError, "failed to delete notification")
			return
		}
		if res.RowsAffected == 0 {
			response.Fail(c, response.CodeNotFound, "notification not found")
			return
		}
		response.OK[any](c, nil)
	})
}
