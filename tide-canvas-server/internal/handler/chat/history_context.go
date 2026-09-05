package chat

import (
	"errors"
	"strings"

	"tidecanvas/internal/pkg/chatcontext"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/relaychat"
)

// replyMessages separates history from the current turn. In particular, a
// current image/file row must not be filtered out by the text-history query or
// cause its attachments to replace a previous user message.
func (s *service) replyMessages(conversationID, userMessageID idgen.ID, userContent, docNote string, docFiles []relaychat.FileAttachment, imageURLs []string, skillPrompt string) ([]relaychat.Msg, error) {
	if userMessageID == 0 {
		return nil, errors.New("current user message is required")
	}
	rows, err := s.repo.recentMessages(conversationID, userMessageID, chatcontext.HistoryLimit)
	if err != nil {
		return nil, err
	}
	msgs := make([]relaychat.Msg, 0, len(rows)+3)
	for _, instruction := range []string{s.systemPrompt, skillPrompt} {
		if p := strings.TrimSpace(instruction); p != "" {
			msgs = append(msgs, relaychat.TextMsg("system", p))
		}
	}
	for _, row := range rows {
		role := "user"
		if row.SenderID == assistantSenderID {
			role = "assistant"
		}
		msgs = append(msgs, relaychat.TextMsg(role, row.Content))
	}
	if docNote != "" {
		userContent = strings.TrimSpace(userContent + "\n\n" + docNote)
	}
	return append(msgs, relaychat.UserWithAttachments(userContent, imageURLs, docFiles)), nil
}
