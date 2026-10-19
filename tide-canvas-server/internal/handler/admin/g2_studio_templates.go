package admin

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"tidecanvas/internal/app"
	"tidecanvas/internal/handler/studiotemplate"
	"tidecanvas/internal/middleware"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/response"
)

func RegisterStudioTemplates(g *gin.RouterGroup, d *app.Deps) {
	h := &studioTemplatesHandler{db: d.DB}
	s := g.Group("/studio-templates")
	s.GET("", (&studiotemplate.Handler{DB: d.DB}).List(true))
	s.POST("", h.save)
	s.PUT("/:id", h.save)
	s.DELETE("/:id", h.remove)
	// Access to unpublished user generations also needs the generation module.
	s.GET("/sources", middleware.AdminPerm("admin.generations"), h.sources)
	s.POST("/from-task", middleware.AdminPerm("admin.generations"), h.fromTask)
}

type studioTemplatesHandler struct{ db *gorm.DB }

func (h *studioTemplatesHandler) save(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 128<<10)
	var dto studiotemplate.SaveDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, 400, "请检查名称、提示词、媒体类型和参数长度")
		return
	}
	if err := dto.Validate(); err != nil {
		response.Fail(c, 400, err.Error())
		return
	}
	row := dto.Row()
	if c.Param("id") == "" {
		if err := h.db.Create(&row).Error; err != nil {
			response.Fail(c, 500, "创建模板失败")
			return
		}
	} else {
		id, err := idgen.Parse(c.Param("id"))
		if err != nil || id == 0 {
			response.Fail(c, 400, "模板编号无效")
			return
		}
		var old model.StudioTemplate
		if err := h.db.First(&old, "id = ?", id).Error; err != nil {
			response.Fail(c, 404, "模板不存在")
			return
		}
		row.BaseModel = old.BaseModel
		// Explicit fields include zero values, and never overwrite source/uses.
		if err := h.db.Model(&old).Select("Kind", "MediaType", "Title", "Description", "Category", "Prompt", "CoverURL", "PreviewURL", "AuthorName", "InputHint", "Mode", "ModelKey", "Requirements", "Options", "Status", "SortOrder").Updates(&row).Error; err != nil {
			response.Fail(c, 500, "保存模板失败")
			return
		}
		row.Uses = old.Uses
	}
	response.OK(c, row)
}

func (h *studioTemplatesHandler) remove(c *gin.Context) {
	id, err := idgen.Parse(c.Param("id"))
	if err != nil || id == 0 {
		response.Fail(c, 400, "模板编号无效")
		return
	}
	err = h.db.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var row model.StudioTemplate
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&row, "id = ?", id).Error; err != nil {
			return err
		}
		// Release the unique source claim in the same transaction as deletion,
		// so the operator can intentionally import this result again later.
		if row.SourceKey != nil && strings.HasPrefix(*row.SourceKey, "task:") {
			if err := tx.Model(&row).Update("source_key", nil).Error; err != nil {
				return err
			}
		}
		return tx.Delete(&row).Error
	})
	if errors.Is(err, gorm.ErrRecordNotFound) {
		response.Fail(c, 404, "模板不存在")
		return
	}
	if err != nil {
		response.Fail(c, 500, "删除模板失败")
		return
	}
	response.OK(c, gin.H{"ok": true})
}

var studioTemplateModes = map[string]string{"text_to_image": "t2i", "image_to_image": "i2i", "text_to_video": "t2v", "image_to_video": "i2v", "start_end_to_video": "flf", "reference_to_video": "ref"}

func sourceQuery(db *gorm.DB) *gorm.DB {
	return db.Model(&model.AiTask{}).Where("status = 1 AND result_url <> '' AND skill_run_id = 0 AND (origin = 'direct' OR origin = '')").Where("handler IN ?", []string{"text_to_image", "image_to_image", "text_to_video", "image_to_video", "start_end_to_video", "reference_to_video"})
}

type studioSource struct {
	ID         idgen.ID `json:"id"`
	UserID     idgen.ID `json:"userId"`
	Model      string   `json:"model"`
	MediaType  string   `json:"mediaType"`
	Prompt     string   `json:"prompt"`
	ResultURL  string   `json:"resultUrl"`
	CreateTime string   `json:"createTime"`
}

func (h *studioTemplatesHandler) sources(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("pageNum", "1"))
	if page < 1 || page > 10000 {
		page = 1
	}
	q := sourceQuery(h.db.WithContext(c.Request.Context()))
	if raw := c.Query("userId"); raw != "" {
		uid, err := idgen.Parse(raw)
		if err != nil || uid == 0 {
			response.Fail(c, 400, "用户编号无效")
			return
		}
		q = q.Where("user_id = ?", uid)
	}
	if raw := c.Query("taskId"); raw != "" {
		id, err := idgen.Parse(raw)
		if err != nil || id == 0 {
			response.Fail(c, 400, "任务编号无效")
			return
		}
		q = q.Where("id = ?", id)
	}
	var total int64
	var tasks []model.AiTask
	if err := q.Count(&total).Error; err != nil {
		response.Fail(c, 500, "读取生成记录失败")
		return
	}
	if err := q.Order("id DESC").Limit(18).Offset((page - 1) * 18).Find(&tasks).Error; err != nil {
		response.Fail(c, 500, "读取生成记录失败")
		return
	}
	rows := []studioSource{}
	for _, task := range tasks {
		var in map[string]any
		_ = json.Unmarshal([]byte(task.Input), &in)
		prompt, _ := in["prompt"].(string)
		// A preset Skill's execution prompt is not a public template prompt.
		if in["skillId"] != nil {
			prompt = ""
		}
		media := "image"
		if strings.HasSuffix(task.Handler, "video") {
			media = "video"
		}
		rows = append(rows, studioSource{ID: task.ID, UserID: task.UserID, Model: task.ModelName, MediaType: media, Prompt: prompt, ResultURL: task.ResultUrl, CreateTime: task.CreateTime.Format("2006-01-02 15:04:05")})
	}
	c.Header("Cache-Control", "private, no-store")
	response.Page(c, rows, total, page, 18)
}

func (h *studioTemplatesHandler) fromTask(c *gin.Context) {
	var dto struct {
		TaskID idgen.ID `json:"taskId" binding:"required"`
	}
	if c.ShouldBindJSON(&dto) != nil {
		response.Fail(c, 400, "请选择生成任务")
		return
	}
	var task model.AiTask
	if err := sourceQuery(h.db).Where("id = ?", dto.TaskID).First(&task).Error; err != nil {
		response.Fail(c, 404, "仅支持已完成的图片、视频直接生成任务")
		return
	}
	key := "task:" + task.ID.String()
	var existing model.StudioTemplate
	if err := h.db.Where("source_key = ?", key).First(&existing).Error; err == nil {
		response.OK(c, existing)
		return
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		response.Fail(c, 500, "读取导入状态失败")
		return
	}
	var in map[string]any
	_ = json.Unmarshal([]byte(task.Input), &in)
	prompt, _ := in["prompt"].(string)
	if in["skillId"] != nil {
		prompt = ""
	}
	row := model.StudioTemplate{Kind: "inspiration", MediaType: "image", Title: "新的创作灵感", Prompt: prompt, Mode: studioTemplateModes[task.Handler], ModelKey: task.ModelName, SourceKey: &key, InputHint: "请上传你自己的参考素材，确认提示词后生成。"}
	if len([]rune(prompt)) > 20000 {
		row.Prompt = string([]rune(prompt)[:20000])
	}
	if strings.HasSuffix(task.Handler, "video") {
		row.MediaType = "video"
		row.PreviewURL = task.ResultUrl
	} else {
		row.CoverURL = task.ResultUrl
	}
	if !studiotemplate.SafeMediaURL(task.ResultUrl) {
		response.Fail(c, 400, "任务结果不是可使用的媒体地址")
		return
	}
	if row.Mode == "i2i" || row.Mode == "i2v" {
		row.Requirements.Images = 1
	}
	if row.Mode == "i2i" || row.Mode == "ref" {
		row.Requirements.Images = min(4, max(row.Requirements.Images, templateSourceRefCount(in, "imageList", "imageUrls", "references")))
	}
	if row.Mode == "ref" {
		row.Requirements.Videos = min(3, templateSourceRefCount(in, "videoReferences", "videoUrls"))
		row.Requirements.Audio = min(3, templateSourceRefCount(in, "audioReferences", "audioUrls"))
	}
	if row.Mode == "flf" {
		row.Requirements.Images = 2
	}
	// Only an allowlist of generation options is copied. Reference URLs, user
	// identity, private workflow prompts and provider payloads stay private.
	row.Options.AspectRatio, _ = in["aspectRatio"].(string)
	row.Options.Resolution, _ = in["resolution"].(string)
	row.Options.Quality, _ = in["quality"].(string)
	if v, ok := in["duration"].(float64); ok && v > 0 && v <= 600 {
		row.Options.Duration = int(v)
	}
	if err := h.db.Create(&row).Error; err != nil {
		if e := h.db.Where("source_key = ?", key).First(&existing).Error; e == nil {
			response.OK(c, existing)
			return
		}
		response.Fail(c, 500, "导入失败，请稍后重试")
		return
	}
	response.OK(c, row)
}

func templateSourceRefCount(input map[string]any, keys ...string) int {
	count := 0
	for _, key := range keys {
		if items, ok := input[key].([]any); ok {
			n := 0
			for _, item := range items {
				if raw, ok := item.(string); ok && strings.TrimSpace(raw) != "" {
					n++
				}
			}
			count = max(count, n)
		}
	}
	return count
}
