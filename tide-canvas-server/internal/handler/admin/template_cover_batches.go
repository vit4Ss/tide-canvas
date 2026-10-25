package admin

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"tidecanvas/internal/handler/ai"
	"tidecanvas/internal/handler/points"
	"tidecanvas/internal/handler/studiotemplate"
	"tidecanvas/internal/middleware"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/logger"
	"tidecanvas/internal/pkg/response"
)

const coverBatchKey = "studio-template-covers"
const maxCoverBatch = 200

var errCoverBatchLeaseLost = errors.New("template cover worker lease lost")

type coverGenerator interface {
	Recover(context.Context, idgen.ID, ai.GenerationCommand) (idgen.ID, bool, error)
	Submit(context.Context, idgen.ID, ai.GenerationCommand) (idgen.ID, error)
	Get(context.Context, idgen.ID, idgen.ID) (*ai.TaskSnapshot, error)
}

type coverBatchService struct {
	db        *gorm.DB
	generator coverGenerator
	worker    string
}

type coverBatchFilter struct {
	Kind      string `json:"kind" binding:"omitempty,oneof=style inspiration"`
	MediaType string `json:"mediaType" binding:"omitempty,oneof=image video"`
	Category  string `json:"category" binding:"max=64"`
	Keyword   string `json:"keyword" binding:"max=128"`
	Status    string `json:"status" binding:"omitempty,oneof=0 1"`
}

type coverBatchPreview struct {
	Count      int                       `json:"count"`
	ModelID    string                    `json:"modelId"`
	ModelName  string                    `json:"modelName"`
	UnitCost   int                       `json:"unitCost"`
	TotalCost  int64                     `json:"totalCost"`
	Balance    int64                     `json:"balance"`
	QuoteToken string                    `json:"quoteToken"`
	Items      []model.TemplateCoverItem `json:"-"`
	ModelHash  string                    `json:"-"`
}

func (s *coverBatchService) preview(ctx context.Context, uid idgen.ID, filter coverBatchFilter) (coverBatchPreview, error) {
	q := s.db.WithContext(ctx).Model(&model.StudioTemplate{}).Where("(cover_url IS NULL OR TRIM(cover_url) = '')")
	if filter.Kind != "" {
		q = q.Where("kind = ?", filter.Kind)
	}
	if filter.MediaType != "" {
		q = q.Where("media_type = ?", filter.MediaType)
	}
	if filter.Category != "" {
		q = q.Where("category = ?", filter.Category)
	}
	if filter.Status != "" {
		q = q.Where("status = ?", filter.Status)
	}
	if filter.Keyword != "" {
		like := "%" + strings.NewReplacer("!", "!!", "%", "!%", "_", "!_").Replace(strings.TrimSpace(filter.Keyword)) + "%"
		q = q.Where("title LIKE ? ESCAPE '!' OR description LIKE ? ESCAPE '!'", like, like)
	}
	var rows []model.StudioTemplate
	if err := q.Order("id ASC").Limit(maxCoverBatch + 1).Find(&rows).Error; err != nil {
		return coverBatchPreview{}, err
	}
	if len(rows) > maxCoverBatch {
		return coverBatchPreview{}, errors.New("单批最多200张封面，请按分类筛选后分批处理")
	}
	var owner model.User
	if err := s.db.WithContext(ctx).First(&owner, "id = ?", uid).Error; err != nil {
		return coverBatchPreview{}, err
	}
	available, err := points.BalanceMicros(&owner)
	if err != nil {
		return coverBatchPreview{}, err
	}
	p := coverBatchPreview{Count: len(rows), Balance: available / model.PointScale}
	if len(rows) == 0 {
		return p, nil
	}
	plan, err := ai.PlanTemplateCover(ctx, s.db, rows[0])
	if err != nil {
		return p, err
	}
	p.ModelID, p.ModelName, p.ModelHash, p.UnitCost = plan.ModelID, plan.ModelName, plan.ModelHash, plan.PointCost
	for _, row := range rows {
		input := map[string]any{}
		for key, value := range plan.Input {
			input[key] = value
		}
		input["prompt"] = ai.TemplateCoverPrompt(row)
		p.Items = append(p.Items, model.TemplateCoverItem{TemplateID: row.ID, Title: row.Title, Description: row.Description, Category: row.Category, Input: input, Status: "pending"})
	}
	if int64(p.UnitCost) > math.MaxInt64/int64(p.Count) {
		return p, errors.New("预计积分超出范围")
	}
	p.TotalCost = int64(p.UnitCost) * int64(p.Count)
	if p.TotalCost < 0 {
		return p, errors.New("预计积分超出范围")
	}
	raw, _ := json.Marshal([]any{uid, p.ModelID, p.ModelHash, p.UnitCost, p.Items})
	sum := sha256.Sum256(raw)
	p.QuoteToken = hex.EncodeToString(sum[:])
	return p, nil
}

func (s *coverBatchService) create(ctx context.Context, uid idgen.ID, filter coverBatchFilter, token, requestID string) (*model.TemplateCoverBatch, error) {
	requestID = strings.TrimSpace(requestID)
	if requestID == "" || len(requestID) > 96 {
		return nil, errors.New("批量请求编号无效")
	}
	var existing model.TemplateCoverBatch
	err := s.db.WithContext(ctx).Where("user_id = ? AND request_id = ?", uid, requestID).First(&existing).Error
	if err == nil {
		if existing.QuoteToken != token {
			return nil, errors.New("请求编号已使用，请重新确认批次")
		}
		return &existing, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	if s.generator == nil {
		return nil, errors.New("封面生成服务未就绪")
	}
	p, err := s.preview(ctx, uid, filter)
	if err != nil {
		return nil, err
	}
	if p.Count == 0 {
		return nil, errors.New("当前筛选下没有需要补充封面的模板")
	}
	if token == "" || token != p.QuoteToken {
		return nil, errors.New("模板或模型价格已变化，请重新检查并确认积分")
	}
	key := coverBatchKey
	batch := model.TemplateCoverBatch{UserID: uid, RequestID: requestID, QuoteToken: token, ActiveKey: &key, ModelID: p.ModelID, ModelName: p.ModelName, ModelHash: p.ModelHash, UnitCost: p.UnitCost, Items: p.Items, Status: "running"}
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var user model.User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&user, "id = ?", uid).Error; err != nil {
			return err
		}
		if user.Status != 1 {
			return errors.New("当前账号不可用")
		}
		available, err := points.BalanceMicros(&user)
		if err != nil {
			return err
		}
		if available/model.PointScale < p.TotalCost {
			return errors.New("积分不足，无法开始这批封面生成")
		}
		var count int64
		if err := tx.Model(&model.TemplateCoverBatch{}).Where("active_key = ?", key).Count(&count).Error; err != nil {
			return err
		}
		if count > 0 {
			return errors.New("已有批量封面任务正在执行，请等待完成后再提交")
		}
		return tx.Create(&batch).Error
	})
	if err != nil {
		// Concurrent duplicate HTTP submissions reuse the same durable job.
		if e := s.db.WithContext(ctx).Where("user_id = ? AND request_id = ?", uid, requestID).First(&existing).Error; e == nil && existing.QuoteToken == token {
			return &existing, nil
		}
		return nil, err
	}
	return &batch, nil
}

func coverBatchView(batch *model.TemplateCoverBatch) any {
	if batch == nil {
		return nil
	}
	items := make([]gin.H, 0, len(batch.Items))
	counts := map[string]int{"pending": 0, "running": 0, "succeeded": 0, "failed": 0, "skipped": 0}
	for _, item := range batch.Items {
		counts[item.Status]++
		items = append(items, gin.H{"templateId": item.TemplateID, "title": item.Title, "taskId": item.TaskID, "status": item.Status, "message": item.Message, "resultUrl": item.ResultURL, "pointCost": item.PointCost})
	}
	return gin.H{"id": batch.ID, "status": batch.Status, "modelName": batch.ModelName, "unitCost": batch.UnitCost, "totalCost": int64(batch.UnitCost) * int64(len(items)), "total": len(items), "counts": counts, "items": items, "stopRequested": batch.StopRequested, "error": batch.Error}
}

func (s *coverBatchService) previewHTTP(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
	var filter coverBatchFilter
	if c.ShouldBindJSON(&filter) != nil {
		response.Fail(c, 400, "筛选条件无效")
		return
	}
	p, err := s.preview(c.Request.Context(), middleware.CurrentUserID(c), filter)
	if err != nil {
		response.Fail(c, 400, err.Error())
		return
	}
	response.OK(c, p)
}
func (s *coverBatchService) createHTTP(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
	var dto struct {
		Filter          coverBatchFilter `json:"filter"`
		QuoteToken      string           `json:"quoteToken"`
		ClientRequestID string           `json:"clientRequestId"`
	}
	if c.ShouldBindJSON(&dto) != nil {
		response.Fail(c, 400, "批量请求无效")
		return
	}
	b, err := s.create(c.Request.Context(), middleware.CurrentUserID(c), dto.Filter, dto.QuoteToken, dto.ClientRequestID)
	if err != nil {
		response.Fail(c, 400, err.Error())
		return
	}
	response.OK(c, coverBatchView(b))
}
func (s *coverBatchService) currentHTTP(c *gin.Context) {
	c.Header("Cache-Control", "private, no-store")
	var batch model.TemplateCoverBatch
	err := s.db.WithContext(c.Request.Context()).Where("user_id = ?", middleware.CurrentUserID(c)).Order("id DESC").First(&batch).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		response.OK[any](c, nil)
		return
	}
	if err != nil {
		response.Fail(c, 500, "批量进度读取失败")
		return
	}
	response.OK(c, coverBatchView(&batch))
}
func (s *coverBatchService) stopHTTP(c *gin.Context) {
	id, err := idgen.Parse(c.Param("batchId"))
	if err != nil || id == 0 {
		response.Fail(c, 400, "批次编号无效")
		return
	}
	var owned model.TemplateCoverBatch
	if err := s.db.WithContext(c.Request.Context()).Select("id", "active_key", "stop_requested").Where("id = ? AND user_id = ?", id, middleware.CurrentUserID(c)).First(&owned).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			response.Fail(c, 404, "批量任务不存在")
		} else {
			response.Fail(c, 500, "读取批量任务失败")
		}
		return
	}
	if owned.ActiveKey == nil || owned.StopRequested {
		response.OK(c, gin.H{"ok": true})
		return
	}
	result := s.db.WithContext(c.Request.Context()).Model(&model.TemplateCoverBatch{}).Where("id = ? AND user_id = ? AND active_key = ?", id, middleware.CurrentUserID(c), coverBatchKey).Update("stop_requested", true)
	if result.Error != nil {
		response.Fail(c, 500, "暂停后续生成失败")
		return
	}
	response.OK(c, gin.H{"ok": true})
}
func (s *coverBatchService) getHTTP(c *gin.Context) {
	c.Header("Cache-Control", "private, no-store")
	id, err := idgen.Parse(c.Param("batchId"))
	if err != nil || id == 0 {
		response.Fail(c, 400, "批次编号无效")
		return
	}
	var batch model.TemplateCoverBatch
	if err := s.db.WithContext(c.Request.Context()).Where("id = ? AND user_id = ?", id, middleware.CurrentUserID(c)).First(&batch).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			response.Fail(c, 404, "批量任务不存在")
		} else {
			response.Fail(c, 500, "读取批量任务失败")
		}
		return
	}
	response.OK(c, coverBatchView(&batch))
}

func (s *coverBatchService) run(ctx context.Context) {
	timer := time.NewTicker(2 * time.Second)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
			tick, cancel := context.WithTimeout(ctx, 20*time.Second)
			if err := s.tick(tick); err != nil && !errors.Is(err, errCoverBatchLeaseLost) {
				logger.L().Warn("template cover batch worker failed", zap.Error(err))
			}
			cancel()
		}
	}
}

func (s *coverBatchService) tick(ctx context.Context) error {
	var batch model.TemplateCoverBatch
	if err := s.db.WithContext(ctx).Where("active_key = ?", coverBatchKey).First(&batch).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return err
	}
	now := time.Now()
	// Each tick is bounded to 20 seconds. Renew only when fewer than 25
	// seconds remain, rather than rewriting a large JSON batch every poll.
	if batch.Worker != s.worker || batch.LeaseUntil == nil || !batch.LeaseUntil.After(now.Add(25*time.Second)) {
		result := s.db.WithContext(ctx).Model(&model.TemplateCoverBatch{}).
			Where("id = ? AND active_key = ? AND (lease_until IS NULL OR lease_until < ? OR worker = ?)", batch.ID, coverBatchKey, now, s.worker).
			Updates(map[string]any{"worker": s.worker, "lease_until": now.Add(45 * time.Second)})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return nil
		}
		if err := s.db.WithContext(ctx).Where("active_key = ? AND worker = ?", coverBatchKey, s.worker).First(&batch).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			}
			return err
		}
	}
	for i := range batch.Items {
		item := &batch.Items[i]
		if item.Status != "pending" && item.Status != "running" {
			continue
		}
		if item.TaskID == 0 {
			// Recover a task committed just before a crash before considering
			// cancellation or changes to the template.
			requestID := fmt.Sprintf("template-cover:%s:%s", batch.ID, item.TemplateID)
			command := ai.GenerationCommand{ClientRequestID: requestID, TemplateCoverModelHash: batch.ModelHash, TemplateCoverBatchID: batch.ID, TemplateCoverTemplateID: item.TemplateID, TemplateCoverWorker: s.worker, ModelID: batch.ModelID, Handler: "text_to_image", Input: item.Input, Origin: "direct", RegisterWork: false}
			existingID, found, err := s.generator.Recover(ctx, batch.UserID, command)
			if found && err != nil {
				item.Status = "failed"
				item.Message = "原请求与批次不一致，已停止后续生成"
				batch.Error = item.Message
				batch.StopRequested = true
				return s.saveBatch(ctx, &batch)
			}
			if err != nil {
				return err
			}
			if found {
				item.TaskID = existingID
				item.Status = "running"
				return s.saveBatch(ctx, &batch)
			}
			if batch.StopRequested {
				item.Status = "skipped"
				item.Message = "已停止后续生成"
				// Persist each checked item before querying the next one. A
				// slow recovery lookup must not restart a large stop from zero.
				if err := s.saveBatch(ctx, &batch); err != nil {
					return err
				}
				continue
			}
			var row model.StudioTemplate
			err = s.db.WithContext(ctx).First(&row, "id = ?", item.TemplateID).Error
			if errors.Is(err, gorm.ErrRecordNotFound) || err == nil && (strings.TrimSpace(row.CoverURL) != "" || row.Title != item.Title || row.Description != item.Description || row.Category != item.Category) {
				item.Status = "skipped"
				item.Message = "模板已更新、删除或已有封面"
				return s.saveBatch(ctx, &batch)
			}
			if err != nil {
				return err
			}
			var gate model.TemplateCoverBatch
			if err := s.db.WithContext(ctx).Select("id", "active_key", "worker", "lease_until", "stop_requested").First(&gate, "id = ?", batch.ID).Error; err != nil {
				return err
			}
			if gate.ActiveKey == nil || gate.Worker != s.worker || gate.LeaseUntil == nil || !gate.LeaseUntil.After(time.Now()) {
				return nil
			}
			if gate.StopRequested {
				item.Status = "skipped"
				item.Message = "已停止后续生成"
				return s.saveBatch(ctx, &batch)
			}
			item.Attempts++
			taskID, err := s.generator.Submit(ctx, batch.UserID, command)
			if err != nil {
				item.Message = "提交暂未成功，正在确认原请求"
				if item.Attempts >= 3 {
					// One final lookup avoids treating an accepted-but-lost
					// response as permission to submit a new paid request.
					existingID, found, e := s.generator.Recover(ctx, batch.UserID, command)
					if e == nil && found {
						item.TaskID = existingID
						item.Status = "running"
					} else if e == nil || found {
						item.Status = "failed"
						item.Message = "提交失败，请检查模型状态和积分后重试"
						batch.Error = item.Message
						batch.StopRequested = true
					} else {
						return e
					}
				}
			} else {
				item.TaskID = taskID
				item.Status = "running"
				item.Message = ""
			}
			return s.saveBatch(ctx, &batch)
		}
		task, err := s.generator.Get(ctx, batch.UserID, item.TaskID)
		if err != nil {
			if ai.IsTaskMissing(err) {
				item.Status = "failed"
				item.Message = "原生成任务已不存在，已停止后续生成"
				batch.Error = item.Message
				batch.StopRequested = true
				return s.saveBatch(ctx, &batch)
			}
			return err
		}
		previousCost := item.PointCost
		item.PointCost = task.PointCost
		if task.Status == ai.TaskProcessing {
			if previousCost != task.PointCost {
				return s.saveBatch(ctx, &batch)
			}
			return nil
		}
		if task.Status != ai.TaskSuccess {
			item.Status = "failed"
			item.Message = "生成未成功，按原生成任务流程处理退款"
			return s.saveBatch(ctx, &batch)
		}
		url := strings.TrimSpace(task.ResultURL)
		if url == "" {
			var meta struct {
				URLs []string `json:"urls"`
			}
			if json.Unmarshal([]byte(task.ResultMeta), &meta) == nil {
				for _, value := range meta.URLs {
					if value != "" && studiotemplate.SafeMediaURL(value) {
						url = value
						break
					}
				}
			}
		}
		if url == "" || !studiotemplate.SafeMediaURL(url) {
			item.Status = "failed"
			item.Message = "任务没有可用的封面结果，请检查生成记录"
			return s.saveBatch(ctx, &batch)
		}
		item.ResultURL = url
		result := s.db.WithContext(ctx).Model(&model.StudioTemplate{}).
			Where("id = ? AND (cover_url IS NULL OR TRIM(cover_url) = '') AND title = ? AND COALESCE(description,'') = ? AND COALESCE(category,'') = ?", item.TemplateID, item.Title, item.Description, item.Category).
			Update("cover_url", url)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected > 0 {
			item.Status = "succeeded"
			item.Message = "封面已保存"
		} else {
			// Recover a crash after the conditional cover update.
			var row model.StudioTemplate
			err = s.db.WithContext(ctx).First(&row, "id = ?", item.TemplateID).Error
			if err == nil && row.CoverURL == url {
				item.Status = "succeeded"
				item.Message = "封面已保存"
			} else if err == nil || errors.Is(err, gorm.ErrRecordNotFound) {
				item.Status = "skipped"
				item.Message = "图片已生成，模板已有封面或已变更，未覆盖"
			} else {
				return err
			}
		}
		return s.saveBatch(ctx, &batch)
	}
	batch.Status = "completed"
	if batch.StopRequested {
		batch.Status = "stopped"
	}
	batch.ActiveKey = nil
	return s.saveBatch(ctx, &batch)
}

func (s *coverBatchService) saveBatch(ctx context.Context, batch *model.TemplateCoverBatch) error {
	fields := []string{"Items", "Status", "Error", "ActiveKey"}
	// Only set the flag, never clear an operator's concurrent stop. Persist
	// automatic stops together with their item/error and fence every write,
	// including stops, against lease expiry or another process taking over.
	if batch.StopRequested {
		fields = append(fields, "StopRequested")
	}
	result := s.db.WithContext(ctx).Model(batch).
		Where("worker = ? AND active_key = ? AND lease_until > ?", s.worker, coverBatchKey, time.Now()).
		Select(fields).Updates(batch)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return errCoverBatchLeaseLost
	}
	return nil
}
