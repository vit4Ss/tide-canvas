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

// touchConversation updates a conversation's last-message pointer/time so the
// list ordering reflects recent activity.
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
