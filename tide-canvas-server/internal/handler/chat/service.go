package chat

import (
	"context"
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"

	"tidecanvas/internal/config"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/llm"
	"tidecanvas/internal/pkg/logger"
	"tidecanvas/internal/pkg/relaychat"

	"go.uber.org/zap"
)

// service.go holds the chat business logic: ownership scoping, conversation
// creation, message persistence and the canned assistant reply.

// defaultConversationTitle is assigned when a conversation is created without a
// title.
const defaultConversationTitle = "新对话"

// titleFromPrompt derives a short conversation title from the first prompt.
func titleFromPrompt(p string) string {
	p = strings.TrimSpace(p)
	if p == "" {
		return defaultConversationTitle
	}
	r := []rune(p)
	if len(r) > 16 {
		return string(r[:16]) + "…"
	}
	return string(r)
}

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

// llmReplyTimeout bounds a single upstream generation so a slow/hung provider
// never blocks the user's send indefinitely.
const llmReplyTimeout = 60 * time.Second

type service struct {
	repo *repo
	// relay is the primary assistant backend: the ScarecrowToken relay's
	// OpenAI-compatible chat completions, routed to a configured text model.
	// nil when no relay API key is set.
	relay *relaychat.Client
	// llmClient is the legacy fallback (Anthropic) used when the relay is not
	// configured or has no text model available. nil when no LLM key is set.
	llmClient    *llm.Client
	systemPrompt string
	historyLimit int
}

func newService(db *gorm.DB, cfg *config.Config) *service {
	s := &service{
		repo:         newRepo(db),
		historyLimit: cfg.LLM.HistoryLimit,
		systemPrompt: cfg.LLM.SystemPrompt,
		relay:        relaychat.New(cfg.Relay.BaseURL, cfg.Relay.APIKey),
	}
	if s.historyLimit <= 0 {
		s.historyLimit = 20
	}
	if s.relay != nil {
		logger.L().Info("chat: relay assistant enabled (text models via /v1/chat/completions)")
	}
	if client, err := llm.New(cfg.LLM); err != nil {
		if !errors.Is(err, llm.ErrDisabled) {
			logger.L().Warn("chat: LLM client init failed, using canned replies", zap.Error(err))
		}
	} else {
		s.llmClient = client
		logger.L().Info("chat: LLM fallback enabled", zap.String("model", cfg.LLM.Model))
	}
	return s
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

	// Attach live task status to assistant messages that point to a task (the
	// task is the single source of truth). One batched IN query, no N+1.
	var taskIDs []idgen.ID
	for i := range vos {
		if vos[i].TaskID != nil {
			taskIDs = append(taskIDs, *vos[i].TaskID)
		}
	}
	if len(taskIDs) > 0 {
		if tasks, terr := s.repo.tasksByIDs(taskIDs); terr == nil {
			for i := range vos {
				if vos[i].TaskID != nil {
					vos[i].Task = toMessageTaskVO(tasks[*vos[i].TaskID]) // nil → 已过期 on the client
				}
			}
		}
	}
	return vos, total, nil
}

// persistTurn atomically records a completed 生成台 turn: the user's prompt (with
// its param snapshot) and an assistant message that points at the generation
// task. No auto text reply. The task itself was already submitted via the ai
// pipeline, so billing/quota are not re-implemented here (studio-design §9.2, §10.8).
func (s *service) persistTurn(conversationID, ownerID idgen.ID, dto PersistTurnDTO, taskID idgen.ID) ([]MessageVO, error) {
	conv, err := s.repo.findConversation(conversationID)
	if err != nil {
		return nil, err
	}
	if conv.OwnerID != ownerID {
		return nil, errForbidden
	}

	contentType := strings.TrimSpace(dto.ContentType)
	if contentType != "video" {
		contentType = "image"
	}

	userMsg := &model.IMMessage{
		ConversationID: conversationID,
		SenderID:       ownerID,
		ContentType:    "text",
		Content:        strings.TrimSpace(dto.Prompt),
		Params:         strings.TrimSpace(string(dto.Params)),
		Status:         0,
	}
	aiMsg := &model.IMMessage{
		ConversationID: conversationID,
		SenderID:       assistantSenderID,
		ContentType:    contentType,
		Content:        "",
		TaskID:         &taskID,
		Status:         0,
	}
	if err := s.repo.createTurn(userMsg, aiMsg); err != nil {
		return nil, err
	}

	at := time.Now()
	_ = s.repo.touchConversation(conversationID, aiMsg.ID, at)
	// First turn names the conversation from the prompt (best-effort).
	if strings.TrimSpace(conv.Title) == "" || conv.Title == defaultConversationTitle {
		_ = s.repo.renameConversation(conversationID, titleFromPrompt(userMsg.Content))
	}

	return []MessageVO{
		toMessageVO(userMsg, conv.OwnerID),
		toMessageVO(aiMsg, conv.OwnerID),
	}, nil
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

	// Generate the assistant reply (real LLM when configured, canned otherwise).
	// A failure to store the reply must not fail the user's send, so it is
	// best-effort.
	aiMsg := &model.IMMessage{
		ConversationID: conversationID,
		SenderID:       assistantSenderID,
		ContentType:    "text",
		Content:        s.generateReply(conversationID, content),
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

// appendMessage persists a single message with NO auto assistant reply. Role
// "ai" stores it under the assistant sentinel sender (so toMessageVO marks it as
// an assistant bubble); anything else is the owner's own message. Used by 对话式
// 生成 to log the prompt and the generated media (image/video) result.
func (s *service) appendMessage(conversationID, ownerID idgen.ID, dto AppendMessageDTO) (*MessageVO, error) {
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
	sender := ownerID
	if strings.EqualFold(strings.TrimSpace(dto.Role), "ai") {
		sender = assistantSenderID
	}

	msg := &model.IMMessage{
		ConversationID: conversationID,
		SenderID:       sender,
		ContentType:    contentType,
		Content:        strings.TrimSpace(dto.Content),
		Status:         0,
	}
	if err := s.repo.createMessage(msg); err != nil {
		return nil, err
	}
	_ = s.repo.touchConversation(conversationID, msg.ID, time.Now())

	vo := toMessageVO(msg, conv.OwnerID)
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

// generateReply produces the assistant reply for the latest user message. When
// an LLM is configured it sends the recent transcript to the model; on any error
// (or when no LLM is configured) it falls back to the canned placeholder so the
// chat round-trip always completes.
func (s *service) generateReply(conversationID idgen.ID, userContent string) string {
	if s.relay == nil && s.llmClient == nil {
		return s.buildReply(userContent)
	}

	rows, err := s.repo.recentMessages(conversationID, s.historyLimit)
	if err != nil {
		logger.L().Warn("chat: load context failed, using canned reply", zap.Error(err))
		return s.buildReply(userContent)
	}

	// 1) Preferred: relay chat completions, routed to a configured text model.
	if s.relay != nil {
		if model := s.repo.textModelKey(); model != "" {
			msgs := make([]relaychat.Msg, 0, len(rows)+1)
			if p := strings.TrimSpace(s.systemPrompt); p != "" {
				msgs = append(msgs, relaychat.Msg{Role: "system", Content: p})
			}
			for i := range rows {
				role := "user"
				if rows[i].SenderID == assistantSenderID {
					role = "assistant"
				}
				msgs = append(msgs, relaychat.Msg{Role: role, Content: rows[i].Content})
			}
			ctx, cancel := context.WithTimeout(context.Background(), llmReplyTimeout)
			defer cancel()
			if reply, err := s.relay.Chat(ctx, model, msgs); err == nil {
				return reply
			} else {
				logger.L().Warn("chat: relay generation failed, falling back", zap.String("model", model), zap.Error(err))
			}
		}
	}

	// 2) Fallback: legacy Anthropic client.
	if s.llmClient != nil {
		turns := make([]llm.Turn, 0, len(rows))
		for i := range rows {
			role := llm.RoleUser
			if rows[i].SenderID == assistantSenderID {
				role = llm.RoleAssistant
			}
			turns = append(turns, llm.Turn{Role: role, Text: rows[i].Content})
		}
		ctx, cancel := context.WithTimeout(context.Background(), llmReplyTimeout)
		defer cancel()
		if reply, err := s.llmClient.Chat(ctx, turns); err == nil {
			return reply
		} else {
			logger.L().Warn("chat: LLM generation failed, using canned reply", zap.Error(err))
		}
	}

	// 3) Canned placeholder.
	return s.buildReply(userContent)
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
