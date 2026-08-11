package asset

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

const (
	SourceGeneration = "generation"
	SourceUpload     = "upload"
	StatusProcessing = 0
	StatusReady      = 1
)

type generationTrack struct {
	URL      string  `json:"url"`
	Title    string  `json:"title"`
	CoverURL string  `json:"coverUrl"`
	Duration float64 `json:"duration"`
	ClipID   string  `json:"clipId"`
}

type generationMeta struct {
	URLs   []string          `json:"urls"`
	Tracks []generationTrack `json:"tracks"`
}

func generationMediaType(handler string) string {
	switch strings.ToLower(strings.TrimSpace(handler)) {
	case "text_to_image", "image_to_image", "upscale", "outpaint", "remove_bg", "remove_object", "relight":
		return "image"
	case "text_to_video", "image_to_video", "start_end_to_video", "reference_to_video":
		return "video"
	case "text_to_audio":
		return "audio"
	default:
		return ""
	}
}

func uploadMediaType(file *model.File) string {
	if file == nil {
		return ""
	}
	switch file.FileType {
	case "image", "video":
		return file.FileType
	case "other":
		if strings.HasPrefix(strings.ToLower(file.MimeType), "audio/") {
			return "audio"
		}
	}
	return ""
}

func generationNodeType(task *model.AiTask, mediaType string) string {
	target := strings.ToLower(strings.TrimSpace(task.TargetType))
	if target == "character" || target == "scene" {
		return target
	}
	return mediaType
}

func uploadNodeType(file *model.File, mediaType string) string {
	category := strings.ToLower(strings.TrimSpace(file.Category))
	if mediaType == "image" && (category == "character" || category == "scene") {
		return category
	}
	return mediaType
}

func visibleGeneration(task *model.AiTask) bool {
	if task == nil || generationMediaType(task.Handler) == "" {
		return false
	}
	return task.Origin != "skill_run" || task.OutputRole == "final"
}

// EnsureUpload adds one history entry per upload event. The source uniqueness
// key makes direct-upload registration retries idempotent.
func EnsureUpload(ctx context.Context, db *gorm.DB, file *model.File) error {
	mediaType := uploadMediaType(file)
	// SkillRun archives are generated artifacts mirrored into files for quota and
	// download duties. Their AiTask already supplies the history row, so indexing
	// the archive again would present the same output twice as "AI 生成" + "上传".
	if db == nil || file == nil || file.SourceArtifactID != nil || mediaType == "" {
		return nil
	}
	row := model.MediaAsset{
		ID:          idgen.Next(),
		OwnerID:     file.OwnerID,
		ProjectID:   file.ProjectID,
		SourceType:  SourceUpload,
		SourceID:    file.ID,
		OutputIndex: 0,
		MediaType:   mediaType,
		NodeType:    uploadNodeType(file, mediaType),
		Name:        file.OriginalName,
		URL:         file.FileUrl,
		Thumbnail:   file.FileUrl,
		MimeType:    file.MimeType,
		Status:      StatusReady,
		CreateTime:  file.CreateTime,
		UpdateTime:  file.CreateTime,
	}
	return db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "source_type"}, {Name: "source_id"}, {Name: "output_index"}},
		DoNothing: true,
	}).Create(&row).Error
}

// EnsureGenerationPending exposes an accepted media task immediately. Text and
// intermediate orchestration tasks deliberately never enter media history.
func EnsureGenerationPending(ctx context.Context, db *gorm.DB, task *model.AiTask) error {
	if db == nil || !visibleGeneration(task) {
		return nil
	}
	mediaType := generationMediaType(task.Handler)
	row := model.MediaAsset{
		ID:          idgen.Next(),
		OwnerID:     task.UserID,
		ProjectID:   task.ProjectID,
		SourceType:  SourceGeneration,
		SourceID:    task.ID,
		OutputIndex: 0,
		MediaType:   mediaType,
		NodeType:    generationNodeType(task, mediaType),
		Name:        task.ModelName,
		Status:      StatusProcessing,
		CreateTime:  task.CreateTime,
		UpdateTime:  task.UpdateTime,
	}
	return db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "source_type"}, {Name: "source_id"}, {Name: "output_index"}},
		DoNothing: true,
	}).Create(&row).Error
}

func parseGenerationOutputs(task *model.AiTask) []generationTrack {
	if task == nil {
		return nil
	}
	var meta generationMeta
	if strings.TrimSpace(task.ResultMeta) != "" {
		_ = json.Unmarshal([]byte(task.ResultMeta), &meta)
	}
	tracksByURL := make(map[string]generationTrack, len(meta.Tracks))
	for _, track := range meta.Tracks {
		if url := strings.TrimSpace(track.URL); url != "" {
			track.URL = url
			tracksByURL[url] = track
		}
	}
	urls := append([]string(nil), meta.URLs...)
	if len(urls) == 0 && strings.TrimSpace(task.ResultUrl) != "" {
		urls = []string{task.ResultUrl}
	}
	seen := make(map[string]struct{}, len(urls))
	out := make([]generationTrack, 0, len(urls))
	for _, raw := range urls {
		url := strings.TrimSpace(raw)
		if url == "" {
			continue
		}
		if _, exists := seen[url]; exists {
			continue
		}
		seen[url] = struct{}{}
		track := tracksByURL[url]
		track.URL = url
		out = append(out, track)
	}
	return out
}

// FinalizeGeneration atomically turns the pending entry into independently
// actionable output records. Index zero keeps the pending row's stable id.
func FinalizeGeneration(ctx context.Context, db *gorm.DB, task *model.AiTask) error {
	if db == nil || !visibleGeneration(task) {
		return nil
	}
	if task.Status != 1 {
		return RemoveGeneration(ctx, db, task.ID)
	}
	outputs := parseGenerationOutputs(task)
	if len(outputs) == 0 {
		return RemoveGeneration(ctx, db, task.ID)
	}
	mediaType := generationMediaType(task.Handler)
	nodeType := generationNodeType(task, mediaType)
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for index, output := range outputs {
			name := strings.TrimSpace(output.Title)
			if name == "" {
				name = strings.TrimSpace(task.ModelName)
			}
			if name == "" {
				name = "生成结果"
			}
			if len(outputs) > 1 && strings.TrimSpace(output.Title) == "" {
				name = fmt.Sprintf("%s %d", name, index+1)
			}
			metadata, _ := json.Marshal(map[string]any{
				"duration": output.Duration,
				"clipId":   output.ClipID,
			})
			row := model.MediaAsset{
				ID:          idgen.Next(),
				OwnerID:     task.UserID,
				ProjectID:   task.ProjectID,
				SourceType:  SourceGeneration,
				SourceID:    task.ID,
				OutputIndex: index,
				MediaType:   mediaType,
				NodeType:    nodeType,
				Name:        name,
				URL:         output.URL,
				Thumbnail:   output.CoverURL,
				Status:      StatusReady,
				Metadata:    string(metadata),
				CreateTime:  task.CreateTime,
				UpdateTime:  task.UpdateTime,
			}
			if err := tx.Clauses(clause.OnConflict{
				Columns: []clause.Column{{Name: "source_type"}, {Name: "source_id"}, {Name: "output_index"}},
				DoUpdates: clause.AssignmentColumns([]string{
					"project_id", "media_type", "node_type", "name", "url", "thumbnail",
					"status", "metadata", "update_time",
				}),
			}).Create(&row).Error; err != nil {
				return err
			}
		}
		return tx.Model(&model.MediaAsset{}).
			Where("source_type = ? AND source_id = ? AND output_index >= ? AND removed = ?", SourceGeneration, task.ID, len(outputs), false).
			Updates(map[string]any{"removed": true, "update_time": task.UpdateTime}).Error
	})
}

func RemoveGeneration(ctx context.Context, db *gorm.DB, taskID idgen.ID) error {
	if db == nil || taskID == 0 {
		return nil
	}
	return db.WithContext(ctx).
		Where("source_type = ? AND source_id = ?", SourceGeneration, taskID).
		Delete(&model.MediaAsset{}).Error
}

// BackfillOwner is intentionally user-scoped and idempotent. It upgrades old
// rows only when that user first opens history instead of blocking deployment.
func BackfillOwner(ctx context.Context, db *gorm.DB, ownerID idgen.ID) error {
	if db == nil || ownerID == 0 {
		return nil
	}
	var files []model.File
	if err := db.WithContext(ctx).Where("owner_id = ?", ownerID).Order("id ASC").
		FindInBatches(&files, 500, func(_ *gorm.DB, _ int) error {
			for index := range files {
				if err := EnsureUpload(ctx, db, &files[index]); err != nil {
					return err
				}
			}
			return nil
		}).Error; err != nil {
		return err
	}
	// A worker can crash after terminalizing a task but before updating history.
	// Retire those abandoned placeholders before rebuilding the owner's live rows.
	if err := db.WithContext(ctx).Model(&model.MediaAsset{}).
		Where("owner_id = ? AND source_type = ? AND status = ? AND removed = ?", ownerID, SourceGeneration, StatusProcessing, false).
		Where("NOT EXISTS (?)", db.Model(&model.AiTask{}).Select("1").Where("ai_tasks.id = media_assets.source_id AND ai_tasks.status IN ?", []int{0, 1})).
		Updates(map[string]any{"removed": true}).Error; err != nil {
		return err
	}

	var tasks []model.AiTask
	if err := db.WithContext(ctx).
		Where("user_id = ? AND status IN ?", ownerID, []int{0, 1}).
		Where("(origin IS NULL OR origin = '' OR origin = 'direct') OR (origin = 'skill_run' AND output_role = ?)", "final").
		Order("id ASC").FindInBatches(&tasks, 500, func(_ *gorm.DB, _ int) error {
		for index := range tasks {
			task := &tasks[index]
			if task.Status == 1 {
				if err := FinalizeGeneration(ctx, db, task); err != nil {
					return err
				}
			} else if err := EnsureGenerationPending(ctx, db, task); err != nil {
				return err
			}
		}
		return nil
	}).Error; err != nil {
		return err
	}
	return nil
}

// ReconcileOwnerProcessing repairs the small live set on every history read.
// It covers a worker crash between task finalization and the history hook, and
// tasks terminalized later by the stale-task recovery sweep after the one-time
// legacy backfill has already completed.
func ReconcileOwnerProcessing(ctx context.Context, db *gorm.DB, ownerID idgen.ID) error {
	if db == nil || ownerID == 0 {
		return nil
	}
	var sourceIDs []idgen.ID
	if err := db.WithContext(ctx).Model(&model.MediaAsset{}).
		Where("owner_id = ? AND source_type = ? AND status = ? AND removed = ?", ownerID, SourceGeneration, StatusProcessing, false).
		Distinct("source_id").Pluck("source_id", &sourceIDs).Error; err != nil || len(sourceIDs) == 0 {
		return err
	}
	var tasks []model.AiTask
	if err := db.WithContext(ctx).Where("id IN ?", sourceIDs).Find(&tasks).Error; err != nil {
		return err
	}
	byID := make(map[idgen.ID]*model.AiTask, len(tasks))
	for index := range tasks {
		byID[tasks[index].ID] = &tasks[index]
	}
	for _, sourceID := range sourceIDs {
		task := byID[sourceID]
		if task == nil || task.Status != 0 && task.Status != 1 {
			if err := RemoveGeneration(ctx, db, sourceID); err != nil {
				return err
			}
			continue
		}
		if task.Status == 1 {
			if err := FinalizeGeneration(ctx, db, task); err != nil {
				return err
			}
		}
	}
	return nil
}
