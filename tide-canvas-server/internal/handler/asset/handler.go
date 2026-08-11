package asset

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
	"gorm.io/gorm"

	"tidecanvas/internal/app"
	"tidecanvas/internal/middleware"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/logger"
	"tidecanvas/internal/pkg/response"
)

const historyTimeLayout = "2006-01-02T15:04:05"

var (
	errAssetNotFound   = errors.New("media asset not found")
	errAssetForbidden  = errors.New("media asset forbidden")
	errAssetPublished  = errors.New("media asset is published")
	errAssetProcessing = errors.New("media asset is processing")
	errBadHistoryQuery = errors.New("invalid media history query")
)

type historyQuery struct {
	Scope          string   `form:"scope"`
	ProjectID      idgen.ID `form:"projectId"`
	MediaType      string   `form:"mediaType"`
	OrderDirection string   `form:"orderDirection"`
	Cursor         string   `form:"cursor"`
	PageSize       int      `form:"pageSize"`
	SourceIDs      string   `form:"sourceIds"`
	parsedSources  []idgen.ID
}

type mediaAssetVO struct {
	ID           idgen.ID       `json:"id"`
	ProjectID    idgen.ID       `json:"projectId"`
	SourceType   string         `json:"sourceType"`
	SourceID     idgen.ID       `json:"sourceId"`
	OutputIndex  int            `json:"outputIndex"`
	MediaType    string         `json:"mediaType"`
	NodeType     string         `json:"nodeType"`
	Name         string         `json:"name"`
	URL          string         `json:"url"`
	ThumbnailURL string         `json:"thumbnailUrl"`
	MimeType     string         `json:"mimeType"`
	Status       int            `json:"status"`
	Progress     int            `json:"progress"`
	Metadata     map[string]any `json:"metadata"`
	CreateTime   string         `json:"createTime"`
}

type historyPageVO struct {
	Records    []mediaAssetVO   `json:"records"`
	NextCursor string           `json:"nextCursor"`
	Counts     map[string]int64 `json:"counts"`
}

type batchDeleteDTO struct {
	IDs []string `json:"ids"`
}

type batchDeleteVO struct {
	DeletedIDs []string `json:"deletedIds"`
	BlockedIDs []string `json:"blockedIds"`
	FailedIDs  []string `json:"failedIds"`
}

type service struct {
	db         *gorm.DB
	deps       *app.Deps
	backfilled sync.Map
}

type backfillAttempt struct {
	done chan struct{}
	err  error
}

type handler struct{ svc *service }

func newHandler(deps *app.Deps) *handler {
	return &handler{svc: &service{db: deps.DB, deps: deps}}
}

func (h *handler) list(c *gin.Context) {
	var query historyQuery
	if err := c.ShouldBindQuery(&query); err != nil {
		response.Fail(c, response.CodeBadRequest, "历史筛选参数无效")
		return
	}
	uid := middleware.CurrentUserID(c)
	page, err := h.svc.list(c.Request.Context(), uid, query)
	if err != nil {
		switch {
		case errors.Is(err, errBadHistoryQuery):
			response.Fail(c, response.CodeBadRequest, "历史筛选参数无效")
		case errors.Is(err, errAssetForbidden):
			response.Fail(c, response.CodeForbidden, "当前画布不可用")
		default:
			response.Fail(c, response.CodeServerError, "failed to list media assets")
		}
		return
	}
	response.OK(c, page)
}

func (h *handler) remove(c *gin.Context) {
	id, err := idgen.Parse(c.Param("id"))
	if err != nil || id == 0 {
		response.Fail(c, response.CodeBadRequest, "资源编号无效")
		return
	}
	err = h.svc.remove(c.Request.Context(), middleware.CurrentUserID(c), id)
	if err != nil {
		switch {
		case errors.Is(err, errAssetNotFound):
			response.Fail(c, response.CodeNotFound, "资源不存在或已删除")
		case errors.Is(err, errAssetForbidden):
			response.Fail(c, response.CodeForbidden, "无权删除该资源")
		case errors.Is(err, errAssetPublished):
			response.Fail(c, response.CodeConflict, "该资源已发布为作品，请先取消发布")
		case errors.Is(err, errAssetProcessing):
			response.Fail(c, response.CodeConflict, "资源仍在生成中，完成后才能删除")
		default:
			response.Fail(c, response.CodeServerError, "failed to delete media asset")
		}
		return
	}
	response.OK[any](c, nil)
}

func (h *handler) batchDelete(c *gin.Context) {
	var dto batchDeleteDTO
	if err := c.ShouldBindJSON(&dto); err != nil || len(dto.IDs) == 0 || len(dto.IDs) > 100 {
		response.Fail(c, response.CodeBadRequest, "请选择 1 至 100 项资源")
		return
	}
	uid := middleware.CurrentUserID(c)
	result := batchDeleteVO{DeletedIDs: []string{}, BlockedIDs: []string{}, FailedIDs: []string{}}
	seen := make(map[idgen.ID]struct{}, len(dto.IDs))
	for _, raw := range dto.IDs {
		id, err := idgen.Parse(raw)
		if err != nil || id == 0 {
			result.FailedIDs = append(result.FailedIDs, raw)
			continue
		}
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}
		err = h.svc.remove(c.Request.Context(), uid, id)
		switch {
		case err == nil:
			result.DeletedIDs = append(result.DeletedIDs, raw)
		case errors.Is(err, errAssetPublished), errors.Is(err, errAssetProcessing):
			result.BlockedIDs = append(result.BlockedIDs, raw)
		default:
			result.FailedIDs = append(result.FailedIDs, raw)
		}
	}
	response.OK(c, result)
}

func normalizeHistoryQuery(query *historyQuery) error {
	query.Scope = strings.ToLower(strings.TrimSpace(query.Scope))
	if query.Scope == "" {
		query.Scope = "all"
	}
	if query.Scope != "all" && query.Scope != "project" {
		return errBadHistoryQuery
	}
	if query.Scope == "project" && query.ProjectID == 0 {
		return errBadHistoryQuery
	}
	query.MediaType = strings.ToLower(strings.TrimSpace(query.MediaType))
	if query.MediaType != "image" && query.MediaType != "video" && query.MediaType != "audio" {
		return errBadHistoryQuery
	}
	if query.PageSize <= 0 {
		query.PageSize = 36
	}
	if query.PageSize > 60 {
		query.PageSize = 60
	}
	query.OrderDirection = strings.ToLower(strings.TrimSpace(query.OrderDirection))
	if query.OrderDirection != "asc" {
		query.OrderDirection = "desc"
	}
	if rawSources := strings.TrimSpace(query.SourceIDs); rawSources != "" {
		parts := strings.Split(rawSources, ",")
		if len(parts) > 20 || query.Cursor != "" {
			return errBadHistoryQuery
		}
		seen := make(map[idgen.ID]struct{}, len(parts))
		for _, raw := range parts {
			id, err := idgen.Parse(strings.TrimSpace(raw))
			if err != nil || id == 0 {
				return errBadHistoryQuery
			}
			if _, exists := seen[id]; exists {
				continue
			}
			seen[id] = struct{}{}
			query.parsedSources = append(query.parsedSources, id)
		}
	}
	return nil
}

func (s *service) ensureBackfill(ctx context.Context, ownerID idgen.ID) error {
	key := ownerID.String()
	attempt := &backfillAttempt{done: make(chan struct{})}
	actual, loaded := s.backfilled.LoadOrStore(key, attempt)
	if loaded {
		existing := actual.(*backfillAttempt)
		select {
		case <-existing.done:
			return existing.err
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	attempt.err = BackfillOwner(ctx, s.db, ownerID)
	close(attempt.done)
	if attempt.err != nil {
		s.backfilled.Delete(key)
	}
	return attempt.err
}

func (s *service) list(ctx context.Context, ownerID idgen.ID, query historyQuery) (historyPageVO, error) {
	if err := normalizeHistoryQuery(&query); err != nil {
		return historyPageVO{}, err
	}
	if query.Scope == "project" {
		var count int64
		if err := s.db.WithContext(ctx).Model(&model.Project{}).
			Where("id = ? AND owner_id = ?", query.ProjectID, ownerID).Count(&count).Error; err != nil {
			return historyPageVO{}, err
		}
		if count == 0 {
			return historyPageVO{}, errAssetForbidden
		}
	}
	if err := s.ensureBackfill(ctx, ownerID); err != nil {
		return historyPageVO{}, err
	}
	if err := ReconcileOwnerProcessing(ctx, s.db, ownerID); err != nil {
		return historyPageVO{}, err
	}

	base := s.db.WithContext(ctx).Model(&model.MediaAsset{}).
		Where("owner_id = ? AND removed = ? AND status IN ?", ownerID, false, []int{StatusProcessing, StatusReady})
	if query.Scope == "project" {
		base = base.Where("project_id = ?", query.ProjectID)
	}

	counts := map[string]int64{"image": 0, "video": 0, "audio": 0}
	type countRow struct {
		MediaType string
		Total     int64
	}
	var countRows []countRow
	if err := base.Session(&gorm.Session{}).Select("media_type, COUNT(*) AS total").Group("media_type").Scan(&countRows).Error; err != nil {
		return historyPageVO{}, err
	}
	for _, row := range countRows {
		counts[row.MediaType] = row.Total
	}

	queryDB := base.Where("media_type = ?", query.MediaType)
	if len(query.parsedSources) > 0 {
		queryDB = queryDB.Where("source_id IN ?", query.parsedSources)
	}
	if query.Cursor != "" {
		cursorTime, cursorID, err := decodeCursor(query.Cursor)
		if err != nil {
			return historyPageVO{}, errBadHistoryQuery
		}
		if query.OrderDirection == "asc" {
			queryDB = queryDB.Where("create_time > ? OR (create_time = ? AND id > ?)", cursorTime, cursorTime, cursorID)
		} else {
			queryDB = queryDB.Where("create_time < ? OR (create_time = ? AND id < ?)", cursorTime, cursorTime, cursorID)
		}
	}
	order := "create_time DESC, id DESC"
	if query.OrderDirection == "asc" {
		order = "create_time ASC, id ASC"
	}
	var rows []model.MediaAsset
	limit := query.PageSize + 1
	if len(query.parsedSources) > 0 {
		// A live task can expand from one placeholder to several independent
		// outputs. Return every requested source atomically; no cursor is needed.
		limit = 201
	}
	if err := queryDB.Order(order).Limit(limit).Find(&rows).Error; err != nil {
		return historyPageVO{}, err
	}
	hasMore := len(query.parsedSources) == 0 && len(rows) > query.PageSize
	if hasMore {
		rows = rows[:query.PageSize]
	}
	progress := s.generationProgress(ctx, rows)
	vos := make([]mediaAssetVO, 0, len(rows))
	for index := range rows {
		row := &rows[index]
		vo := toMediaAssetVO(row)
		if value, exists := progress[row.SourceID]; exists && row.Status == StatusProcessing {
			vo.Progress = value
		}
		vos = append(vos, vo)
	}
	next := ""
	if hasMore && len(rows) > 0 {
		last := rows[len(rows)-1]
		next = encodeCursor(last.CreateTime, last.ID)
	}
	return historyPageVO{Records: vos, NextCursor: next, Counts: counts}, nil
}

func (s *service) generationProgress(ctx context.Context, assets []model.MediaAsset) map[idgen.ID]int {
	ids := make([]idgen.ID, 0)
	seen := make(map[idgen.ID]struct{})
	for _, item := range assets {
		if item.SourceType != SourceGeneration || item.Status != StatusProcessing {
			continue
		}
		if _, exists := seen[item.SourceID]; !exists {
			seen[item.SourceID] = struct{}{}
			ids = append(ids, item.SourceID)
		}
	}
	out := make(map[idgen.ID]int, len(ids))
	if len(ids) == 0 {
		return out
	}
	type progressRow struct {
		ID       idgen.ID
		Progress int
	}
	var rows []progressRow
	if err := s.db.WithContext(ctx).Model(&model.AiTask{}).Select("id", "progress").Where("id IN ?", ids).Scan(&rows).Error; err != nil {
		return out
	}
	for _, row := range rows {
		out[row.ID] = row.Progress
	}
	return out
}

func toMediaAssetVO(row *model.MediaAsset) mediaAssetVO {
	metadata := map[string]any{}
	if strings.TrimSpace(row.Metadata) != "" {
		_ = json.Unmarshal([]byte(row.Metadata), &metadata)
	}
	progress := 100
	if row.Status == StatusProcessing {
		progress = 5
	}
	return mediaAssetVO{
		ID: row.ID, ProjectID: row.ProjectID, SourceType: row.SourceType,
		SourceID: row.SourceID, OutputIndex: row.OutputIndex, MediaType: row.MediaType,
		NodeType: row.NodeType, Name: row.Name, URL: row.URL, ThumbnailURL: row.Thumbnail,
		MimeType: row.MimeType, Status: row.Status, Progress: progress, Metadata: metadata,
		CreateTime: row.CreateTime.Format(historyTimeLayout),
	}
}

func encodeCursor(createdAt time.Time, id idgen.ID) string {
	raw := strconv.FormatInt(createdAt.UnixNano(), 10) + ":" + id.String()
	return base64.RawURLEncoding.EncodeToString([]byte(raw))
}

func decodeCursor(value string) (time.Time, idgen.ID, error) {
	raw, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		return time.Time{}, 0, errors.New("invalid cursor")
	}
	parts := strings.SplitN(string(raw), ":", 2)
	if len(parts) != 2 {
		return time.Time{}, 0, errors.New("invalid cursor")
	}
	nanos, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		return time.Time{}, 0, errors.New("invalid cursor")
	}
	id, err := idgen.Parse(parts[1])
	if err != nil || id == 0 {
		return time.Time{}, 0, errors.New("invalid cursor")
	}
	return time.Unix(0, nanos), id, nil
}

type urlDeleter interface {
	DeleteURL(context.Context, string) error
}

func (s *service) remove(ctx context.Context, ownerID, id idgen.ID) error {
	var item model.MediaAsset
	if err := s.db.WithContext(ctx).First(&item, "id = ?", id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errAssetNotFound
		}
		return err
	}
	if item.OwnerID != ownerID {
		return errAssetForbidden
	}
	if item.Removed {
		return errAssetNotFound
	}
	if item.Status == StatusProcessing {
		return errAssetProcessing
	}
	if item.SourceType == SourceGeneration {
		var published int64
		if err := s.db.WithContext(ctx).Model(&model.CommunityPost{}).
			Where("task_id = ? AND status = ?", item.SourceID, 1).Count(&published).Error; err != nil {
			return err
		}
		if published > 0 {
			return errAssetPublished
		}
	}

	var storageKey string
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if item.SourceType == SourceUpload {
			var file model.File
			if err := tx.First(&file, "id = ? AND owner_id = ?", item.SourceID, ownerID).Error; err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
			if file.ID != 0 {
				storageKey = file.StorageKey
				if err := tx.Delete(&model.File{}, "id = ?", file.ID).Error; err != nil {
					return err
				}
				if file.FileSize > 0 {
					if err := tx.Model(&model.User{}).Where("id = ?", ownerID).
						UpdateColumn("storage_used", gorm.Expr("GREATEST(storage_used - ?, 0)", file.FileSize)).Error; err != nil {
						return err
					}
				}
			}
		}
		if err := tx.Model(&model.MediaAsset{}).Where("id = ? AND removed = ?", item.ID, false).
			Updates(map[string]any{"removed": true, "update_time": time.Now()}).Error; err != nil {
			return err
		}
		if item.SourceType == SourceGeneration {
			return reconcileGenerationAfterDelete(tx, &item)
		}
		return nil
	})
	if err != nil {
		return err
	}
	if storageKey != "" {
		if err := s.deps.Storage.Delete(ctx, storageKey); err != nil {
			logger.L().Warn("asset: upload object delete failed", zap.String("key", storageKey), zap.Error(err))
		}
	} else if item.SourceType == SourceGeneration && strings.TrimSpace(item.URL) != "" {
		if deleter, ok := s.deps.Storage.(urlDeleter); ok {
			if err := deleter.DeleteURL(ctx, item.URL); err != nil {
				logger.L().Warn("asset: generation object delete failed", zap.String("url", item.URL), zap.Error(err))
			}
		}
	}
	return nil
}

func reconcileGenerationAfterDelete(tx *gorm.DB, deleted *model.MediaAsset) error {
	var remaining []model.MediaAsset
	if err := tx.Where("source_type = ? AND source_id = ? AND status = ? AND removed = ?", SourceGeneration, deleted.SourceID, StatusReady, false).
		Order("output_index ASC").Find(&remaining).Error; err != nil {
		return err
	}
	if len(remaining) == 0 {
		if err := tx.Where("task_id = ? AND status <> ?", deleted.SourceID, 1).Delete(&model.CommunityPost{}).Error; err != nil {
			return err
		}
		return tx.Delete(&model.AiTask{}, "id = ?", deleted.SourceID).Error
	}
	var task model.AiTask
	if err := tx.First(&task, "id = ?", deleted.SourceID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return err
	}
	if err := tx.Model(&model.AiTask{}).Where("id = ?", task.ID).
		Update("result_url", remaining[0].URL).Error; err != nil {
		return err
	}
	// Unpublished work cards are regenerated from task history elsewhere; remove
	// the deleted URL's stale draft row without touching published content.
	pattern := "%" + strings.ReplaceAll(strings.ReplaceAll(deleted.URL, "%", "\\%"), "_", "\\_") + "%"
	return tx.Where("task_id = ? AND status <> ? AND (cover_url = ? OR content LIKE ?)", task.ID, 1, deleted.URL, pattern).
		Delete(&model.CommunityPost{}).Error
}
