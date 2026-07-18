package conversation

import (
	"errors"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/tidecanvas/tide-canvas-go/internal/model"
)

type Repository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) *Repository { return &Repository{db: db} }

func (r *Repository) DB() *gorm.DB { return r.db }

func (r *Repository) CreateConversation(tx *gorm.DB, item *model.AiConversation) error {
	return tx.Create(item).Error
}

func (r *Repository) FindConversation(userID int64, publicID string) (*model.AiConversation, error) {
	var item model.AiConversation
	err := r.db.Where("user_id = ? AND public_id = ?", userID, publicID).First(&item).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &item, err
}

func (r *Repository) ListConversations(userID int64, q *ListQuery) ([]model.AiConversation, int64, error) {
	base := r.db.Model(&model.AiConversation{}).Where("user_id = ?", userID)
	var total int64
	if err := base.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var rows []model.AiConversation
	if total == 0 {
		return rows, 0, nil
	}
	err := base.
		Order("pinned DESC").
		Order("COALESCE(last_message_time, create_time) DESC").
		Offset((q.PageNum - 1) * q.PageSize).
		Limit(q.PageSize).
		Find(&rows).Error
	return rows, total, err
}

func (r *Repository) CreateMessage(tx *gorm.DB, item *model.AiConversationMessage) error {
	return tx.Create(item).Error
}

func (r *Repository) FindMessage(conversationID int64, publicID string) (*model.AiConversationMessage, error) {
	if publicID == "" {
		return nil, nil
	}
	var item model.AiConversationMessage
	err := r.db.Where("conversation_id = ? AND public_id = ?", conversationID, publicID).First(&item).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &item, err
}

func (r *Repository) ListMessages(conversationID int64) ([]model.AiConversationMessage, error) {
	var rows []model.AiConversationMessage
	err := r.db.Where("conversation_id = ?", conversationID).Order("create_time ASC, id ASC").Find(&rows).Error
	return rows, err
}

func (r *Repository) UpdateConversation(tx *gorm.DB, id int64, values map[string]any) error {
	return tx.Model(&model.AiConversation{}).Where("id = ?", id).Updates(values).Error
}

func (r *Repository) UpdateMessage(tx *gorm.DB, id int64, values map[string]any) error {
	return tx.Model(&model.AiConversationMessage{}).Where("id = ?", id).Updates(values).Error
}

func (r *Repository) CreateMessageFile(tx *gorm.DB, item *model.AiMessageFile) error {
	return tx.Clauses(clause.OnConflict{DoNothing: true}).Create(item).Error
}

func (r *Repository) CreateFileReference(tx *gorm.DB, item *model.SysFileReference) error {
	return tx.Clauses(clause.OnConflict{DoNothing: true}).Create(item).Error
}

func (r *Repository) ResolveModel(modelID string) (*model.AiModel, error) {
	if modelID == "" {
		return nil, nil
	}
	var item model.AiModel
	err := r.db.Where("model_id = ?", modelID).First(&item).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &item, err
}

func (r *Repository) ResolveTask(publicID string) (*model.AiTask, error) {
	if publicID == "" {
		return nil, nil
	}
	var item model.AiTask
	err := r.db.Where("public_id = ?", publicID).First(&item).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &item, err
}

func (r *Repository) ResolveFiles(userID int64, publicIDs []string) (map[string]model.SysFile, error) {
	out := make(map[string]model.SysFile, len(publicIDs))
	if len(publicIDs) == 0 {
		return out, nil
	}
	var rows []model.SysFile
	if err := r.db.Where("user_id = ? AND public_id IN ?", userID, publicIDs).Find(&rows).Error; err != nil {
		return nil, err
	}
	for i := range rows {
		out[rows[i].PublicID] = rows[i]
	}
	return out, nil
}

func (r *Repository) ResolveFileByURL(userID int64, fileURL string) (*model.SysFile, error) {
	if fileURL == "" {
		return nil, nil
	}
	var item model.SysFile
	err := r.db.Where("user_id = ? AND file_url = ?", userID, fileURL).First(&item).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &item, err
}

type messageFileRow struct {
	MessageID    int64
	FilePublicID string
	OriginalName string
	FileURL      string
	FileSize     int64
	FileType     string
	MimeType     string
	StorageType  string
	Relation     string
	Locator      []byte
}

func (r *Repository) MessageFiles(messageIDs []int64) (map[int64][]messageFileRow, error) {
	out := make(map[int64][]messageFileRow)
	if len(messageIDs) == 0 {
		return out, nil
	}
	var rows []messageFileRow
	err := r.db.Table("ai_message_file mf").
		Select("mf.message_id, f.public_id AS file_public_id, f.original_name, f.file_url, f.file_size, f.file_type, f.mime_type, f.storage_type, mf.relation, mf.locator").
		Joins("JOIN sys_file f ON f.id = mf.file_id AND f.deleted = 0").
		Where("mf.message_id IN ?", messageIDs).
		Order("mf.id ASC").
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		out[row.MessageID] = append(out[row.MessageID], row)
	}
	return out, nil
}

func (r *Repository) MessagePublicIDs(ids []int64) (map[int64]string, error) {
	out := make(map[int64]string, len(ids))
	if len(ids) == 0 {
		return out, nil
	}
	type row struct {
		ID       int64
		PublicID string
	}
	var rows []row
	if err := r.db.Model(&model.AiConversationMessage{}).Select("id", "public_id").Where("id IN ?", ids).Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, item := range rows {
		out[item.ID] = item.PublicID
	}
	return out, nil
}

func (r *Repository) ModelPublicIDs(ids []int64) (map[int64]string, error) {
	out := make(map[int64]string, len(ids))
	if len(ids) == 0 {
		return out, nil
	}
	type row struct {
		ID      int64
		ModelID string
	}
	var rows []row
	if err := r.db.Model(&model.AiModel{}).Select("id", "model_id").Where("id IN ?", ids).Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, item := range rows {
		out[item.ID] = item.ModelID
	}
	return out, nil
}

func (r *Repository) TaskPublicIDs(ids []int64) (map[int64]string, error) {
	out := make(map[int64]string, len(ids))
	if len(ids) == 0 {
		return out, nil
	}
	type row struct {
		ID       int64
		PublicID string
	}
	var rows []row
	if err := r.db.Model(&model.AiTask{}).Select("id", "public_id").Where("id IN ?", ids).Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, item := range rows {
		out[item.ID] = item.PublicID
	}
	return out, nil
}

func (r *Repository) ConversationTaskPublicIDs(conversationID int64) ([]string, error) {
	var taskIDs []int64
	if err := r.db.Model(&model.AiConversationMessage{}).
		Where("conversation_id = ? AND task_id IS NOT NULL", conversationID).
		Distinct().Pluck("task_id", &taskIDs).Error; err != nil {
		return nil, err
	}
	publicIDs, err := r.TaskPublicIDs(taskIDs)
	if err != nil {
		return nil, err
	}
	out := make([]string, 0, len(taskIDs))
	for _, id := range taskIDs {
		if publicID := publicIDs[id]; publicID != "" {
			out = append(out, publicID)
		}
	}
	return out, nil
}

func (r *Repository) DeleteConversation(tx *gorm.DB, conversationID int64) ([]int64, []int64, error) {
	var messages []model.AiConversationMessage
	if err := tx.Where("conversation_id = ?", conversationID).Find(&messages).Error; err != nil {
		return nil, nil, err
	}
	messageIDs := make([]int64, 0, len(messages))
	taskIDs := make([]int64, 0, len(messages))
	for _, item := range messages {
		messageIDs = append(messageIDs, item.ID)
		if item.TaskID != nil {
			taskIDs = append(taskIDs, *item.TaskID)
		}
	}
	var fileIDs []int64
	if len(messageIDs) > 0 {
		if err := tx.Model(&model.AiMessageFile{}).Where("message_id IN ?", messageIDs).Distinct().Pluck("file_id", &fileIDs).Error; err != nil {
			return nil, nil, err
		}
		if err := tx.Where("message_id IN ?", messageIDs).Delete(&model.AiMessageFile{}).Error; err != nil {
			return nil, nil, err
		}
		if err := tx.Where("biz_type = ? AND biz_id IN ?", "message", messageIDs).Delete(&model.SysFileReference{}).Error; err != nil {
			return nil, nil, err
		}
		if err := tx.Where("conversation_id = ?", conversationID).Delete(&model.AiConversationMessage{}).Error; err != nil {
			return nil, nil, err
		}
	}
	if len(taskIDs) > 0 {
		if err := tx.Where("id IN ?", taskIDs).Delete(&model.AiTask{}).Error; err != nil {
			return nil, nil, err
		}
	}
	if err := tx.Where("id = ?", conversationID).Delete(&model.AiConversation{}).Error; err != nil {
		return nil, nil, err
	}
	return messageIDs, fileIDs, nil
}
