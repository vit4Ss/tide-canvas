// Package studiotemplate serves curated styles and ready-to-remix inspirations.
package studiotemplate

import (
	"errors"
	"net/url"
	"path"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"tidecanvas/internal/app"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/response"
)

type Handler struct{ DB *gorm.DB }

// PublicTemplate deliberately excludes the operator's private recipe.
type PublicTemplate struct {
	ID           idgen.ID                         `json:"id"`
	Kind         string                           `json:"kind"`
	MediaType    string                           `json:"mediaType"`
	Title        string                           `json:"title"`
	Description  string                           `json:"description"`
	Category     string                           `json:"category"`
	CoverURL     string                           `json:"coverUrl"`
	PreviewURL   string                           `json:"previewUrl"`
	AuthorName   string                           `json:"authorName"`
	InputHint    string                           `json:"inputHint"`
	InputLabels  model.StudioTemplateInputLabels  `json:"inputLabels"`
	Mode         string                           `json:"mode"`
	Requirements model.StudioTemplateRequirements `json:"requirements"`
	Options      model.StudioTemplateOptions      `json:"options"`
	Uses         int64                            `json:"uses"`
}

func publicTemplate(row model.StudioTemplate) PublicTemplate {
	row = model.WithTemplatePromptDefaults(row)
	return PublicTemplate{ID: row.ID, Kind: row.Kind, MediaType: row.MediaType, Title: row.Title,
		Description: row.Description, Category: row.Category, CoverURL: row.CoverURL, PreviewURL: row.PreviewURL,
		AuthorName: row.AuthorName, InputHint: row.InputHint, InputLabels: row.InputLabels, Mode: row.Mode, Requirements: row.Requirements, Options: row.Options, Uses: row.Uses}
}

func Register(api *gin.RouterGroup, d *app.Deps) {
	h := &Handler{DB: d.DB}
	g := api.Group("/studio-templates")
	g.GET("", h.List(false))
	g.GET("/:id", h.Get)
}

type Query struct {
	PageNum   int    `form:"pageNum"`
	PageSize  int    `form:"pageSize"`
	Kind      string `form:"kind" binding:"omitempty,oneof=style inspiration"`
	MediaType string `form:"mediaType" binding:"omitempty,oneof=image video"`
	Category  string `form:"category" binding:"max=64"`
	Keyword   string `form:"keyword" binding:"max=128"`
	Status    string `form:"status" binding:"omitempty,oneof=0 1"`
	Order     string `form:"order" binding:"omitempty,oneof=sort newest"`
}

func (h *Handler) List(admin bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Cache-Control", "no-store")
		var q Query
		if c.ShouldBindQuery(&q) != nil {
			response.Fail(c, 400, "筛选条件无效")
			return
		}
		if q.PageNum < 1 {
			q.PageNum = 1
		}
		if q.PageNum > 10000 {
			response.Fail(c, 400, "页码过大")
			return
		}
		if q.PageSize < 1 || q.PageSize > 60 {
			q.PageSize = 24
		}
		base := h.DB.WithContext(c.Request.Context()).Model(&model.StudioTemplate{})
		if !admin {
			base = base.Where("status = 1")
		} else if q.Status != "" {
			base = base.Where("status = ?", q.Status)
		}
		if q.Kind != "" {
			base = base.Where("kind = ?", q.Kind)
		}
		if q.MediaType != "" {
			base = base.Where("media_type = ?", q.MediaType)
		}
		var categories []string
		if err := base.Session(&gorm.Session{}).Where("category <> ''").Distinct("category").Order("category").Pluck("category", &categories).Error; err != nil {
			response.Fail(c, 500, "读取分类失败")
			return
		}
		tx := base.Session(&gorm.Session{})
		if q.Category != "" {
			tx = tx.Where("category = ?", q.Category)
		}
		if q.Keyword != "" {
			like := "%" + strings.NewReplacer("!", "!!", "%", "!%", "_", "!_").Replace(q.Keyword) + "%"
			tx = tx.Where("title LIKE ? ESCAPE '!' OR description LIKE ? ESCAPE '!'", like, like)
		}
		var total int64
		var rows []model.StudioTemplate
		if err := tx.Count(&total).Error; err != nil {
			response.Fail(c, 500, "读取模板失败")
			return
		}
		order := "sort_order ASC, id DESC"
		if admin && q.Order == "newest" {
			order = "create_time DESC, id DESC"
		}
		if err := tx.Order(order).Limit(q.PageSize).Offset((q.PageNum - 1) * q.PageSize).Find(&rows).Error; err != nil {
			response.Fail(c, 500, "读取模板失败")
			return
		}
		if rows == nil {
			rows = []model.StudioTemplate{}
		}
		for i := range rows {
			rows[i] = model.WithTemplatePromptDefaults(rows[i])
		}
		if categories == nil {
			categories = []string{}
		}
		var records any = rows
		if !admin {
			public := make([]PublicTemplate, 0, len(rows))
			for _, row := range rows {
				public = append(public, publicTemplate(row))
			}
			records = public
		}
		response.OK(c, gin.H{"records": records, "total": total, "pageNum": q.PageNum, "pageSize": q.PageSize, "pages": (total + int64(q.PageSize) - 1) / int64(q.PageSize), "categories": categories})
	}
}

func (h *Handler) Get(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	id, err := idgen.Parse(c.Param("id"))
	if err != nil || id == 0 {
		response.Fail(c, 400, "模板编号无效")
		return
	}
	var row model.StudioTemplate
	if err := h.DB.WithContext(c.Request.Context()).Where("id = ? AND status = 1", id).First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			response.Fail(c, 404, "模板已下架或不存在")
		} else {
			response.Fail(c, 500, "读取模板失败")
		}
		return
	}
	response.OK(c, publicTemplate(row))
}

type SaveDTO struct {
	Kind         string                           `json:"kind" binding:"required,oneof=style inspiration"`
	MediaType    string                           `json:"mediaType" binding:"required,oneof=image video"`
	Title        string                           `json:"title" binding:"required,max=128"`
	Description  string                           `json:"description" binding:"max=512"`
	Category     string                           `json:"category" binding:"max=64"`
	Prompt       string                           `json:"prompt" binding:"max=20000"`
	CoverURL     string                           `json:"coverUrl" binding:"max=2048"`
	PreviewURL   string                           `json:"previewUrl" binding:"max=2048"`
	AuthorName   string                           `json:"authorName" binding:"max=64"`
	InputHint    string                           `json:"inputHint" binding:"max=1024"`
	InputLabels  model.StudioTemplateInputLabels  `json:"inputLabels"`
	Mode         string                           `json:"mode" binding:"required,oneof=t2i i2i t2v i2v flf ref"`
	ModelKey     string                           `json:"modelKey" binding:"max=128"`
	Requirements model.StudioTemplateRequirements `json:"requirements"`
	Options      model.StudioTemplateOptions      `json:"options"`
	Status       int                              `json:"status" binding:"oneof=0 1"`
	SortOrder    int                              `json:"sortOrder" binding:"min=0,max=100000"`
}

func SafeMediaURL(raw string) bool {
	if raw == "" {
		return true
	}
	if strings.HasPrefix(raw, "/static/") && !strings.ContainsAny(raw, "\\\r\n") {
		return true
	}
	// Bundled starter artwork is served by the main frontend, not OSS. Allow
	// only canonical files under this dedicated directory, never traversal.
	if strings.HasPrefix(raw, "/studio-samples/v1/") {
		u, err := url.Parse(raw)
		return err == nil && u.RawQuery == "" && u.Fragment == "" && u.Path == raw && path.Clean(u.Path) == u.Path && strings.HasSuffix(u.Path, ".webp") && !strings.ContainsAny(raw, "\\\r\n")
	}
	u, e := url.Parse(raw)
	return e == nil && (u.Scheme == "http" || u.Scheme == "https") && u.Hostname() != "" && u.User == nil && !strings.ContainsAny(raw, "\\\r\n")
}

func (d *SaveDTO) Validate() error {
	d.Title = strings.TrimSpace(d.Title)
	d.Prompt = strings.TrimSpace(d.Prompt)
	d.Category = strings.TrimSpace(d.Category)
	d.CoverURL = strings.TrimSpace(d.CoverURL)
	d.PreviewURL = strings.TrimSpace(d.PreviewURL)
	d.ModelKey = strings.TrimSpace(d.ModelKey)
	d.Options.AspectRatio = strings.TrimSpace(d.Options.AspectRatio)
	d.Options.Resolution = strings.TrimSpace(d.Options.Resolution)
	d.Options.Quality = strings.TrimSpace(d.Options.Quality)
	d.Options = model.WithTemplatePromptDefaults(d.Row()).Options
	if d.Title == "" {
		return errors.New("名称不能为空")
	}
	if d.Status == 1 && d.Prompt == "" {
		return errors.New("上架前请填写完整提示词")
	}
	for _, labels := range [][]string{d.InputLabels.Images, d.InputLabels.Videos, d.InputLabels.Audio} {
		if len(labels) > 16 {
			return errors.New("素材名称数量过多")
		}
		for i, label := range labels {
			labels[i] = strings.TrimSpace(label)
			if len([]rune(labels[i])) > 40 {
				return errors.New("每个素材名称最多40字")
			}
		}
	}
	if !SafeMediaURL(d.CoverURL) || !SafeMediaURL(d.PreviewURL) {
		return errors.New("封面和预览需使用有效的 HTTP/HTTPS 媒体地址")
	}
	r := d.Requirements
	if r.Images < 0 || r.Images > model.MaxTemplateImages || r.Videos < 0 || r.Videos > 3 || r.Audio < 0 || r.Audio > 3 {
		return errors.New("素材要求超出范围：图片最多 16 张，视频和音频各最多 3 段，仍需符合所选模型限制")
	}
	if d.MediaType == "image" {
		if d.Mode != "t2i" && d.Mode != "i2i" || r.Videos > 0 || r.Audio > 0 {
			return errors.New("图片模板仅支持文生图或图生图及图片素材")
		}
	} else if d.Mode != "t2v" && d.Mode != "i2v" && d.Mode != "flf" && d.Mode != "ref" {
		return errors.New("视频模板的创作模式无效")
	}
	if (d.Mode == "t2i" || d.Mode == "t2v") && r.Images+r.Videos+r.Audio > 0 {
		return errors.New("有素材要求时请选择图生图、图生视频或多模态参考")
	}
	if d.Mode != "ref" && (r.Videos > 0 || r.Audio > 0) {
		return errors.New("视频、音频参考需要多模态参考模式")
	}
	if d.Mode == "i2v" && r.Images > 1 || d.Mode == "flf" && r.Images > 2 {
		return errors.New("素材数量超过当前创作模式的限制")
	}
	if d.Mode == "i2i" || d.Mode == "i2v" {
		d.Requirements.Images = max(1, r.Images)
	}
	if d.Mode == "flf" {
		d.Requirements.Images = 2
	}
	if err := model.ValidateTemplateImageReferences(d.Mode, d.Requirements, d.Prompt); err != nil {
		return err
	}
	if d.Options.BatchCount < 0 || d.Options.BatchCount > 4 || d.Options.Duration < 0 || d.Options.Duration > 600 || len(d.Options.AspectRatio) > 32 || len(d.Options.Resolution) > 32 || len(d.Options.Quality) > 64 {
		return errors.New("默认参数无效")
	}
	if d.MediaType == "video" && d.Options.BatchCount > 1 {
		return errors.New("视频模板每次只能生成一个视频")
	}
	if d.Status == 1 && d.CoverURL == "" {
		return errors.New("上架前请补充封面图片，视频预览可选")
	}
	return nil
}

func (d SaveDTO) Row() model.StudioTemplate {
	return model.StudioTemplate{Kind: d.Kind, MediaType: d.MediaType, Title: d.Title, Description: d.Description, Category: d.Category, Prompt: d.Prompt, CoverURL: d.CoverURL, PreviewURL: d.PreviewURL, AuthorName: d.AuthorName, InputHint: d.InputHint, InputLabels: d.InputLabels, Mode: d.Mode, ModelKey: d.ModelKey, Requirements: d.Requirements, Options: d.Options, Status: d.Status, SortOrder: d.SortOrder}
}
