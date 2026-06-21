package chat

import (
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

// service.go holds the chat business logic: ownership scoping, conversation
// creation, message persistence and the canned assistant reply.

// defaultConversationTitle is assigned when a conversation is created without a
// title.
const defaultConversationTitle = "新对话"

// assistantSenderID is the sentinel sender used for the placeholder assistant
// messages. Real users always have a non-zero snowflake id, so a sender id of 0
// unambiguously marks a message as "ai" when the VO derives the role.
const assistantSenderID idgen.ID = 0

// cannedReply is the placeholder assistant response returned until a real LLM is
// wired in. It is intentionally explicit that no model is connected yet.
const cannedReply = "[占位回复] AI 暂未接入：当前还没有配置大模型密钥，这是一条自动生成的占位回复。你的消息已收到：%s"

// errForbidden is returned when a user tries to access a conversation they do
// not own. The handler maps it to a 404 to avoid leaking existence.
var errForbidden = errors.New("chat: not owner")

type service struct {
	repo *repo
}

func newService(db *gorm.DB) *service {
	return &service{repo: newRepo(db)}
}

// listConversations returns a page of the authenticated owner's conversations.
func (s *service) listConversations(ownerID idgen.ID, q *ListQuery) ([]ConversationVO, int64, error) {
	rows, total, err := s.repo.listConversations(ownerID, q)
	if err != nil {
		return nil, 0, err
	}
	vos := make([]ConversationVO, 0, len(rows))
	for i := range rows {
		vos = append(vos, toConversationVO(&rows[i]))
	}
	return vos, total, nil
}

// createConversation makes a new AI conversation owned by ownerID and registers
// the owner as its sole member.
func (s *service) createConversation(ownerID idgen.ID, dto CreateConversationDTO) (*ConversationVO, error) {
	title := strings.TrimSpace(dto.Title)
	if title == "" {
		title = defaultConversationTitle
	}

	conv := &model.IMConversation{
		Type:    "ai",
		Title:   title,
		OwnerID: ownerID,
	}
	if err := s.repo.createConversation(conv); err != nil {
		return nil, err
	}

	// Register the owner as a member (role 2 = 群主/owner). A failure here is not
	// fatal to the conversation itself; the member row only drives unread state.
	_ = s.repo.createMessageMember(conv.ID, ownerID)

	vo := toConversationVO(conv)
	return &vo, nil
}

// listMessages returns a page of a conversation's messages, enforcing ownership.
func (s *service) listMessages(conversationID, ownerID idgen.ID, q *ListQuery) ([]MessageVO, int64, error) {
	conv, err := s.repo.findConversation(conversationID)
	if err != nil {
		return nil, 0, err
	}
	if conv.OwnerID != ownerID {
		return nil, 0, errForbidden
	}

	rows, total, err := s.repo.listMessages(conversationID, q)
	if err != nil {
		return nil, 0, err
	}
	vos := make([]MessageVO, 0, len(rows))
	for i := range rows {
		vos = append(vos, toMessageVO(&rows[i], conv.OwnerID))
	}
	return vos, total, nil
}

// sendMessage persists the user's message, appends a canned assistant reply, and
// returns the user message VO. Ownership is enforced.
func (s *service) sendMessage(conversationID, ownerID idgen.ID, dto SendMessageDTO) (*MessageVO, error) {
	conv, err := s.repo.findConversation(conversationID)
	if err != nil {
		return nil, err
	}
	if conv.OwnerID != ownerID {
		return nil, errForbidden
	}

	contentType := strings.TrimSpace(dto.Type)
	if contentType == "" {
		contentType = "text"
	}
	content := strings.TrimSpace(dto.Content)

	// Persist the user message.
	userMsg := &model.IMMessage{
		ConversationID: conversationID,
		SenderID:       ownerID,
		ContentType:    contentType,
		Content:        content,
		Status:         0,
	}
	if err := s.repo.createMessage(userMsg); err != nil {
		return nil, err
	}

	// Append a canned assistant reply (no LLM key wired yet). A failure to store
	// the reply must not fail the user's send, so it is best-effort.
	aiMsg := &model.IMMessage{
		ConversationID: conversationID,
		SenderID:       assistantSenderID,
		ContentType:    "text",
		Content:        s.buildReply(content),
		Status:         0,
	}
	at := time.Now()
	if err := s.repo.createMessage(aiMsg); err == nil {
		_ = s.repo.touchConversation(conversationID, aiMsg.ID, at)
	} else {
		_ = s.repo.touchConversation(conversationID, userMsg.ID, at)
	}

	vo := toMessageVO(userMsg, conv.OwnerID)
	return &vo, nil
}

// markRead clears the owner's unread state for a conversation. Ownership is
// enforced.
func (s *service) markRead(conversationID, ownerID idgen.ID) error {
	conv, err := s.repo.findConversation(conversationID)
	if err != nil {
		return err
	}
	if conv.OwnerID != ownerID {
		return errForbidden
	}
	lastReadID := idgen.ID(0)
	if conv.LastMessageID != nil {
		lastReadID = *conv.LastMessageID
	}
	return s.repo.markRead(conversationID, ownerID, lastReadID, time.Now())
}

// buildReply formats the canned assistant reply for a given user message.
func (s *service) buildReply(userContent string) string {
	preview := userContent
	const max = 80
	if len([]rune(preview)) > max {
		preview = string([]rune(preview)[:max]) + "…"
	}
	return strings.Replace(cannedReply, "%s", preview, 1)
}
