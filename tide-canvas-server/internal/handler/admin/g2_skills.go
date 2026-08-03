package admin

// g2_skills.go — 技能管理(技能广场内容运营)。
//
// Routes (JWTAuth + AdminAccess 上游,本组挂 admin.skills 模块权限):
//
//	GET    /api/admin/skills      list w/ pagination + keyword/category/status/outputType filters
//	POST   /api/admin/skills      create
//	PUT    /api/admin/skills/:id  update(全量字段覆盖,与风格管理同口径)
//	DELETE /api/admin/skills/:id  soft delete
//
// LINKAGE:与公开技能广场(handler/skill)共用同一张 skill 表——这里的增删改
// 上下架立即反映到 /chat、创作台与画布节点的技能选择器。

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"tidecanvas/internal/app"
	"tidecanvas/internal/middleware"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/eventlog"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/response"
)

type skillsHandler struct{ db *gorm.DB }

var (
	errInvalidLegacyPresetSave           = errors.New("invalid legacy preset save")
	errLegacyPresetRequiresVersionEditor = errors.New("advanced preset execution must be edited through version management")
)

// RegisterSkills mounts the admin skill routes on the admin group g.
func RegisterSkills(g *gin.RouterGroup, d *app.Deps) {
	h := &skillsHandler{db: d.DB}
	s := g.Group("/skills")
	s.GET("", h.list)
	s.POST("", h.create)
	s.POST("/import", h.importSkills)
	s.PUT("/:id", h.update)
	s.DELETE("/:id", h.remove)
	registerSkillVersionRoutes(s, h)
}

// validDefaultParams 校验技能默认参数:空串或 JSON 对象。前端表单已拦,
// 这里防直连 API 存入脏数据(消费端 parseSkillParams 虽宽松容错,但库里
// 不该躺着解析不了的配置)。
func validDefaultParams(raw string) bool {
	if raw == "" {
		return true
	}
	var v map[string]any
	return json.Unmarshal([]byte(raw), &v) == nil && v != nil
}

func validateLegacyPresetSave(dto AdminSkillSaveDTO, enforcePromptLimit bool) string {
	if !validLegacyOutputType(dto.OutputType) || strings.TrimSpace(dto.PromptTemplate) == "" {
		return "preset skill requires promptTemplate and a valid outputType"
	}
	if enforcePromptLimit && len([]byte(dto.PromptTemplate)) > maxSkillExecutablePromptBytes {
		return "promptTemplate exceeds 1 MiB"
	}
	if !validDefaultParams(strings.TrimSpace(dto.DefaultParams)) {
		return "defaultParams must be a JSON object"
	}
	return ""
}

func validLegacyOutputType(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "image", "video", "audio", "text", "file":
		return true
	}
	return false
}

// AdminSkillSaveDTO is the create/update body(前端 SkillSaveDTO)。
// defaultParams 为 JSON 对象字符串(如 {"aspectRatio":"16:9"}),空串 = 无默认参数。
type AdminSkillSaveDTO struct {
	Title             string  `json:"title" binding:"required,max=64"`
	Description       string  `json:"description" binding:"omitempty,max=255"`
	UsageScenario     *string `json:"usageScenario" binding:"omitempty,max=2000"`
	HowTo             *string `json:"howTo" binding:"omitempty,max=2000"`
	OutputDescription *string `json:"outputDescription" binding:"omitempty,max=2000"`
	CoverURL          string  `json:"coverUrl" binding:"omitempty,max=512"`
	Category          string  `json:"category" binding:"omitempty,max=32"`
	OutputType        string  `json:"outputType" binding:"omitempty,max=16"`
	PromptTemplate    string  `json:"promptTemplate"`
	ModelID           string  `json:"modelId" binding:"omitempty,max=128"`
	DefaultParams     string  `json:"defaultParams" binding:"omitempty,max=2048"`
	AuthorName        string  `json:"authorName" binding:"omitempty,max=64"`
	Status            *int    `json:"status"`
	SortOrder         *int    `json:"sortOrder"`
}

func adminOptionalText(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func applyAdminSkillGuidanceFields(fields map[string]any, dto AdminSkillSaveDTO) {
	if dto.UsageScenario != nil {
		fields["usage_scenario"] = strings.TrimSpace(*dto.UsageScenario)
	}
	if dto.HowTo != nil {
		fields["how_to"] = strings.TrimSpace(*dto.HowTo)
	}
	if dto.OutputDescription != nil {
		fields["output_description"] = strings.TrimSpace(*dto.OutputDescription)
	}
}

func (h *skillsHandler) list(c *gin.Context) {
	keyword := strings.TrimSpace(c.Query("keyword"))
	category := strings.TrimSpace(c.Query("category"))
	outputType := strings.TrimSpace(c.Query("outputType"))
	status := strings.TrimSpace(c.Query("status"))
	pageNum := g2Atoi(c.Query("pageNum"), 1)
	pageSize := g2Atoi(c.Query("pageSize"), 20)
	if pageNum < 1 {
		pageNum = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	tx := h.db.Model(&model.Skill{})
	if keyword != "" {
		like := "%" + keyword + "%"
		tx = tx.Where("title LIKE ? OR description LIKE ?", like, like)
	}
	if category != "" {
		tx = tx.Where("category = ?", category)
	}
	if outputType != "" {
		tx = tx.Where("output_type = ?", outputType)
	}
	if status != "" {
		tx = tx.Where("status = ?", g2Atoi(status, 1))
	}

	var total int64
	if err := tx.Count(&total).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to list skills")
		return
	}
	var rows []model.Skill
	if err := tx.Order("sort_order ASC, id DESC").
		Offset((pageNum - 1) * pageSize).Limit(pageSize).Find(&rows).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to list skills")
		return
	}
	response.Page(c, rows, total, pageNum, pageSize)
}

func (h *skillsHandler) create(c *gin.Context) {
	var dto AdminSkillSaveDTO
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxSkillImportBodyBytes)
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
		return
	}
	if message := validateLegacyPresetSave(dto, true); message != "" {
		response.Fail(c, response.CodeBadRequest, message)
		return
	}
	row := &model.Skill{
		Title:             strings.TrimSpace(dto.Title),
		Description:       strings.TrimSpace(dto.Description),
		UsageScenario:     adminOptionalText(dto.UsageScenario),
		HowTo:             adminOptionalText(dto.HowTo),
		OutputDescription: adminOptionalText(dto.OutputDescription),
		CoverURL:          strings.TrimSpace(dto.CoverURL),
		Category:          strings.TrimSpace(dto.Category),
		OutputType:        dto.OutputType,
		PromptTemplate:    dto.PromptTemplate,
		ModelID:           strings.TrimSpace(dto.ModelID),
		DefaultParams:     strings.TrimSpace(dto.DefaultParams),
		AuthorName:        strings.TrimSpace(dto.AuthorName),
		Status:            1,
	}
	if dto.Status != nil {
		row.Status = *dto.Status
	}
	if dto.SortOrder != nil {
		row.SortOrder = *dto.SortOrder
	}
	if err := h.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(row).Error; err != nil {
			return err
		}
		return publishLegacyPresetVersionTx(tx, row, middleware.CurrentUserID(c))
	}); err != nil {
		response.Fail(c, response.CodeServerError, "failed to create initial skill version")
		return
	}

	eventlog.Biz(&model.BizLog{
		Action:     "skill_create",
		Summary:    "管理员创建技能：" + row.Title,
		RefID:      row.ID,
		RefType:    "skill",
		OperatorID: middleware.CurrentUserID(c),
	})
	response.OK(c, row)
}

func (h *skillsHandler) update(c *gin.Context) {
	id, err := idgen.Parse(c.Param("id"))
	if err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid skill id")
		return
	}
	var dto AdminSkillSaveDTO
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxSkillImportBodyBytes)
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
		return
	}

	var row model.Skill
	validationMessage := ""
	err = h.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", id).First(&row).Error; err != nil {
			return err
		}
		isPreset := row.Kind == "" || row.Kind == model.SkillKindPreset
		promptChanged := isPreset && row.PromptTemplate != dto.PromptTemplate
		if isPreset {
			if validationMessage = validateLegacyPresetSave(dto, promptChanged); validationMessage != "" {
				return errInvalidLegacyPresetSave
			}
		}

		fields := map[string]any{
			"title":           strings.TrimSpace(dto.Title),
			"description":     strings.TrimSpace(dto.Description),
			"cover_url":       strings.TrimSpace(dto.CoverURL),
			"category":        strings.TrimSpace(dto.Category),
			"output_type":     dto.OutputType,
			"prompt_template": dto.PromptTemplate,
			"model_id":        strings.TrimSpace(dto.ModelID),
			"default_params":  strings.TrimSpace(dto.DefaultParams),
			"author_name":     strings.TrimSpace(dto.AuthorName),
		}
		applyAdminSkillGuidanceFields(fields, dto)
		if !isPreset {
			delete(fields, "output_type")
			delete(fields, "prompt_template")
			delete(fields, "model_id")
			delete(fields, "default_params")
		}
		if dto.Status != nil {
			fields["status"] = *dto.Status
		}
		if dto.SortOrder != nil {
			fields["sort_order"] = *dto.SortOrder
		}
		executionChanged := isPreset && (row.OutputType != dto.OutputType ||
			row.PromptTemplate != dto.PromptTemplate ||
			row.ModelID != strings.TrimSpace(dto.ModelID) ||
			row.DefaultParams != strings.TrimSpace(dto.DefaultParams))
		if executionChanged {
			editable, err := legacyPresetExecutionEditableTx(tx, &row)
			if err != nil {
				return err
			}
			if !editable {
				return errLegacyPresetRequiresVersionEditor
			}
		}
		if err := tx.Model(&model.Skill{}).Where("id = ?", id).Updates(fields).Error; err != nil {
			return err
		}
		if err := tx.Where("id = ?", id).First(&row).Error; err != nil {
			return err
		}
		if executionChanged {
			return publishLegacyPresetVersionTx(tx, &row, middleware.CurrentUserID(c))
		}
		return nil
	})
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			response.Fail(c, response.CodeNotFound, "skill not found")
			return
		}
		if errors.Is(err, errLegacyPresetRequiresVersionEditor) {
			response.Fail(c, response.CodeBadRequest, "advanced preset execution must be edited through version management")
			return
		}
		if errors.Is(err, errInvalidLegacyPresetSave) {
			response.Fail(c, response.CodeBadRequest, validationMessage)
			return
		}
		response.Fail(c, response.CodeServerError, "failed to update skill")
		return
	}

	eventlog.Biz(&model.BizLog{
		Action:     "skill_update",
		Summary:    "管理员修改技能：" + row.Title,
		RefID:      id,
		RefType:    "skill",
		OperatorID: middleware.CurrentUserID(c),
	})
	response.OK(c, row)
}

func (h *skillsHandler) remove(c *gin.Context) {
	id, err := idgen.Parse(c.Param("id"))
	if err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid skill id")
		return
	}
	res := h.db.Where("id = ?", id).Delete(&model.Skill{})
	if res.Error != nil {
		response.Fail(c, response.CodeServerError, "failed to delete skill")
		return
	}
	if res.RowsAffected == 0 {
		response.Fail(c, response.CodeNotFound, "skill not found")
		return
	}

	eventlog.Biz(&model.BizLog{
		Action:     "skill_delete",
		Summary:    "管理员删除技能",
		RefID:      id,
		RefType:    "skill",
		OperatorID: middleware.CurrentUserID(c),
	})
	response.OK[any](c, nil)
}

// g2Atoi is a tiny digits-only atoi with default (mirrors handler/skill).
func g2Atoi(s string, def int) int {
	if s == "" {
		return def
	}
	n := 0
	for _, r := range s {
		if r < '0' || r > '9' {
			return def
		}
		n = n*10 + int(r-'0')
	}
	return n
}
