package admin

import (
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/gin-gonic/gin/binding"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"tidecanvas/internal/handler/ai"
	"tidecanvas/internal/handler/studiotemplate"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/response"
)

type templateFillResult struct {
	ID      idgen.ID `json:"id"`
	Title   string   `json:"title"`
	Status  string   `json:"status"`
	Message string   `json:"message"`
}

func templateFillQuery(db *gorm.DB, filter coverBatchFilter) *gorm.DB {
	q := db.Model(&model.StudioTemplate{}).Where("media_type = ?", "video")
	if filter.Kind != "" {
		q = q.Where("kind = ?", filter.Kind)
	}
	if filter.Category != "" {
		q = q.Where("category = ?", filter.Category)
	}
	if filter.Status != "" {
		q = q.Where("status = ?", filter.Status)
	}
	if word := strings.TrimSpace(filter.Keyword); word != "" {
		like := "%" + strings.NewReplacer("!", "!!", "%", "!%", "_", "!_").Replace(word) + "%"
		q = q.Where("title LIKE ? ESCAPE '!' OR description LIKE ? ESCAPE '!'", like, like)
	}
	return q
}

func (h *studioTemplatesHandler) fillFromPrompts(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
	var request struct {
		coverBatchFilter
		Publish bool `json:"publish"`
	}
	if c.ShouldBindJSON(&request) != nil || (request.MediaType != "" && request.MediaType != "video") {
		response.Fail(c, 400, "请选择视频模板后再自动填充")
		return
	}
	filter := request.coverBatchFilter
	ctx := c.Request.Context()
	var rows []model.StudioTemplate
	if err := templateFillQuery(h.db.WithContext(ctx), filter).Select("id", "title").Order("id ASC").Limit(201).Find(&rows).Error; err != nil {
		response.Fail(c, 500, "读取待填充模板失败，请重试")
		return
	}
	if len(rows) > 200 {
		response.Fail(c, 400, "单次最多处理200个模板，请按分类筛选后操作")
		return
	}
	items := make([]templateFillResult, 0, len(rows))
	for _, candidate := range rows {
		if ctx.Err() != nil {
			return
		}
		item := templateFillResult{ID: candidate.ID, Title: candidate.Title}
		err := h.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			// Read current values under the row lock. Publication is explicit,
			// and config plus status commit only after the normal checks pass.
			var row model.StudioTemplate
			if err := templateFillQuery(tx, filter).Clauses(clause.Locking{Strength: "UPDATE"}).First(&row, "id = ?", candidate.ID).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					item.Status, item.Message = "skipped", "模板已删除或不再符合当前筛选"
					return nil
				}
				return err
			}
			item.Title = row.Title
			if !request.Publish && model.TemplateVideoPromptOptions(row.Prompt).Duration == 0 {
				item.Status, item.Message = "skipped", "提示词开头没有可识别的视频时长"
				return nil
			}
			filled := templateFillDefaults(row)
			var err error
			if request.Publish {
				filled.Status = 1
				if err = validateTemplatePublication(filled); err == nil {
					setup, checkErr := ai.CheckStudioTemplate(ctx, tx, filled)
					err = checkErr
					if err == nil {
						filled.ModelKey, filled.Options = setup.ModelID, setup.Options
					}
				}
			} else {
				filled, err = fillStudioTemplateFromPrompt(ctx, tx, row)
			}
			if err != nil {
				item.Status, item.Message = "failed", err.Error()
				return nil
			}
			if row.ModelKey == filled.ModelKey && row.Options == filled.Options && row.Status == filled.Status {
				item.Status, item.Message = "skipped", "模型与参数已填写，无需更新"
				if request.Publish {
					item.Message = "已上架且配置未变化"
				}
				return nil
			}
			fields := []string{"ModelKey", "Options"}
			if request.Publish {
				fields = append(fields, "Status")
			}
			if err := tx.Model(&row).Select(fields).Updates(&filled).Error; err != nil {
				return err
			}
			item.Status, item.Message = "saved", "已填充并保存"
			if request.Publish {
				item.Status, item.Message = "published", "配置校验通过，已上架"
			}
			return nil
		})
		if err != nil {
			item.Status, item.Message = "failed", "保存结果未能确认，请刷新列表核对后重试"
		}
		items = append(items, item)
	}
	counts := map[string]int{"saved": 0, "published": 0, "skipped": 0, "failed": 0}
	for _, item := range items {
		counts[item.Status]++
	}
	response.OK(c, gin.H{"total": len(items), "counts": counts, "items": items, "publish": request.Publish})
}

// Applied only by autofill, not when running an existing recipe. Re-clicking
// upgrades the old 480p default, while retaining higher or other explicit sizes.
func templateFillDefaults(row model.StudioTemplate) model.StudioTemplate {
	row = model.WithTemplatePromptDefaults(row)
	if row.MediaType == "video" {
		switch strings.ToLower(strings.TrimSpace(row.Options.Resolution)) {
		case "", "480", "480p":
			row.Options.Resolution = "720p"
		}
	}
	return row
}

// Match the ordinary admin save's field and publication validation. Validate a
// copy because normalization must not rewrite the template's display content.
func validateTemplatePublication(row model.StudioTemplate) error {
	dto := studiotemplate.SaveDTO{
		Kind: row.Kind, MediaType: row.MediaType, Title: row.Title,
		Description: row.Description, Category: row.Category, Prompt: row.Prompt,
		CoverURL: row.CoverURL, PreviewURL: row.PreviewURL, AuthorName: row.AuthorName,
		InputHint: row.InputHint, Mode: row.Mode, ModelKey: row.ModelKey,
		Requirements: row.Requirements, Options: row.Options, Status: 1, SortOrder: row.SortOrder,
		InputLabels: model.StudioTemplateInputLabels{
			Images: append([]string(nil), row.InputLabels.Images...),
			Videos: append([]string(nil), row.InputLabels.Videos...),
			Audio:  append([]string(nil), row.InputLabels.Audio...),
		},
	}
	if err := binding.Validator.ValidateStruct(&dto); err != nil {
		return errors.New("模板名称、提示词或字段格式不完整，请打开编辑检查后再上架")
	}
	return dto.Validate()
}
