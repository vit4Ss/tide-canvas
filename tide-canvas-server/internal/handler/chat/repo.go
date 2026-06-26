package chat

import (
	"errors"
	"time"

	"gorm.io/gorm"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

// repo.go is the chat domain's persistence layer over *gorm.DB.

// ErrNotFound is returned when a conversation lookup yields no row.
var ErrNotFound = errors.New("chat: not found")

type repo struct {
	db *gorm.DB
}

func newRepo(db *gorm.DB) *repo { return &repo{db: db} }

// textModelKey returns the upstream model id (model_key) to use for the chat
// assistant: the listed text model flagged as the AI-optimization primary if one
// exists, otherwise any listed text model. "" when none is configured.
func (r *repo) textModelKey() string {
	const base = "type = ? AND status = 1 AND model_key <> ''"
	var m model.MarketModel
	if err := r.db.Where(base, "text").
		Where("config LIKE ?", `%"aiOptimizePrimary":true%`).
		Order("update_time DESC").First(&m).Error; err == nil && m.ModelKey != "" {
		return m.ModelKey
	}
	if err := r.db.Where(base, "text").Order("update_time DESC").First(&m).Error; err == nil {
		return m.ModelKey
	}
	return ""
}

// listConversations returns a page of the owner's conversations plus the total
// count, ordered by the most recent activity first (last_message_at desc, then
// create_time desc as a tie-breaker for never-used conversations).
func (r *repo) listConversations(ownerID idgen.ID, q *ListQuery) ([]model.IMConversation, int64, error) {
	tx := r.db.Model(&model.IMConversation{}).Where("owner_id = ?", ownerID)

	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var rows []model.IMConversation
	if err := tx.
		Order("last_message_at DESC").
		Order("create_time DESC").
		Limit(q.PageSize).Offset(q.offset()).
		Find(&rows).Error; err != nil {
		return nil, 0, err
	}
	return rows, total, nil
}

// findConversation loads a conversation by primary key (any owner). Ownership is
// enforced in the service.
func (r *repo) findConversation(id idgen.ID) (*model.IMConversation, error) {
	var c model.IMConversation
	err := r.db.Where("id = ?", id).First(&c).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &c, nil
}

// createConversation inserts a new conversation.
func (r *repo) createConversation(c *model.IMConversation) error {
	return r.db.Create(c).Error
}

// updateConversationTitle renames a conversation.
func (r *repo) updateConversationTitle(id idgen.ID, title string) error {
	return r.db.Model(&model.IMConversation{}).Where("id = ?", id).Update("title", title).Error
}

// deleteConversation removes a conversation along with its messages and member
// rows in one transaction.
func (r *repo) deleteConversation(id idgen.ID) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("conversation_id = ?", id).Delete(&model.IMMessage{}).Error; err != nil {
			return err
		}
		if err := tx.Where("conversation_id = ?", id).Delete(&model.IMConversationMember{}).Error; err != nil {
			return err
		}
		return tx.Delete(&model.IMConversation{}, "id = ?", id).Error
	})
}

// createMessageMember registers a user as the owner-member (role 2 = 群主) of a
// conversation. The (conversation_id, user_id) pair is unique, so a duplicate is
// tolerated as a no-op.
func (r *repo) createMessageMember(conversationID, userID idgen.ID) error {
	m := &model.IMConversationMember{
		ConversationID: conversationID,
		UserID:         userID,
		Role:           2,
	}
	return r.db.Where(model.IMConversationMember{
		ConversationID: conversationID,
		UserID:         userID,
	}).FirstOrCreate(m).Error
}

// listMessages returns a page of a conversation's messages plus the total count,
// oldest first so the chat transcript renders top-to-bottom.
func (r *repo) listMessages(conversationID idgen.ID, q *ListQuery) ([]model.IMMessage, int64, error) {
	tx := r.db.Model(&model.IMMessage{}).Where("conversation_id = ?", conversationID)

	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var rows []model.IMMessage
	if err := tx.
		Order("create_time ASC").
		Order("id ASC").
		Limit(q.PageSize).Offset(q.offset()).
		Find(&rows).Error; err != nil {
		return nil, 0, err
	}
	return rows, total, nil
}

// createMessage inserts a single message.
func (r *repo) createMessage(m *model.IMMessage) error {
	return r.db.Create(m).Error
}

// createTurn atomically inserts a 生成台 turn's two messages (user prompt +
// assistant task pointer). Ids are snowflake-assigned on insert; the assistant
// row's larger id keeps it ordered after the user row (studio-design §9.2).
func (r *repo) createTurn(userMsg, aiMsg *model.IMMessage) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(userMsg).Error; err != nil {
			return err
		}
		return tx.Create(aiMsg).Error
	})
}

// tasksByIDs batch-loads the generation tasks referenced by 生成台 assistant
// messages, selecting ONLY the columns the message VO renders — the AiTask row
// also carries large input/result blobs we must not pull every poll (§9.3).
func (r *repo) tasksByIDs(ids []idgen.ID) (map[idgen.ID]*model.AiTask, error) {
	out := make(map[idgen.ID]*model.AiTask, len(ids))
	if len(ids) == 0 {
		return out, nil
	}
	var rows []model.AiTask
	if err := r.db.Model(&model.AiTask{}).
		Select("id", "status", "progress", "result_url", "result_meta", "error_msg").
		Where("id IN ?", ids).
		Find(&rows).Error; err != nil {
		return nil, err
	}
	for i := range rows {
		out[rows[i].ID] = &rows[i]
	}
	return out, nil
}

// recentMessages returns up to limit of a conversation's most recent messages in
// chronological (oldest-first) order, for use as LLM context. It fetches the
// newest `limit` rows (DESC) then reverses them so the transcript reads forward.
func (r *repo) recentMessages(conversationID idgen.ID, limit int) ([]model.IMMessage, error) {
	if limit <= 0 {
		limit = 20
	}
	var rows []model.IMMessage
	if err := r.db.
		Where("conversation_id = ?", conversationID).
		Order("create_time DESC").
		Order("id DESC").
		Limit(limit).
		Find(&rows).Error; err != nil {
		return nil, err
	}
	for i, j := 0, len(rows)-1; i < j; i, j = i+1, j-1 {
		rows[i], rows[j] = rows[j], rows[i]
	}
	return rows, nil
}

// touchConversation updates a conversation's last-message pointer/time so the
// list ordering reflects recent activity.
// renameConversation sets a conversation's title.
func (r *repo) renameConversation(id idgen.ID, title string) error {
	return r.db.Model(&model.IMConversation{}).
		Where("id = ?", id).
		Update("title", title).Error
}

func (r *repo) touchConversation(id, lastMessageID idgen.ID, at time.Time) error {
	return r.db.Model(&model.IMConversation{}).
		Where("id = ?", id).
		Updates(map[string]any{
			"last_message_id": lastMessageID,
			"last_message_at": at,
		}).Error
}

// markRead resets the owner's unread counter and advances the read marker for a
// conversation. It is a no-op (no error) when no member row exists.
func (r *repo) markRead(conversationID, userID, lastReadID idgen.ID, at time.Time) error {
	return r.db.Model(&model.IMConversationMember{}).
		Where("conversation_id = ? AND user_id = ?", conversationID, userID).
		Updates(map[string]any{
			"unread_count":   0,
			"last_read_id":   lastReadID,
			"last_read_time": at,
		}).Error
}
