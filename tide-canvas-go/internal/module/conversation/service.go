package conversation

import (
	"encoding/json"
	"strings"
	"unicode/utf8"

	"gorm.io/datatypes"
	"gorm.io/gorm"

	"github.com/tidecanvas/tide-canvas-go/internal/model"
	"github.com/tidecanvas/tide-canvas-go/pkg/ecode"
)

type FileReleaser interface {
	DeleteUnreferencedFiles(userID int64, fileIDs []int64) error
}

type TaskCanceller interface {
	CancelTask(userID int64, publicID string) error
}

type Service struct {
	repo  *Repository
	files FileReleaser
	tasks TaskCanceller
}

func NewService(repo *Repository, files FileReleaser, tasks TaskCanceller) *Service {
	return &Service{repo: repo, files: files, tasks: tasks}
}

func (s *Service) Create(userID int64, dto *CreateDTO) (*ConversationVO, error) {
	mode := strings.ToLower(strings.TrimSpace(dto.Mode))
	if !validMode(mode) {
		return nil, ecode.BadRequest.WithMessage("不支持的会话模式")
	}
	item := &model.AiConversation{UserID: userID, Mode: mode, Title: "新对话"}
	if err := s.repo.CreateConversation(s.repo.DB(), item); err != nil {
		return nil, err
	}
	return s.toConversationVO(item, nil), nil
}

func (s *Service) List(userID int64, q *ListQuery) ([]ConversationVO, int64, error) {
	q.normalize()
	rows, total, err := s.repo.ListConversations(userID, q)
	if err != nil {
		return nil, 0, err
	}
	out := make([]ConversationVO, 0, len(rows))
	for i := range rows {
		out = append(out, *s.toConversationVO(&rows[i], nil))
	}
	return out, total, nil
}

func (s *Service) Get(userID int64, publicID string) (*ConversationVO, error) {
	item, err := s.requireConversation(userID, publicID)
	if err != nil {
		return nil, err
	}
	messages, err := s.repo.ListMessages(item.ID)
	if err != nil {
		return nil, err
	}
	vos, err := s.toMessageVOs(messages)
	if err != nil {
		return nil, err
	}
	return s.toConversationVO(item, vos), nil
}

func (s *Service) Update(userID int64, publicID string, dto *UpdateDTO) (*ConversationVO, error) {
	item, err := s.requireConversation(userID, publicID)
	if err != nil {
		return nil, err
	}
	updates := map[string]any{}
	if dto.Title != nil {
		title := normalizeTitle(*dto.Title)
		if title == "" {
			return nil, ecode.BadRequest.WithMessage("会话标题不能为空")
		}
		updates["title"] = title
	}
	if dto.Pinned != nil {
		if *dto.Pinned {
			updates["pinned"] = 1
		} else {
			updates["pinned"] = 0
		}
	}
	if dto.ActiveLeafMessageID != nil {
		if strings.TrimSpace(*dto.ActiveLeafMessageID) == "" {
			updates["active_leaf_message_id"] = nil
		} else {
			message, findErr := s.repo.FindMessage(item.ID, strings.TrimSpace(*dto.ActiveLeafMessageID))
			if findErr != nil {
				return nil, findErr
			}
			if message == nil {
				return nil, ecode.BadRequest.WithMessage("分支消息不存在")
			}
			updates["active_leaf_message_id"] = message.ID
		}
	}
	if len(updates) > 0 {
		if err := s.repo.UpdateConversation(s.repo.DB(), item.ID, updates); err != nil {
			return nil, err
		}
	}
	return s.Get(userID, publicID)
}

func (s *Service) Delete(userID int64, publicID string) error {
	item, err := s.requireConversation(userID, publicID)
	if err != nil {
		return err
	}
	if s.tasks != nil {
		taskIDs, taskErr := s.repo.ConversationTaskPublicIDs(item.ID)
		if taskErr != nil {
			return taskErr
		}
		for _, taskID := range taskIDs {
			if cancelErr := s.tasks.CancelTask(userID, taskID); cancelErr != nil {
				return cancelErr
			}
		}
	}
	var fileIDs []int64
	err = s.repo.DB().Transaction(func(tx *gorm.DB) error {
		_, ids, deleteErr := s.repo.DeleteConversation(tx, item.ID)
		fileIDs = ids
		return deleteErr
	})
	if err != nil {
		return err
	}
	if s.files != nil && len(fileIDs) > 0 {
		return s.files.DeleteUnreferencedFiles(userID, fileIDs)
	}
	return nil
}

func (s *Service) AppendMessage(userID int64, conversationPublicID string, dto *AppendMessageDTO) (*MessageVO, error) {
	conversation, err := s.requireConversation(userID, conversationPublicID)
	if err != nil {
		return nil, err
	}
	role := normalizeMessageRole(dto.Role)
	status := normalizeMessageStatus(dto.Status)
	contentType := normalizeContentType(dto.ContentType)
	if role == "" || status == "" || contentType == "" {
		return nil, ecode.BadRequest.WithMessage("消息类型或状态无效")
	}
	if strings.TrimSpace(dto.Content) == "" && len(dto.Files) == 0 && status != "pending" {
		return nil, ecode.BadRequest.WithMessage("消息内容不能为空")
	}

	var parentID *int64
	if dto.ParentMessageID != "" {
		parent, findErr := s.repo.FindMessage(conversation.ID, dto.ParentMessageID)
		if findErr != nil {
			return nil, findErr
		}
		if parent == nil {
			return nil, ecode.BadRequest.WithMessage("父消息不存在")
		}
		parentID = &parent.ID
	}

	modelRow, err := s.repo.ResolveModel(strings.TrimSpace(dto.ModelID))
	if err != nil {
		return nil, err
	}
	taskRow, err := s.repo.ResolveTask(strings.TrimSpace(dto.TaskID))
	if err != nil {
		return nil, err
	}
	if taskRow != nil && taskRow.UserID != userID {
		return nil, ecode.Forbidden
	}
	metadata, _ := json.Marshal(dto.Metadata)
	item := &model.AiConversationMessage{
		ConversationID:  conversation.ID,
		ParentMessageID: parentID,
		Role:            role,
		ContentType:     contentType,
		Content:         dto.Content,
		ModelName:       strings.TrimSpace(dto.ModelName),
		Status:          status,
		Metadata:        datatypes.JSON(metadata),
	}
	if modelRow != nil {
		item.ModelID = &modelRow.ID
		if item.ModelName == "" {
			item.ModelName = modelRow.Name
		}
	}
	if taskRow != nil {
		item.TaskID = &taskRow.ID
	}

	filePublicIDs := make([]string, 0, len(dto.Files))
	for _, input := range dto.Files {
		filePublicIDs = append(filePublicIDs, input.FileID)
	}
	files, err := s.repo.ResolveFiles(userID, filePublicIDs)
	if err != nil {
		return nil, err
	}
	if len(files) != len(uniqueNonEmpty(filePublicIDs)) {
		return nil, ecode.BadRequest.WithMessage("附件不存在或无权访问")
	}

	err = s.repo.DB().Transaction(func(tx *gorm.DB) error {
		if err := s.repo.CreateMessage(tx, item); err != nil {
			return err
		}
		for _, input := range dto.Files {
			file := files[input.FileID]
			relation := normalizeRelation(input.Relation)
			locator, _ := json.Marshal(input.Locator)
			if err := s.repo.CreateMessageFile(tx, &model.AiMessageFile{
				MessageID: item.ID,
				FileID:    file.ID,
				Relation:  relation,
				Locator:   datatypes.JSON(locator),
			}); err != nil {
				return err
			}
			if err := s.repo.CreateFileReference(tx, &model.SysFileReference{
				UserID:  userID,
				FileID:  file.ID,
				BizType: "message",
				BizID:   item.ID,
			}); err != nil {
				return err
			}
			if err := tx.Where("file_id = ? AND biz_type = ?", file.ID, "conversation_temp").Delete(&model.SysFileReference{}).Error; err != nil {
				return err
			}
		}
		updates := map[string]any{
			"active_leaf_message_id": item.ID,
			"last_message_time":      item.CreateTime,
		}
		if role == "user" && conversation.Title == "新对话" {
			updates["title"] = titleFromMessage(dto.Content)
		}
		return s.repo.UpdateConversation(tx, conversation.ID, updates)
	})
	if err != nil {
		return nil, err
	}
	rows, err := s.toMessageVOs([]model.AiConversationMessage{*item})
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return &rows[0], nil
}

func (s *Service) UpdateMessage(userID int64, conversationPublicID, messagePublicID string, dto *UpdateMessageDTO) (*MessageVO, error) {
	conversation, err := s.requireConversation(userID, conversationPublicID)
	if err != nil {
		return nil, err
	}
	item, err := s.repo.FindMessage(conversation.ID, messagePublicID)
	if err != nil {
		return nil, err
	}
	if item == nil {
		return nil, ecode.NotFound.WithMessage("消息不存在")
	}
	updates := map[string]any{}
	if dto.Content != nil {
		updates["content"] = *dto.Content
	}
	if dto.Status != nil {
		status := normalizeMessageStatus(*dto.Status)
		if status == "" {
			return nil, ecode.BadRequest.WithMessage("消息状态无效")
		}
		updates["status"] = status
	}
	if dto.ModelName != nil {
		updates["model_name"] = strings.TrimSpace(*dto.ModelName)
	}
	if dto.ModelID != nil {
		row, resolveErr := s.repo.ResolveModel(strings.TrimSpace(*dto.ModelID))
		if resolveErr != nil {
			return nil, resolveErr
		}
		if row == nil {
			updates["model_id"] = nil
		} else {
			updates["model_id"] = row.ID
		}
	}
	if dto.TaskID != nil {
		row, resolveErr := s.repo.ResolveTask(strings.TrimSpace(*dto.TaskID))
		if resolveErr != nil {
			return nil, resolveErr
		}
		if row != nil && row.UserID != userID {
			return nil, ecode.Forbidden
		}
		if row == nil {
			updates["task_id"] = nil
		} else {
			updates["task_id"] = row.ID
		}
	}
	if dto.Metadata != nil {
		raw, _ := json.Marshal(*dto.Metadata)
		updates["metadata"] = datatypes.JSON(raw)
	}
	var resultFiles []*model.SysFile
	if dto.Metadata != nil {
		urls := []string{}
		if rawURL, ok := (*dto.Metadata)["url"].(string); ok {
			urls = append(urls, rawURL)
		}
		switch values := (*dto.Metadata)["urls"].(type) {
		case []interface{}:
			for _, value := range values {
				if url, ok := value.(string); ok {
					urls = append(urls, url)
				}
			}
		case []string:
			urls = append(urls, values...)
		}
		seen := map[string]struct{}{}
		for _, rawURL := range urls {
			rawURL = strings.TrimSpace(rawURL)
			if rawURL == "" {
				continue
			}
			if _, exists := seen[rawURL]; exists {
				continue
			}
			seen[rawURL] = struct{}{}
			resultFile, resolveErr := s.repo.ResolveFileByURL(userID, rawURL)
			if resolveErr != nil {
				return nil, resolveErr
			}
			if resultFile != nil {
				resultFiles = append(resultFiles, resultFile)
			}
		}
	}
	if len(updates) > 0 || len(resultFiles) > 0 {
		if err := s.repo.DB().Transaction(func(tx *gorm.DB) error {
			if len(updates) > 0 {
				if updateErr := s.repo.UpdateMessage(tx, item.ID, updates); updateErr != nil {
					return updateErr
				}
			}
			if len(resultFiles) == 0 {
				return nil
			}
			for _, resultFile := range resultFiles {
				if createErr := s.repo.CreateMessageFile(tx, &model.AiMessageFile{
					MessageID: item.ID,
					FileID:    resultFile.ID,
					Relation:  "result",
				}); createErr != nil {
					return createErr
				}
				if createErr := s.repo.CreateFileReference(tx, &model.SysFileReference{
					UserID:  userID,
					FileID:  resultFile.ID,
					BizType: "message",
					BizID:   item.ID,
				}); createErr != nil {
					return createErr
				}
				if deleteErr := tx.Where("file_id = ? AND biz_type = ?", resultFile.ID, "conversation_temp").
					Delete(&model.SysFileReference{}).Error; deleteErr != nil {
					return deleteErr
				}
			}
			return nil
		}); err != nil {
			return nil, err
		}
	}
	updated, err := s.repo.FindMessage(conversation.ID, messagePublicID)
	if err != nil {
		return nil, err
	}
	rows, err := s.toMessageVOs([]model.AiConversationMessage{*updated})
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return &rows[0], nil
}

func (s *Service) requireConversation(userID int64, publicID string) (*model.AiConversation, error) {
	item, err := s.repo.FindConversation(userID, strings.TrimSpace(publicID))
	if err != nil {
		return nil, err
	}
	if item == nil {
		return nil, ecode.NotFound.WithMessage("会话不存在")
	}
	return item, nil
}

func (s *Service) toConversationVO(item *model.AiConversation, messages []MessageVO) *ConversationVO {
	vo := &ConversationVO{
		ID:              item.PublicID,
		Mode:            item.Mode,
		Title:           item.Title,
		Pinned:          item.Pinned == 1,
		LastMessageTime: item.LastMessageTime,
		CreateTime:      item.CreateTime,
		UpdateTime:      item.UpdateTime,
		Messages:        messages,
	}
	if item.ActiveLeafMessageID != nil {
		ids, _ := s.repo.MessagePublicIDs([]int64{*item.ActiveLeafMessageID})
		vo.ActiveLeafMessageID = ids[*item.ActiveLeafMessageID]
	}
	return vo
}

func (s *Service) toMessageVOs(rows []model.AiConversationMessage) ([]MessageVO, error) {
	messageIDs := make([]int64, 0, len(rows))
	parentIDs := make([]int64, 0)
	modelIDs := make([]int64, 0)
	taskIDs := make([]int64, 0)
	for i := range rows {
		messageIDs = append(messageIDs, rows[i].ID)
		if rows[i].ParentMessageID != nil {
			parentIDs = append(parentIDs, *rows[i].ParentMessageID)
		}
		if rows[i].ModelID != nil {
			modelIDs = append(modelIDs, *rows[i].ModelID)
		}
		if rows[i].TaskID != nil {
			taskIDs = append(taskIDs, *rows[i].TaskID)
		}
	}
	parentPublicIDs, err := s.repo.MessagePublicIDs(parentIDs)
	if err != nil {
		return nil, err
	}
	modelPublicIDs, err := s.repo.ModelPublicIDs(modelIDs)
	if err != nil {
		return nil, err
	}
	taskPublicIDs, err := s.repo.TaskPublicIDs(taskIDs)
	if err != nil {
		return nil, err
	}
	files, err := s.repo.MessageFiles(messageIDs)
	if err != nil {
		return nil, err
	}
	out := make([]MessageVO, 0, len(rows))
	for i := range rows {
		item := rows[i]
		vo := MessageVO{
			ID:          item.PublicID,
			Role:        item.Role,
			ContentType: item.ContentType,
			Content:     item.Content,
			ModelName:   item.ModelName,
			Status:      item.Status,
			Metadata:    decodeJSONMap(item.Metadata),
			Files:       []FileVO{},
			CreateTime:  item.CreateTime,
			UpdateTime:  item.UpdateTime,
		}
		if item.ParentMessageID != nil {
			vo.ParentMessageID = parentPublicIDs[*item.ParentMessageID]
		}
		if item.ModelID != nil {
			vo.ModelID = modelPublicIDs[*item.ModelID]
		}
		if item.TaskID != nil {
			vo.TaskID = taskPublicIDs[*item.TaskID]
		}
		for _, f := range files[item.ID] {
			vo.Files = append(vo.Files, FileVO{
				ID:           f.FilePublicID,
				OriginalName: f.OriginalName,
				FileURL:      f.FileURL,
				FileSize:     f.FileSize,
				FileType:     f.FileType,
				MimeType:     f.MimeType,
				StorageType:  f.StorageType,
				Relation:     f.Relation,
				Locator:      decodeJSONMap(f.Locator),
			})
		}
		out = append(out, vo)
	}
	return out, nil
}

func normalizeTitle(value string) string {
	runes := []rune(strings.TrimSpace(value))
	if len(runes) > 60 {
		runes = runes[:60]
	}
	return string(runes)
}

func titleFromMessage(value string) string {
	value = strings.Join(strings.Fields(value), " ")
	if value == "" {
		return "附件对话"
	}
	if utf8.RuneCountInString(value) > 32 {
		return string([]rune(value)[:32]) + "…"
	}
	return value
}

func normalizeRelation(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "result", "reference":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return "attachment"
	}
}

func uniqueNonEmpty(values []string) map[string]struct{} {
	out := make(map[string]struct{}, len(values))
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			out[value] = struct{}{}
		}
	}
	return out
}
