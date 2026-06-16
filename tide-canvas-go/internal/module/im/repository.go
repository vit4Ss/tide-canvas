package im

import (
	"errors"
	"time"

	"gorm.io/gorm"

	"github.com/tidecanvas/tide-canvas-go/internal/model"
)

// Repository IM 数据访问（GORM）。
type Repository struct {
	db *gorm.DB
}

// NewRepository 构造。
func NewRepository(db *gorm.DB) *Repository { return &Repository{db: db} }

// DB 暴露底层连接（供 service 开事务）。
func (r *Repository) DB() *gorm.DB { return r.db }

// ConversationListItem 会话列表项（会话字段 + 当前用户的未读/已读位置）。
type ConversationListItem struct {
	model.ImConversation
	Unread     int   `gorm:"column:unread_count"`
	LastReadID int64 `gorm:"column:last_read_message_id"`
}

// ---------- 会话 ----------

// CreateConversation 新建会话（事务内）。
func (r *Repository) CreateConversation(tx *gorm.DB, c *model.ImConversation) error {
	return tx.Create(c).Error
}

// FindByID 按主键查会话，未找到返回 (nil, nil)。
func (r *Repository) FindByID(id int64) (*model.ImConversation, error) {
	var c model.ImConversation
	err := r.db.First(&c, id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &c, nil
}

// FindByPublicID 按对外ID查会话，未找到返回 (nil, nil)。
func (r *Repository) FindByPublicID(publicID string) (*model.ImConversation, error) {
	var c model.ImConversation
	err := r.db.Where("public_id = ?", publicID).First(&c).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &c, nil
}

// FindPrivateBetween 查两人之间已存在的私信会话（恰好 2 人），未找到返回 (nil, nil)。
func (r *Repository) FindPrivateBetween(userA, userB int64) (*model.ImConversation, error) {
	var c model.ImConversation
	err := r.db.
		Joins("JOIN im_conversation_member ma ON ma.conversation_id = im_conversation.id AND ma.user_id = ? AND ma.removed = 0", userA).
		Joins("JOIN im_conversation_member mb ON mb.conversation_id = im_conversation.id AND mb.user_id = ? AND mb.removed = 0", userB).
		Where("im_conversation.type = ? AND im_conversation.member_count = 2", model.ConvTypePrivate).
		First(&c).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &c, nil
}

// ListConversationsOfUser 当前用户参与的会话分页（按最后消息时间倒序，附带其未读数）。
// convType 为空则返回全部类型。
func (r *Repository) ListConversationsOfUser(userID int64, convType string, pageNum, pageSize int) ([]ConversationListItem, int64, error) {
	base := r.db.Table("im_conversation AS c").
		Joins("JOIN im_conversation_member m ON m.conversation_id = c.id AND m.user_id = ? AND m.removed = 0", userID).
		Where("c.deleted = 0")
	if convType != "" {
		base = base.Where("c.type = ?", convType)
	}

	var total int64
	if err := base.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var items []ConversationListItem
	err := base.Select("c.*, m.unread_count, m.last_read_message_id").
		Order("c.last_message_time DESC").
		Offset((pageNum - 1) * pageSize).
		Limit(pageSize).
		Scan(&items).Error
	if err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

// ListWaitingSupport 客服待接入会话分页（type=support 且 status=waiting，按创建时间升序，先到先接）。
func (r *Repository) ListWaitingSupport(pageNum, pageSize int) ([]model.ImConversation, int64, error) {
	base := r.db.Model(&model.ImConversation{}).
		Where("type = ? AND status = ?", model.ConvTypeSupport, model.SupportStatusWaiting)

	var total int64
	if err := base.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var rows []model.ImConversation
	err := base.Order("create_time ASC").
		Offset((pageNum - 1) * pageSize).
		Limit(pageSize).
		Find(&rows).Error
	if err != nil {
		return nil, 0, err
	}
	return rows, total, nil
}

// UpdateLastMessage 更新会话的最后消息冗余字段（事务内，列表排序/预览用）。
func (r *Repository) UpdateLastMessage(tx *gorm.DB, convID, msgID int64, text string, t time.Time) error {
	return tx.Model(&model.ImConversation{}).Where("id = ?", convID).
		Updates(map[string]interface{}{
			"last_message_id":   msgID,
			"last_message_text": text,
			"last_message_time": t,
		}).Error
}

// AssignSupport 客服接入：设置 assignee 与状态（仅当当前为待接入，避免并发抢占）。返回是否抢占成功。
func (r *Repository) AssignSupport(convID, agentID int64) (bool, error) {
	res := r.db.Model(&model.ImConversation{}).
		Where("id = ? AND type = ? AND status = ?", convID, model.ConvTypeSupport, model.SupportStatusWaiting).
		Updates(map[string]interface{}{"assignee_id": agentID, "status": model.SupportStatusActive})
	if res.Error != nil {
		return false, res.Error
	}
	return res.RowsAffected > 0, nil
}

// IncrMemberCount 调整会话成员数（事务内）。
func (r *Repository) IncrMemberCount(tx *gorm.DB, convID int64, delta int) error {
	return tx.Model(&model.ImConversation{}).Where("id = ?", convID).
		UpdateColumn("member_count", gorm.Expr("member_count + ?", delta)).Error
}

// ---------- 成员 ----------

// CreateMember 新增会话成员（事务内）。
func (r *Repository) CreateMember(tx *gorm.DB, m *model.ImConversationMember) error {
	return tx.Create(m).Error
}

// FindMember 查会话成员，未找到返回 (nil, nil)。
func (r *Repository) FindMember(convID, userID int64) (*model.ImConversationMember, error) {
	var m model.ImConversationMember
	err := r.db.Where("conversation_id = ? AND user_id = ?", convID, userID).First(&m).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &m, nil
}

// ListMemberUserIDs 列出会话所有有效成员的用户ID。
func (r *Repository) ListMemberUserIDs(convID int64) ([]int64, error) {
	var ids []int64
	err := r.db.Model(&model.ImConversationMember{}).
		Where("conversation_id = ? AND removed = 0", convID).
		Pluck("user_id", &ids).Error
	return ids, err
}

// IncrUnreadExcept 给会话内除发送者外的成员未读 +1（事务内）。
func (r *Repository) IncrUnreadExcept(tx *gorm.DB, convID, exceptUserID int64) error {
	return tx.Model(&model.ImConversationMember{}).
		Where("conversation_id = ? AND user_id <> ? AND removed = 0", convID, exceptUserID).
		UpdateColumn("unread_count", gorm.Expr("unread_count + 1")).Error
}

// ResetUnread 当前用户已读：清零未读并更新已读位置。
func (r *Repository) ResetUnread(convID, userID, lastReadMsgID int64) error {
	return r.db.Model(&model.ImConversationMember{}).
		Where("conversation_id = ? AND user_id = ?", convID, userID).
		Updates(map[string]interface{}{"unread_count": 0, "last_read_message_id": lastReadMsgID}).Error
}

// ---------- 消息 ----------

// CreateMessage 写入消息（事务内）。
func (r *Repository) CreateMessage(tx *gorm.DB, m *model.ImMessage) error {
	return tx.Create(m).Error
}

// FindMessageByPublicID 按对外ID查消息，未找到返回 (nil, nil)。
func (r *Repository) FindMessageByPublicID(publicID string) (*model.ImMessage, error) {
	var m model.ImMessage
	err := r.db.Where("public_id = ?", publicID).First(&m).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &m, nil
}

// ListMessages 会话消息历史（游标分页：beforeID=0 取最新一页，否则取 id<beforeID 的更早消息）。
// 返回按 id 倒序，service 负责按需反转为时间正序。
func (r *Repository) ListMessages(convID, beforeID int64, limit int) ([]model.ImMessage, error) {
	q := r.db.Where("conversation_id = ?", convID)
	if beforeID > 0 {
		q = q.Where("id < ?", beforeID)
	}
	var rows []model.ImMessage
	err := q.Order("id DESC").Limit(limit).Find(&rows).Error
	return rows, err
}

// RecallMessage 撤回消息（置状态为已撤回）。
func (r *Repository) RecallMessage(msgID int64) error {
	return r.db.Model(&model.ImMessage{}).Where("id = ?", msgID).
		Update("status", model.MsgStatusRecalled).Error
}

// ---------- 在线状态 ----------

// UpsertStatus 写入/更新用户在线状态与最后在线时间。
func (r *Repository) UpsertStatus(userID int64, online bool, lastSeen *time.Time) error {
	onlineVal := 0
	if online {
		onlineVal = 1
	}
	var existing model.ImUserStatus
	err := r.db.Where("user_id = ?", userID).First(&existing).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return r.db.Create(&model.ImUserStatus{UserID: userID, Online: onlineVal, LastSeenTime: lastSeen}).Error
	}
	if err != nil {
		return err
	}
	return r.db.Model(&model.ImUserStatus{}).Where("user_id = ?", userID).
		Updates(map[string]interface{}{"online": onlineVal, "last_seen_time": lastSeen}).Error
}

// ListStatus 批量查在线状态（用户ID → 状态）。
func (r *Repository) ListStatus(userIDs []int64) (map[int64]model.ImUserStatus, error) {
	out := make(map[int64]model.ImUserStatus)
	if len(userIDs) == 0 {
		return out, nil
	}
	var rows []model.ImUserStatus
	if err := r.db.Where("user_id IN ?", userIDs).Find(&rows).Error; err != nil {
		return nil, err
	}
	for i := range rows {
		out[rows[i].UserID] = rows[i]
	}
	return out, nil
}
