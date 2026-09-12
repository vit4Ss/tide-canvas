package admin

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"path"
	"reflect"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	aihandler "tidecanvas/internal/handler/ai"
	"tidecanvas/internal/middleware"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/response"
)

const (
	maxSkillImportFileBytes  = 2 << 20
	maxSkillImportTotalBytes = 8 << 20
	// JSON escaping can expand valid 8 MiB Markdown significantly (for example
	// newlines and control characters). The decoded file limits below remain the
	// authoritative payload guard; this outer cap only leaves room for encoding.
	maxSkillImportBodyBytes       = 64 << 20
	maxSkillExecutablePromptBytes = 1 << 20
	maxSkillImportFiles           = 128
	maxSkillImportBindings        = 64
	maxSkillDefaultParamsBytes    = 60 << 10
	maxSkillBindingDefaultsBytes  = 60 << 10
	maxSkillModelIDRunes          = 128
	maxSkillMimeTypeRunes         = 128
)

type AdminSkillFileDTO struct {
	Path     string `json:"path" binding:"required"`
	Content  string `json:"content" binding:"required"`
	MimeType string `json:"mimeType"`
}

// AdminSkillVersionCreateDTO is also the JSON import contract. Upload clients
// send a flat path/content array; paths may represent a folder and a root
// SKILL.md is selected as primary. A lone .md/.txt file is also accepted.
type AdminSkillVersionCreateDTO struct {
	Kind              string                 `json:"kind"`
	EntryPoints       []string               `json:"entryPoints"`
	PrimaryOutputType string                 `json:"primaryOutputType"`
	OutputTypes       []string               `json:"outputTypes"`
	InputSchema       json.RawMessage        `json:"inputSchema"`
	Manifest          json.RawMessage        `json:"manifest"`
	PromptTemplate    string                 `json:"promptTemplate"`
	ModelID           string                 `json:"modelId"`
	DefaultParams     json.RawMessage        `json:"defaultParams"`
	PrimaryFilePath   string                 `json:"primaryFilePath"`
	Files             []AdminSkillFileDTO    `json:"files"`
	Publish           bool                   `json:"publish"`
	Bindings          []AdminSkillBindingDTO `json:"bindings"`
}

type AdminSkillBindingDTO struct {
	Surface    string          `json:"surface"`
	TargetType string          `json:"targetType"`
	Enabled    *bool           `json:"enabled"`
	SortOrder  int             `json:"sortOrder"`
	Defaults   json.RawMessage `json:"defaults"`
}

// skillBindingSnapshot is the immutable, execution-relevant placement stored
// on each SkillVersion. Database ids/timestamps deliberately do not participate
// in the snapshot or content hash.
type skillBindingSnapshot struct {
	Surface    string          `json:"surface"`
	TargetType string          `json:"targetType"`
	Enabled    bool            `json:"enabled"`
	SortOrder  int             `json:"sortOrder"`
	Defaults   json.RawMessage `json:"defaults"`
}

type AdminSkillPackageDTO struct {
	Title             string `json:"title"`
	Description       string `json:"description"`
	UsageScenario     string `json:"usageScenario"`
	HowTo             string `json:"howTo"`
	OutputDescription string `json:"outputDescription"`
	CoverURL          string `json:"coverUrl"`
	Category          string `json:"category"`
	AuthorName        string `json:"authorName"`
	Status            *int   `json:"status"`
	SortOrder         int    `json:"sortOrder"`
	AdminSkillVersionCreateDTO
}

type AdminSkillImportDTO struct {
	Skills []AdminSkillPackageDTO `json:"skills"`
}

type AdminSkillImportValidationItemVO struct {
	Index  int      `json:"index"`
	Title  string   `json:"title"`
	Valid  bool     `json:"valid"`
	Errors []string `json:"errors"`
}

type AdminSkillImportValidationVO struct {
	Valid bool                               `json:"valid"`
	Items []AdminSkillImportValidationItemVO `json:"items"`
}

type preparedSkillImport struct {
	Skill   model.Skill
	Version *model.SkillVersion
	Files   []model.SkillFile
}

func validateAdminSkillPackageMetadata(pkg AdminSkillPackageDTO) error {
	title := strings.TrimSpace(pkg.Title)
	if title == "" || len([]rune(title)) > 64 {
		return errors.New("title is required and must not exceed 64 characters")
	}
	limits := []struct {
		name  string
		value string
		max   int
	}{
		{name: "description", value: pkg.Description, max: 255},
		{name: "usageScenario", value: pkg.UsageScenario, max: 2000},
		{name: "howTo", value: pkg.HowTo, max: 2000},
		{name: "outputDescription", value: pkg.OutputDescription, max: 2000},
		{name: "coverUrl", value: pkg.CoverURL, max: 512},
		{name: "category", value: pkg.Category, max: 32},
		{name: "authorName", value: pkg.AuthorName, max: 64},
	}
	for _, field := range limits {
		if len([]rune(field.value)) > field.max {
			return fmt.Errorf("%s must not exceed %d characters", field.name, field.max)
		}
	}
	if pkg.Status != nil && *pkg.Status != 0 && *pkg.Status != 1 {
		return errors.New("status must be 0 or 1")
	}
	return nil
}

type AdminSkillBindingsSaveDTO struct {
	Bindings []AdminSkillBindingDTO `json:"bindings" binding:"required"`
}

type AdminSkillVersionVO struct {
	model.SkillVersion
	Files []model.SkillFile `json:"files,omitempty"`
}

func registerSkillVersionRoutes(s *gin.RouterGroup, h *skillsHandler) {
	s.GET("/:id/versions", h.listVersions)
	s.GET("/:id/versions/:versionId", h.getVersion)
	s.POST("/:id/versions", h.createVersion)
	s.POST("/:id/versions/import", h.createVersion)
	s.POST("/:id/versions/:versionId/publish", h.publishVersion)
	s.GET("/:id/bindings", h.listBindings)
	s.PUT("/:id/bindings", h.replaceBindings)
}

func (h *skillsHandler) listVersions(c *gin.Context) {
	skillID, ok := parseAdminID(c, "id")
	if !ok {
		return
	}
	var rows []model.SkillVersion
	if err := h.db.Where("skill_id = ?", skillID).Order("version_no DESC").Find(&rows).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to list skill versions")
		return
	}
	response.OK(c, rows)
}

func (h *skillsHandler) getVersion(c *gin.Context) {
	skillID, ok := parseAdminID(c, "id")
	if !ok {
		return
	}
	versionID, ok := parseAdminID(c, "versionId")
	if !ok {
		return
	}
	var version model.SkillVersion
	if err := h.db.Where("id = ? AND skill_id = ?", versionID, skillID).First(&version).Error; err != nil {
		response.Fail(c, response.CodeNotFound, "skill version not found")
		return
	}
	var files []model.SkillFile
	if err := h.db.Where("skill_version_id = ?", version.ID).Order("path ASC").Find(&files).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to load skill files")
		return
	}
	response.OK(c, AdminSkillVersionVO{SkillVersion: version, Files: files})
}

func (h *skillsHandler) createVersion(c *gin.Context) {
	skillID, ok := parseAdminID(c, "id")
	if !ok {
		return
	}
	var skill model.Skill
	if err := h.db.First(&skill, "id = ?", skillID).Error; err != nil {
		response.Fail(c, response.CodeNotFound, "skill not found")
		return
	}
	var dto AdminSkillVersionCreateDTO
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxSkillImportBodyBytes)
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid version: "+err.Error())
		return
	}
	version, files, err := buildSkillVersion(h.db, &skill, dto, middleware.CurrentUserID(c))
	if err != nil {
		response.Fail(c, response.CodeBadRequest, err.Error())
		return
	}
	if dto.Publish {
		if err := validateConfiguredSkillModels(h.db, version); err != nil {
			response.Fail(c, response.CodeBadRequest, describeSkillImportError(err))
			return
		}
	}
	if err := h.db.Transaction(func(tx *gorm.DB) error {
		return persistSkillVersionTx(tx, &skill, version, files, dto.Publish)
	}); err != nil {
		response.Fail(c, response.CodeServerError, "failed to create skill version")
		return
	}
	response.OK(c, AdminSkillVersionVO{SkillVersion: *version, Files: files})
}

// importSkills creates the catalog row and immutable v1 in one transaction.
// It is the JSON counterpart of uploading one or more local skill folders.
func (h *skillsHandler) importSkills(c *gin.Context) {
	var dto AdminSkillImportDTO
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxSkillImportBodyBytes)
	if err := decodeAdminSkillImportRequest(c.Request.Body, &dto); err != nil {
		response.Fail(c, response.CodeBadRequest, describeSkillImportRequestError(err, "导入"))
		return
	}
	if len(dto.Skills) == 0 || len(dto.Skills) > 50 {
		response.Fail(c, response.CodeBadRequest, "一次必须导入 1 至 50 个 Skill")
		return
	}
	actor := middleware.CurrentUserID(c)
	validation, prepared := validateAdminSkillImports(h.db, dto.Skills, actor)
	if !validation.Valid {
		response.Fail(c, response.CodeBadRequest, formatSkillImportValidationFailure(validation))
		return
	}
	created := make([]AdminSkillVersionVO, 0, len(dto.Skills))
	err := h.db.Transaction(func(tx *gorm.DB) error {
		for index := range prepared {
			plan := prepared[index]
			skill := plan.Skill
			if err := tx.Create(&skill).Error; err != nil {
				return err
			}
			version := *plan.Version
			version.SkillID = skill.ID
			files := append([]model.SkillFile(nil), plan.Files...)
			// Imported packages are immediately runnable; subsequent edits create drafts.
			if err := persistSkillVersionTx(tx, &skill, &version, files, true); err != nil {
				return err
			}
			created = append(created, AdminSkillVersionVO{SkillVersion: version, Files: files})
		}
		return nil
	})
	if err != nil {
		response.Fail(c, response.CodeServerError, "Skill 已通过校验，但写入失败，请稍后重试")
		return
	}
	response.OK(c, created)
}

// validateSkillImport runs the exact same non-mutating checks used by the final
// import. Returning every package result lets the admin fix all malformed
// packages in one pass instead of discovering one error after another.
func (h *skillsHandler) validateSkillImport(c *gin.Context) {
	var dto AdminSkillImportDTO
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxSkillImportBodyBytes)
	if err := decodeAdminSkillImportRequest(c.Request.Body, &dto); err != nil {
		response.Fail(c, response.CodeBadRequest, describeSkillImportRequestError(err, "校验"))
		return
	}
	if len(dto.Skills) == 0 || len(dto.Skills) > 50 {
		response.Fail(c, response.CodeBadRequest, "一次必须校验 1 至 50 个 Skill")
		return
	}
	validation, _ := validateAdminSkillImports(h.db, dto.Skills, middleware.CurrentUserID(c))
	response.OK(c, validation)
}

func describeSkillImportRequestError(err error, action string) string {
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		return fmt.Sprintf("Skill %s数据超过 64 MB 请求上限", action)
	}
	var typeError *json.UnmarshalTypeError
	if errors.As(err, &typeError) {
		field := strings.TrimSpace(typeError.Field)
		if field == "" {
			field = "请求字段"
		}
		return fmt.Sprintf("Skill %s字段 %s 的数据类型不正确", action, field)
	}
	if strings.HasPrefix(err.Error(), "json: unknown field ") {
		return fmt.Sprintf("Skill %s包含未知字段 %s，请检查字段拼写", action, strings.TrimPrefix(err.Error(), "json: unknown field "))
	}
	return fmt.Sprintf("Skill %s请求格式无效，请检查字段类型和文件数量", action)
}

func decodeAdminSkillImportRequest(reader io.Reader, dto *AdminSkillImportDTO) error {
	decoder := json.NewDecoder(reader)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dto); err != nil {
		return err
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("request contains multiple JSON values")
		}
		return err
	}
	return nil
}

func validateAdminSkillImports(db *gorm.DB, packages []AdminSkillPackageDTO, actor idgen.ID) (AdminSkillImportValidationVO, []preparedSkillImport) {
	result := AdminSkillImportValidationVO{Valid: true, Items: make([]AdminSkillImportValidationItemVO, 0, len(packages))}
	prepared := make([]preparedSkillImport, 0, len(packages))
	for index := range packages {
		pkg := packages[index]
		title := strings.TrimSpace(pkg.Title)
		if title == "" {
			title = fmt.Sprintf("第 %d 个 Skill", index+1)
		}
		item := AdminSkillImportValidationItemVO{Index: index, Title: title, Valid: false, Errors: []string{}}
		if err := validateAdminSkillPackageMetadata(pkg); err != nil {
			item.Errors = append(item.Errors, describeSkillImportError(err))
		} else {
			skill := skillFromImportPackage(pkg)
			version, files, err := buildSkillVersion(db, &skill, pkg.AdminSkillVersionCreateDTO, actor)
			if err == nil {
				err = validateConfiguredSkillModels(db, version)
			}
			if err != nil {
				item.Errors = append(item.Errors, describeSkillImportError(err))
			} else {
				item.Valid = true
				prepared = append(prepared, preparedSkillImport{Skill: skill, Version: version, Files: files})
			}
		}
		if !item.Valid {
			result.Valid = false
		}
		result.Items = append(result.Items, item)
	}
	if !result.Valid {
		// A failed batch is never partially importable. Discard prepared entries so
		// callers cannot accidentally persist the valid subset.
		prepared = nil
	}
	return result, prepared
}

func skillFromImportPackage(pkg AdminSkillPackageDTO) model.Skill {
	primary := strings.ToLower(strings.TrimSpace(pkg.PrimaryOutputType))
	if primary == "" && len(pkg.OutputTypes) > 0 {
		primary = strings.ToLower(strings.TrimSpace(pkg.OutputTypes[0]))
	}
	if primary == "" {
		primary = "text"
	}
	status := 1
	if pkg.Status != nil {
		status = *pkg.Status
	}
	kind := strings.ToLower(strings.TrimSpace(pkg.Kind))
	if kind == "" {
		kind = model.SkillKindPreset
	}
	return model.Skill{
		Title: strings.TrimSpace(pkg.Title), Description: strings.TrimSpace(pkg.Description),
		UsageScenario: strings.TrimSpace(pkg.UsageScenario), HowTo: strings.TrimSpace(pkg.HowTo),
		OutputDescription: strings.TrimSpace(pkg.OutputDescription),
		CoverURL:          strings.TrimSpace(pkg.CoverURL), Category: strings.TrimSpace(pkg.Category),
		OutputType: primary, PromptTemplate: pkg.PromptTemplate, ModelID: strings.TrimSpace(pkg.ModelID),
		DefaultParams: string(pkg.DefaultParams), AuthorName: strings.TrimSpace(pkg.AuthorName),
		Status: status, SortOrder: pkg.SortOrder, Kind: kind,
	}
}

func validateConfiguredSkillModels(db *gorm.DB, version *model.SkillVersion) error {
	if db == nil || version == nil {
		return nil
	}
	checked := map[string]bool{}
	check := func(label, candidate, typeName, handler string, analysis bool) error {
		candidate = strings.TrimSpace(candidate)
		typeName = skillImportModelType(typeName)
		checkKey := strings.Join([]string{typeName, candidate, handler, fmt.Sprint(analysis)}, "\x00")
		if checked[checkKey] {
			return nil
		}
		var rows []model.MarketModel
		query := db.Model(&model.MarketModel{}).
			Select("id", "model_key", "config", "type", "status", "sort_order").
			Where("status = 1 AND type = ?", typeName)
		if candidate == "" {
			query = query.Where("model_key <> ''")
		} else if id, err := idgen.Parse(candidate); err == nil {
			query = query.Where("model_key = ? OR id = ?", candidate, id)
		} else {
			query = query.Where("model_key = ?", candidate)
		}
		if err := query.Order("sort_order ASC, id ASC").Find(&rows).Error; err != nil {
			return errors.New("校验模型配置时数据库不可用")
		}
		if len(rows) == 0 {
			if candidate == "" {
				return fmt.Errorf("%s没有可用的 %s 类型上架模型", label, typeName)
			}
			return fmt.Errorf("%s配置的模型 %q 不存在、未上架或不是 %s 类型", label, candidate, typeName)
		}
		if analysis {
			for i := range rows {
				if skillImportAnalysisModelSupports(handler, rows[i]) {
					checked[checkKey] = true
					return nil
				}
			}
			if candidate == "" {
				return fmt.Errorf("%s没有支持媒体文件输入的上架文本模型", label)
			}
			return fmt.Errorf("%s配置的模型 %q 不支持该媒体分析步骤所需的文件输入", label, candidate)
		}
		if handler != "" {
			for i := range rows {
				if aihandler.MarketModelSupportsHandler(&rows[i], handler) {
					checked[checkKey] = true
					return nil
				}
			}
			if candidate == "" {
				return fmt.Errorf("%s没有支持处理器 %s 的上架模型", label, handler)
			}
			return fmt.Errorf("%s配置的模型 %q 不支持处理器 %s", label, candidate, handler)
		}
		checked[checkKey] = true
		return nil
	}
	var manifest struct {
		Steps []struct {
			Key        string `json:"key"`
			Type       string `json:"type"`
			Handler    string `json:"handler"`
			OutputType string `json:"outputType"`
			ModelID    string `json:"modelId"`
		} `json:"steps"`
	}
	if json.Unmarshal([]byte(version.ManifestJSON), &manifest) != nil {
		return errors.New("manifest 不是有效的 JSON 对象")
	}
	primaryType := strings.ToLower(strings.TrimSpace(version.PrimaryOutputType))
	versionModelType := skillImportModelType(primaryType)
	if len(manifest.Steps) == 0 {
		if version.Kind == model.SkillKindAgent && primaryType != "text" && primaryType != "file" {
			if err := check("技能的提示词规划阶段", "", "text", "skill_text_completion", false); err != nil {
				return err
			}
		}
		handler := ""
		if primaryType == "text" || primaryType == "file" {
			handler = "skill_text_completion"
		}
		return check("技能", version.ModelID, primaryType, handler, false)
	}
	for index, step := range manifest.Steps {
		typeName := strings.ToLower(strings.TrimSpace(step.OutputType))
		handler := strings.TrimSpace(step.Handler)
		analysis := false
		switch strings.ToLower(strings.TrimSpace(step.Type)) {
		case "text":
			typeName = "text"
			if handler == "" {
				handler = "skill_text_completion"
			}
		case "generate":
		case "tool":
			if !strings.HasPrefix(strings.ToLower(handler), "analyze_") {
				continue
			}
			typeName = "text"
			analysis = true
		default:
			continue
		}
		label := fmt.Sprintf("第 %d 步", index+1)
		if strings.TrimSpace(step.Key) != "" {
			label += fmt.Sprintf("（%s）", strings.TrimSpace(step.Key))
		}
		configured := strings.TrimSpace(step.ModelID)
		if configured == "" && typeName == versionModelType {
			configured = version.ModelID
		}
		if err := check(label, configured, typeName, handler, analysis); err != nil {
			return err
		}
	}
	return nil
}

func skillImportModelType(outputType string) string {
	typeName := strings.ToLower(strings.TrimSpace(outputType))
	if typeName == "file" {
		return "text"
	}
	return typeName
}

func skillImportAnalysisModelSupports(handler string, row model.MarketModel) bool {
	if handler == "analyze_webpage" || handler == "analyze_account" {
		return true
	}
	var config struct {
		FileUpload    *bool    `json:"fileUpload"`
		UploadFormats []string `json:"uploadFormats"`
		ParamsSchema  struct {
			FileUpload bool `json:"file_upload"`
		} `json:"paramsSchema"`
	}
	if json.Unmarshal([]byte(strings.TrimSpace(row.Config)), &config) != nil {
		return false
	}
	fileUpload := config.ParamsSchema.FileUpload
	if config.FileUpload != nil {
		fileUpload = *config.FileUpload
	}
	if !fileUpload {
		return false
	}
	if (handler != "analyze_video" && handler != "analyze_image") || len(config.UploadFormats) == 0 {
		return true
	}
	// Video analysis sends extracted keyframes to the text model, so image input
	// support is the relevant capability (matching skillrun.analysisModelSupports).
	for _, format := range config.UploadFormats {
		switch strings.TrimPrefix(strings.ToLower(strings.TrimSpace(format)), ".") {
		case "jpg", "jpeg", "png", "webp", "gif":
			return true
		}
	}
	return false
}

func describeSkillImportError(err error) string {
	if err == nil {
		return ""
	}
	message := err.Error()
	exact := map[string]string{
		"title is required and must not exceed 64 characters":                          "名称不能为空，且不能超过 64 个字符",
		"status must be 0 or 1":                                                        "上架状态只能是 0（下架）或 1（上架）",
		"kind must be preset, agent or tool":                                           "执行形态只能是 preset、agent 或 tool",
		"agent entryPoints must contain canvas only":                                   "智能技能只能绑定画布入口",
		"tool primaryOutputType must be text or file":                                  "技能工具的主输出只能是文本或文件",
		"tool skills must contain at least one registered tool step":                   "技能工具必须包含至少一个系统已注册的工具步骤",
		"multi-step skills must declare a final output or an approval-finalized draft": "多步骤技能必须声明最终输出，或由确认步骤提升上一份草稿",
		"final outputs must include primaryOutputType":                                 "最终输出中必须包含主输出类型",
		"promptTemplate or files is required":                                          "提示词模板和 Skill 文件不能同时为空",
		"primary skill file is missing":                                                "找不到主 Skill 文件",
		"primary skill file cannot be blank":                                           "主 Skill 文件内容不能为空",
		"folder import requires a SKILL.md primary file":                               "多文件 Skill 包必须包含 SKILL.md 主文件",
		"primaryFilePath is not present in files":                                      "primaryFilePath 指向的文件不在导入包中",
		"skill file package exceeds size limit":                                        "Skill 文件为空，或超过单文件 2 MB/合计 8 MB 限制",
	}
	if translated, ok := exact[message]; ok {
		return translated
	}
	if strings.Contains(message, "expanded prompt exceeds 1 MiB") {
		return "Skill 及其参考文件展开后超过 1 MiB 执行上限，请精简参考资料"
	}
	if strings.HasPrefix(message, "duplicate skill file path") {
		return "Skill 包含同名文件（路径大小写也不能重复）：" + message
	}
	if strings.HasPrefix(message, "unsupported skill file") {
		return "Skill 包含不支持的文件类型，仅允许 .md 和 .txt：" + message
	}
	if strings.Contains(message, "entryPoints") {
		return "使用入口配置不兼容：" + message
	}
	if strings.Contains(message, "primaryOutputType") || strings.Contains(message, "outputTypes") {
		return "输出类型配置不兼容：" + message
	}
	if strings.Contains(message, "must not exceed") {
		return "字段长度超过允许范围：" + message
	}
	if strings.Contains(message, "manifest.steps[") {
		return "执行步骤配置不兼容：" + message
	}
	if strings.Contains(message, "inputSchema") {
		return "输入表单配置不兼容：" + message
	}
	if strings.Contains(message, "binding") {
		return "入口绑定配置不兼容：" + message
	}
	if strings.Contains(message, "skill file") || strings.Contains(message, "Skill file") {
		return "Skill 文件配置不兼容：" + message
	}
	return "技能配置不兼容：" + message
}

func formatSkillImportValidationFailure(validation AdminSkillImportValidationVO) string {
	parts := make([]string, 0, 3)
	for _, item := range validation.Items {
		if item.Valid || len(item.Errors) == 0 {
			continue
		}
		parts = append(parts, fmt.Sprintf("「%s」：%s", item.Title, item.Errors[0]))
		if len(parts) == 3 {
			break
		}
	}
	if len(parts) == 0 {
		return "Skill 导入校验未通过"
	}
	return "Skill 导入校验未通过：" + strings.Join(parts, "；")
}

func (h *skillsHandler) publishVersion(c *gin.Context) {
	skillID, ok := parseAdminID(c, "id")
	if !ok {
		return
	}
	versionID, ok := parseAdminID(c, "versionId")
	if !ok {
		return
	}
	var skill model.Skill
	var version model.SkillVersion
	if h.db.First(&skill, "id = ?", skillID).Error != nil ||
		h.db.First(&version, "id = ? AND skill_id = ?", versionID, skillID).Error != nil {
		response.Fail(c, response.CodeNotFound, "skill version not found")
		return
	}
	var files []model.SkillFile
	if err := h.db.Where("skill_version_id = ?", version.ID).Order("path ASC").Find(&files).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to load skill files")
		return
	}
	if err := validateSkillExecutablePromptSize(version.PromptTemplate, version.PrimaryFilePath, files); err != nil {
		response.Fail(c, response.CodeBadRequest, err.Error())
		return
	}
	if err := validateSkillManifest(json.RawMessage(version.ManifestJSON), version.Kind, version.PrimaryOutputType, model.JSONStrings(version.OutputTypes, nil)); err != nil {
		response.Fail(c, response.CodeBadRequest, err.Error())
		return
	}
	if err := validateSkillKindContract(&version); err != nil {
		response.Fail(c, response.CodeBadRequest, err.Error())
		return
	}
	if err := validateSkillFileReferences(version.ManifestJSON, version.PromptTemplate, files, version.PrimaryFilePath); err != nil {
		response.Fail(c, response.CodeBadRequest, err.Error())
		return
	}
	if err := validateConfiguredSkillModels(h.db, &version); err != nil {
		response.Fail(c, response.CodeBadRequest, describeSkillImportError(err))
		return
	}
	if err := publishSkillVersion(h.db, &skill, &version); err != nil {
		response.Fail(c, response.CodeServerError, "failed to publish skill version")
		return
	}
	response.OK(c, version)
}

func (h *skillsHandler) listBindings(c *gin.Context) {
	skillID, ok := parseAdminID(c, "id")
	if !ok {
		return
	}
	var rows []model.SkillSurfaceBinding
	if err := h.db.Where("skill_id = ?", skillID).Order("surface ASC, sort_order ASC, target_type ASC").Find(&rows).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to list skill bindings")
		return
	}
	response.OK(c, rows)
}

func (h *skillsHandler) replaceBindings(c *gin.Context) {
	skillID, ok := parseAdminID(c, "id")
	if !ok {
		return
	}
	var dto AdminSkillBindingsSaveDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid bindings: "+err.Error())
		return
	}
	var skill model.Skill
	if err := h.db.First(&skill, "id = ?", skillID).Error; err != nil {
		response.Fail(c, response.CodeNotFound, "skill not found")
		return
	}
	if skill.CurrentVersionID == 0 {
		response.Fail(c, response.CodeBadRequest, "skill has no published version")
		return
	}
	var current model.SkillVersion
	if err := h.db.Where("id = ? AND skill_id = ?", skill.CurrentVersionID, skill.ID).First(&current).Error; err != nil {
		response.Fail(c, response.CodeBadRequest, "published skill version is unavailable")
		return
	}
	var files []model.SkillFile
	if err := h.db.Where("skill_version_id = ?", current.ID).Order("path ASC").Find(&files).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to load skill files")
		return
	}
	snapshots, err := normalizeSkillBindingSnapshots(dto.Bindings)
	if err != nil {
		response.Fail(c, response.CodeBadRequest, err.Error())
		return
	}
	if err := validateSkillKindBindings(current.Kind, snapshots); err != nil {
		response.Fail(c, response.CodeBadRequest, err.Error())
		return
	}
	version := &model.SkillVersion{SkillID: skill.ID, Kind: current.Kind, Status: model.SkillVersionDraft,
		EntryPoints: current.EntryPoints, PrimaryOutputType: current.PrimaryOutputType, OutputTypes: current.OutputTypes,
		InputSchema: current.InputSchema, ManifestJSON: current.ManifestJSON, PromptTemplate: current.PromptTemplate,
		ModelID: current.ModelID, DefaultParams: current.DefaultParams, BindingsJSON: model.JSONString(snapshots),
		PrimaryFilePath: current.PrimaryFilePath, CreatedBy: middleware.CurrentUserID(c)}
	clonedFiles := make([]model.SkillFile, len(files))
	for i := range files {
		clonedFiles[i] = model.SkillFile{Path: files[i].Path, Content: files[i].Content, StorageKey: files[i].StorageKey,
			MimeType: files[i].MimeType, Size: files[i].Size, SHA256: files[i].SHA256}
	}
	if err := h.db.Transaction(func(tx *gorm.DB) error {
		return persistSkillVersionTx(tx, &skill, version, clonedFiles, true)
	}); err != nil {
		response.Fail(c, response.CodeBadRequest, err.Error())
		return
	}
	var rows []model.SkillSurfaceBinding
	_ = h.db.Where("skill_id = ?", skillID).Order("surface ASC, sort_order ASC, target_type ASC").Find(&rows).Error
	response.OK(c, rows)
}

func parseAdminID(c *gin.Context, key string) (idgen.ID, bool) {
	id, err := idgen.Parse(c.Param(key))
	if err != nil || id == 0 {
		response.Fail(c, response.CodeBadRequest, "invalid "+key)
		return 0, false
	}
	return id, true
}

func buildSkillVersion(_ *gorm.DB, skill *model.Skill, dto AdminSkillVersionCreateDTO, actor idgen.ID) (*model.SkillVersion, []model.SkillFile, error) {
	kind := strings.ToLower(strings.TrimSpace(dto.Kind))
	if kind == "" {
		kind = model.SkillKindPreset
	}
	if !model.ValidSkillKind(kind) {
		return nil, nil, errors.New("kind must be preset, agent or tool")
	}
	entryPoints, err := strictEnumList("entryPoints", dto.EntryPoints, map[string]bool{"chat": true, "studio": true, "canvas": true, "api": true})
	if err != nil {
		return nil, nil, err
	}
	if len(entryPoints) == 0 {
		if kind == model.SkillKindAgent {
			entryPoints = []string{"canvas"}
		} else if kind == model.SkillKindTool {
			entryPoints = []string{"studio"}
		} else {
			entryPoints = []string{"chat", "studio", "canvas"}
		}
	}
	if kind == model.SkillKindAgent && (len(entryPoints) != 1 || entryPoints[0] != "canvas") {
		return nil, nil, errors.New("agent entryPoints must contain canvas only")
	}
	if kind == model.SkillKindPreset {
		for _, entryPoint := range entryPoints {
			if entryPoint != "chat" && entryPoint != "studio" && entryPoint != "canvas" {
				return nil, nil, errors.New("preset entryPoints may only contain chat, studio or canvas")
			}
		}
	}
	if kind == model.SkillKindTool {
		for _, entryPoint := range entryPoints {
			if entryPoint != "studio" && entryPoint != "api" {
				return nil, nil, errors.New("tool entryPoints may only contain studio or api")
			}
		}
	}
	validOutputs := map[string]bool{"text": true, "image": true, "video": true, "audio": true, "file": true}
	outputTypes, err := strictEnumList("outputTypes", dto.OutputTypes, validOutputs)
	if err != nil {
		return nil, nil, err
	}
	primaryOutput := strings.ToLower(strings.TrimSpace(dto.PrimaryOutputType))
	if primaryOutput == "" {
		primaryOutput = skill.OutputType
	}
	if primaryOutput == "" {
		primaryOutput = "text"
	}
	if !validOutputs[primaryOutput] {
		return nil, nil, errors.New("primaryOutputType must be text, image, video, audio or file")
	}
	if len(outputTypes) == 0 {
		outputTypes = []string{primaryOutput}
	}
	if !containsAdminString(outputTypes, primaryOutput) {
		outputTypes = append([]string{primaryOutput}, outputTypes...)
	}
	if kind == model.SkillKindPreset && (len(outputTypes) != 1 || outputTypes[0] != primaryOutput) {
		return nil, nil, errors.New("preset must declare exactly one output type matching primaryOutputType")
	}

	files, primary, err := normalizeSkillFiles(dto.Files, dto.PrimaryFilePath)
	if err != nil {
		return nil, nil, err
	}
	prompt := dto.PromptTemplate
	if prompt == "" && len(files) > 0 {
		prompt = defaultSkillPackagePrompt(primary, files)
	}
	if err := validateSkillExecutablePromptSize(prompt, primary, files); err != nil {
		return nil, nil, err
	}
	if len(files) == 0 {
		if strings.TrimSpace(prompt) == "" {
			return nil, nil, errors.New("promptTemplate or files is required")
		}
		primary = "SKILL.md"
		files = []model.SkillFile{{Path: primary, Content: prompt, MimeType: "text/markdown; charset=utf-8", Size: int64(len([]byte(prompt))), SHA256: hashAdminText(prompt)}}
	}
	manifest := dto.Manifest
	if len(manifest) == 0 {
		manifest, _ = json.Marshal(map[string]any{"kind": kind, "primaryOutputType": primaryOutput, "outputTypes": outputTypes})
	} else if err := validateSkillManifest(manifest, kind, primaryOutput, outputTypes); err != nil {
		return nil, nil, err
	}
	if err := validateSkillFileReferences(string(manifest), prompt, files, primary); err != nil {
		return nil, nil, err
	}
	inputSchema := dto.InputSchema
	if len(inputSchema) == 0 {
		inputSchema = json.RawMessage(`{"type":"object"}`)
	} else if err := requireJSONObject("inputSchema", inputSchema); err != nil {
		return nil, nil, err
	}
	if err := validateInputSchemaDefinition(inputSchema); err != nil {
		return nil, nil, err
	}
	defaults := dto.DefaultParams
	if len(defaults) == 0 {
		defaults = json.RawMessage(`{}`)
	} else if err := requireJSONObject("defaultParams", defaults); err != nil {
		return nil, nil, err
	}
	if len(defaults) > maxSkillDefaultParamsBytes {
		return nil, nil, errors.New("defaultParams exceeds 60 KiB")
	}
	modelID := strings.TrimSpace(dto.ModelID)
	if len([]rune(modelID)) > maxSkillModelIDRunes {
		return nil, nil, errors.New("modelId must not exceed 128 characters")
	}
	version := &model.SkillVersion{
		SkillID: skill.ID, Kind: kind, Status: model.SkillVersionDraft,
		EntryPoints: model.JSONString(entryPoints), PrimaryOutputType: primaryOutput,
		OutputTypes: model.JSONString(outputTypes), InputSchema: string(inputSchema), ManifestJSON: string(manifest),
		PromptTemplate: prompt, ModelID: modelID, DefaultParams: string(defaults),
		PrimaryFilePath: primary, CreatedBy: actor,
	}
	if dto.Bindings != nil {
		snapshots, err := normalizeSkillBindingSnapshots(dto.Bindings)
		if err != nil {
			return nil, nil, err
		}
		if err := validateSkillKindBindings(kind, snapshots); err != nil {
			return nil, nil, err
		}
		version.BindingsJSON = model.JSONString(snapshots)
	}
	if err := validateSkillKindContract(version); err != nil {
		return nil, nil, err
	}
	version.ContentHash = skillVersionContentHash(version, files)
	return version, files, nil
}

// defaultSkillPackagePrompt turns every imported supporting text file into an
// explicit, pinned reference. The runtime still expands only declared
// {{skill.*}} tokens, while standard multi-file Skill packages no longer lose
// their references/*.md instructions after a successful import.
func defaultSkillPackagePrompt(primary string, files []model.SkillFile) string {
	primaryContent := ""
	for i := range files {
		if files[i].Path == primary {
			primaryContent = files[i].Content
			break
		}
	}
	if len(files) <= 1 {
		return primaryContent
	}
	if skillFileReferencePattern.MatchString(primaryContent) {
		return "{{skill.primary}}"
	}
	parts := []string{"{{skill.primary}}"}
	for i := range files {
		if files[i].Path == primary {
			continue
		}
		parts = append(parts, fmt.Sprintf("\n\n---\nSkill 参考文件：%s\n\n{{skill.file:%s}}", files[i].Path, files[i].Path))
	}
	return strings.Join(parts, "")
}

func validateSkillExecutablePromptSize(prompt, primaryPath string, files []model.SkillFile) error {
	if len([]byte(prompt)) > maxSkillExecutablePromptBytes {
		return errors.New("promptTemplate exceeds 1 MiB")
	}
	for i := range files {
		if files[i].Path == primaryPath && len([]byte(files[i].Content)) > maxSkillExecutablePromptBytes {
			return errors.New("primary skill file exceeds 1 MiB")
		}
	}
	return nil
}

// legacyPresetExecutionEditableTx is called only after the parent Skill row is
// locked. It keeps the compatibility PUT endpoint from flattening an immutable
// multi-file/schema/manifest preset into a legacy single-prompt version.
func legacyPresetExecutionEditableTx(tx *gorm.DB, skill *model.Skill) (bool, error) {
	if skill == nil || skill.ID == 0 {
		return false, errors.New("invalid skill")
	}
	if skill.CurrentVersionID == 0 {
		return true, nil
	}
	var version model.SkillVersion
	if err := tx.Where("id = ? AND skill_id = ?", skill.CurrentVersionID, skill.ID).First(&version).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return false, nil
		}
		return false, err
	}
	var files []model.SkillFile
	if err := tx.Where("skill_version_id = ?", version.ID).Order("path ASC").Find(&files).Error; err != nil {
		return false, err
	}
	return isSimpleLegacyPresetVersion(&version, files), nil
}

func isSimpleLegacyPresetVersion(version *model.SkillVersion, files []model.SkillFile) bool {
	if version == nil || version.Kind != model.SkillKindPreset || version.Status != model.SkillVersionPublished {
		return false
	}
	if !sameAdminStringSet(version.EntryPoints, []string{"chat", "studio", "canvas"}) {
		return false
	}
	outputs := []string{}
	if json.Unmarshal([]byte(version.OutputTypes), &outputs) != nil || len(outputs) != 1 ||
		strings.ToLower(strings.TrimSpace(outputs[0])) != strings.ToLower(strings.TrimSpace(version.PrimaryOutputType)) {
		return false
	}
	if !isSimpleLegacyInputSchema(version.InputSchema) || !isSimpleLegacyPresetManifest(version) {
		return false
	}
	if version.PrimaryFilePath != "SKILL.md" || len(files) != 1 || files[0].Path != "SKILL.md" {
		return false
	}
	if len([]byte(version.PromptTemplate)) > maxSkillExecutablePromptBytes || len([]byte(files[0].Content)) > maxSkillExecutablePromptBytes {
		return false
	}
	if strings.Contains(version.PromptTemplate, "{{skill.") || strings.Contains(files[0].Content, "{{skill.") {
		return false
	}
	return files[0].Content == version.PromptTemplate || strings.TrimSpace(files[0].Content) == strings.TrimSpace(version.PromptTemplate)
}

func sameAdminStringSet(raw string, expected []string) bool {
	var values []string
	if json.Unmarshal([]byte(raw), &values) != nil || len(values) != len(expected) {
		return false
	}
	wanted := make(map[string]bool, len(expected))
	for _, value := range expected {
		wanted[value] = true
	}
	seen := make(map[string]bool, len(values))
	for _, value := range values {
		value = strings.ToLower(strings.TrimSpace(value))
		if !wanted[value] || seen[value] {
			return false
		}
		seen[value] = true
	}
	return len(seen) == len(wanted)
}

func isSimpleLegacyInputSchema(raw string) bool {
	var schema map[string]any
	if json.Unmarshal([]byte(raw), &schema) != nil || schema == nil {
		return false
	}
	hasObjectType := false
	for key, value := range schema {
		switch key {
		case "type":
			if typeName, ok := value.(string); !ok || typeName != "object" {
				return false
			}
			hasObjectType = true
		case "properties":
			properties, ok := value.(map[string]any)
			if !ok || len(properties) != 0 {
				return false
			}
		case "required", "fields":
			items, ok := value.([]any)
			if !ok || len(items) != 0 {
				return false
			}
		default:
			return false
		}
	}
	return hasObjectType
}

func isSimpleLegacyPresetManifest(version *model.SkillVersion) bool {
	var manifest map[string]json.RawMessage
	if json.Unmarshal([]byte(version.ManifestJSON), &manifest) != nil || manifest == nil {
		return false
	}
	allowed := map[string]bool{
		"kind": true, "primaryOutputType": true, "outputTypes": true,
		"promptTemplate": true, "modelId": true, "defaultParams": true,
	}
	for key := range manifest {
		if !allowed[key] {
			return false
		}
	}
	var kind, primary string
	var outputs []string
	if json.Unmarshal(manifest["kind"], &kind) != nil || kind != model.SkillKindPreset ||
		json.Unmarshal(manifest["primaryOutputType"], &primary) != nil ||
		strings.ToLower(strings.TrimSpace(primary)) != strings.ToLower(strings.TrimSpace(version.PrimaryOutputType)) ||
		json.Unmarshal(manifest["outputTypes"], &outputs) != nil || len(outputs) != 1 ||
		strings.ToLower(strings.TrimSpace(outputs[0])) != strings.ToLower(strings.TrimSpace(version.PrimaryOutputType)) {
		return false
	}
	if raw, exists := manifest["promptTemplate"]; exists {
		var prompt string
		if json.Unmarshal(raw, &prompt) != nil || prompt != version.PromptTemplate {
			return false
		}
	}
	if raw, exists := manifest["modelId"]; exists {
		var modelID string
		if json.Unmarshal(raw, &modelID) != nil || modelID != version.ModelID {
			return false
		}
	}
	if raw, exists := manifest["defaultParams"]; exists && !equivalentAdminJSONObjects(raw, version.DefaultParams) {
		return false
	}
	return true
}

func equivalentAdminJSONObjects(left json.RawMessage, right string) bool {
	var leftObject, rightObject map[string]any
	if json.Unmarshal(left, &leftObject) != nil || leftObject == nil {
		return false
	}
	if strings.TrimSpace(right) == "" {
		right = "{}"
	}
	if json.Unmarshal([]byte(right), &rightObject) != nil || rightObject == nil {
		return false
	}
	return reflect.DeepEqual(leftObject, rightObject)
}

func persistSkillVersion(db *gorm.DB, skill *model.Skill, version *model.SkillVersion, files []model.SkillFile, publish bool) error {
	return db.Transaction(func(tx *gorm.DB) error {
		return persistSkillVersionTx(tx, skill, version, files, publish)
	})
}

func persistSkillVersionTx(tx *gorm.DB, skill *model.Skill, version *model.SkillVersion, files []model.SkillFile, publish bool) error {
	// Locking the parent serializes MAX(version_no)+1 on MySQL. The unique index
	// remains the final guard for engines that ignore row locks (for example SQLite).
	var locked model.Skill
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", skill.ID).First(&locked).Error; err != nil {
		return err
	}
	if strings.TrimSpace(version.BindingsJSON) == "" {
		var snapshots []skillBindingSnapshot
		if version.Kind == model.SkillKindAgent {
			snapshots = []skillBindingSnapshot{{Surface: "canvas", TargetType: "*", Enabled: true, Defaults: json.RawMessage(`{}`)}}
		} else {
			var err error
			snapshots, err = currentOrDefaultBindingSnapshotsTx(
				tx,
				skill.ID,
				version.EntryPoints,
				version.PrimaryOutputType,
			)
			if err != nil {
				return err
			}
		}
		version.BindingsJSON = model.JSONString(snapshots)
	}
	if err := validateSkillKindContract(version); err != nil {
		return err
	}
	if err := validateAssetBindingOutputs(version); err != nil {
		return err
	}
	// Bindings are part of the immutable executable snapshot, so the final hash
	// is computed only after nil bindings have inherited the live version.
	version.ContentHash = skillVersionContentHash(version, files)
	var highest int
	if err := tx.Model(&model.SkillVersion{}).Where("skill_id = ?", skill.ID).
		Select("COALESCE(MAX(version_no), 0)").Scan(&highest).Error; err != nil {
		return err
	}
	version.Version = highest + 1
	if publish {
		now := time.Now()
		version.Status = model.SkillVersionPublished
		version.PublishedAt = &now
	}
	if err := tx.Create(version).Error; err != nil {
		return err
	}
	for i := range files {
		files[i].SkillVersionID = version.ID
		if err := tx.Create(&files[i]).Error; err != nil {
			return err
		}
	}
	if publish {
		return publishSkillVersionTx(tx, skill, version)
	}
	return nil
}

func publishSkillVersion(db *gorm.DB, skill *model.Skill, version *model.SkillVersion) error {
	return db.Transaction(func(tx *gorm.DB) error { return publishSkillVersionTx(tx, skill, version) })
}

func publishSkillVersionTx(tx *gorm.DB, skill *model.Skill, version *model.SkillVersion) error {
	if skill == nil || skill.ID == 0 {
		return errors.New("invalid skill")
	}
	if err := validateSkillKindContract(version); err != nil {
		return err
	}
	if err := validateConfiguredSkillModels(tx, version); err != nil {
		return err
	}
	var locked model.Skill
	// Every publish path takes the same parent lock used by legacy update and
	// version creation. The current-version guard therefore cannot race a direct
	// publish and make its decision against a stale CurrentVersionID.
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", skill.ID).First(&locked).Error; err != nil {
		return err
	}
	now := time.Now()
	if err := applyVersionBindingsTx(tx, skill.ID, version); err != nil {
		return err
	}
	if err := tx.Model(&model.SkillVersion{}).Where("skill_id = ? AND status = ? AND id <> ?", skill.ID, model.SkillVersionPublished, version.ID).
		Update("status", model.SkillVersionArchived).Error; err != nil {
		return err
	}
	if err := tx.Model(&model.SkillVersion{}).Where("id = ?", version.ID).Updates(map[string]any{"status": model.SkillVersionPublished, "published_at": now}).Error; err != nil {
		return err
	}
	version.Status = model.SkillVersionPublished
	version.PublishedAt = &now
	updates := map[string]any{
		"current_version_id": version.ID,
		"kind":               version.Kind,
		"output_type":        version.PrimaryOutputType,
	}
	if version.Kind == model.SkillKindPreset {
		updates["prompt_template"] = version.PromptTemplate
		updates["model_id"] = version.ModelID
		updates["default_params"] = version.DefaultParams
	}
	return tx.Model(&model.Skill{}).Where("id = ?", skill.ID).Updates(updates).Error
}

// publishLegacyPresetVersion preserves the old CRUD contract while producing a
// new immutable published version for every admin save.
func publishLegacyPresetVersion(db *gorm.DB, skill *model.Skill, actor idgen.ID) error {
	return db.Transaction(func(tx *gorm.DB) error {
		return publishLegacyPresetVersionTx(tx, skill, actor)
	})
}

func publishLegacyPresetVersionTx(tx *gorm.DB, skill *model.Skill, actor idgen.ID) error {
	dto := AdminSkillVersionCreateDTO{Kind: model.SkillKindPreset,
		EntryPoints:       []string{"chat", "studio", "canvas"},
		PrimaryOutputType: skill.OutputType, OutputTypes: []string{skill.OutputType},
		InputSchema:    json.RawMessage(`{"type":"object"}`),
		PromptTemplate: skill.PromptTemplate, ModelID: skill.ModelID,
		DefaultParams: json.RawMessage(defaultAdminObject(skill.DefaultParams)), Publish: true}
	v, files, err := buildSkillVersion(tx, skill, dto, actor)
	if err != nil {
		return err
	}
	return persistSkillVersionTx(tx, skill, v, files, true)
}

func replaceSkillBindingsTx(tx *gorm.DB, skillID idgen.ID, input []AdminSkillBindingDTO, entryPointsJSON string) error {
	if input == nil {
		var count int64
		if err := tx.Model(&model.SkillSurfaceBinding{}).Where("skill_id = ?", skillID).Count(&count).Error; err != nil {
			return err
		}
		if count > 0 {
			return nil
		}
		for _, surface := range model.JSONStrings(entryPointsJSON, []string{"chat", "studio", "canvas"}) {
			row := model.SkillSurfaceBinding{SkillID: skillID, Surface: surface, TargetType: "*", Enabled: true}
			if err := tx.Create(&row).Error; err != nil {
				return err
			}
		}
		return nil
	}
	if len(input) > maxSkillImportBindings {
		return fmt.Errorf("bindings may contain at most %d items", maxSkillImportBindings)
	}
	validSurfaces := map[string]bool{"chat": true, "studio": true, "canvas": true, "api": true}
	normalized := make([]model.SkillSurfaceBinding, 0, len(input))
	seen := map[string]bool{}
	for _, item := range input {
		surface := strings.ToLower(strings.TrimSpace(item.Surface))
		if !validSurfaces[surface] {
			return fmt.Errorf("unsupported surface %q", surface)
		}
		target := strings.ToLower(strings.TrimSpace(item.TargetType))
		if target == "" {
			target = "*"
		}
		if len(target) > 32 || strings.ContainsAny(target, " /\\\x00") {
			return fmt.Errorf("invalid targetType %q", target)
		}
		key := surface + "\x00" + target
		if seen[key] {
			return fmt.Errorf("duplicate binding for %s/%s", surface, target)
		}
		seen[key] = true
		defaults := "{}"
		if len(item.Defaults) > 0 {
			if err := requireJSONObject("bindings.defaults", item.Defaults); err != nil {
				return err
			}
			if len(item.Defaults) > maxSkillBindingDefaultsBytes {
				return errors.New("bindings.defaults exceeds 60 KiB")
			}
			defaults = string(item.Defaults)
		}
		enabled := true
		if item.Enabled != nil {
			enabled = *item.Enabled
		}
		normalized = append(normalized, model.SkillSurfaceBinding{
			SkillID: skillID, Surface: surface, TargetType: target, Enabled: enabled,
			SortOrder: item.SortOrder, Defaults: defaults,
		})
	}
	if err := tx.Unscoped().Where("skill_id = ?", skillID).Delete(&model.SkillSurfaceBinding{}).Error; err != nil {
		return err
	}
	for i := range normalized {
		if err := tx.Create(&normalized[i]).Error; err != nil {
			return err
		}
	}
	return nil
}

func normalizeSkillBindingSnapshots(input []AdminSkillBindingDTO) ([]skillBindingSnapshot, error) {
	if len(input) > maxSkillImportBindings {
		return nil, fmt.Errorf("bindings may contain at most %d items", maxSkillImportBindings)
	}
	validSurfaces := map[string]bool{"chat": true, "studio": true, "canvas": true, "api": true}
	out := make([]skillBindingSnapshot, 0, len(input))
	seen := map[string]bool{}
	for _, item := range input {
		surface := strings.ToLower(strings.TrimSpace(item.Surface))
		if !validSurfaces[surface] {
			return nil, fmt.Errorf("unsupported surface %q", surface)
		}
		target := strings.ToLower(strings.TrimSpace(item.TargetType))
		if target == "" {
			target = "*"
		}
		if len(target) > 32 || strings.ContainsAny(target, " /\\\x00") {
			return nil, fmt.Errorf("invalid targetType %q", target)
		}
		key := surface + "\x00" + target
		if seen[key] {
			return nil, fmt.Errorf("duplicate binding for %s/%s", surface, target)
		}
		seen[key] = true
		defaults := json.RawMessage(`{}`)
		if len(item.Defaults) > 0 {
			if err := requireJSONObject("bindings.defaults", item.Defaults); err != nil {
				return nil, err
			}
			if len(item.Defaults) > maxSkillBindingDefaultsBytes {
				return nil, errors.New("bindings.defaults exceeds 60 KiB")
			}
			defaults = append(json.RawMessage(nil), item.Defaults...)
		}
		enabled := true
		if item.Enabled != nil {
			enabled = *item.Enabled
		}
		out = append(out, skillBindingSnapshot{Surface: surface, TargetType: target, Enabled: enabled, SortOrder: item.SortOrder, Defaults: defaults})
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Surface != out[j].Surface {
			return out[i].Surface < out[j].Surface
		}
		if out[i].SortOrder != out[j].SortOrder {
			return out[i].SortOrder < out[j].SortOrder
		}
		return out[i].TargetType < out[j].TargetType
	})
	return out, nil
}

func validateSkillKindBindings(kind string, bindings []skillBindingSnapshot) error {
	if kind == model.SkillKindAgent {
		if len(bindings) == 0 {
			return errors.New("agent must have at least one canvas binding")
		}
		for i := range bindings {
			if bindings[i].Surface != "canvas" {
				return errors.New("agent bindings must use the canvas surface only")
			}
		}
		return nil
	}
	if kind == model.SkillKindPreset {
		for i := range bindings {
			surface := bindings[i].Surface
			if surface != "chat" && surface != "studio" && surface != "canvas" {
				return errors.New("preset bindings may only use chat, studio or canvas")
			}
		}
	}
	if kind == model.SkillKindTool {
		if len(bindings) == 0 {
			return errors.New("tool must have at least one studio or api binding")
		}
		for i := range bindings {
			if bindings[i].Surface != "studio" && bindings[i].Surface != "api" {
				return errors.New("tool bindings may only use studio or api")
			}
		}
	}
	return nil
}

func validateSkillKindContract(version *model.SkillVersion) error {
	if version == nil || !model.ValidSkillKind(version.Kind) {
		return errors.New("kind must be preset, agent or tool")
	}
	primary := strings.ToLower(strings.TrimSpace(version.PrimaryOutputType))
	outputs := model.JSONStrings(version.OutputTypes, nil)
	if version.Kind == model.SkillKindPreset {
		if len(outputs) != 1 || strings.ToLower(strings.TrimSpace(outputs[0])) != primary {
			return errors.New("preset must declare exactly one output type matching primaryOutputType")
		}
		entryPoints := model.JSONStrings(version.EntryPoints, nil)
		if len(entryPoints) == 0 {
			return errors.New("preset must declare at least one entry point")
		}
		for _, entryPoint := range entryPoints {
			entryPoint = strings.ToLower(strings.TrimSpace(entryPoint))
			if entryPoint != "chat" && entryPoint != "studio" && entryPoint != "canvas" {
				return errors.New("preset entryPoints may only contain chat, studio or canvas")
			}
		}
	} else if version.Kind == model.SkillKindAgent {
		entryPoints := model.JSONStrings(version.EntryPoints, nil)
		if len(entryPoints) != 1 || strings.ToLower(strings.TrimSpace(entryPoints[0])) != "canvas" {
			return errors.New("agent entryPoints must contain canvas only")
		}
	} else {
		if primary != "text" && primary != "file" {
			return errors.New("tool primaryOutputType must be text or file")
		}
		for _, output := range outputs {
			output = strings.ToLower(strings.TrimSpace(output))
			if output != "text" && output != "file" {
				return errors.New("tool outputTypes may only contain text or file")
			}
		}
		entryPoints := model.JSONStrings(version.EntryPoints, nil)
		if len(entryPoints) == 0 {
			return errors.New("tool must declare at least one entry point")
		}
		for _, entryPoint := range entryPoints {
			entryPoint = strings.ToLower(strings.TrimSpace(entryPoint))
			if entryPoint != "studio" && entryPoint != "api" {
				return errors.New("tool entryPoints may only contain studio or api")
			}
		}
	}
	if strings.TrimSpace(version.BindingsJSON) != "" {
		var bindings []skillBindingSnapshot
		if json.Unmarshal([]byte(version.BindingsJSON), &bindings) != nil {
			return errors.New("skill version bindings are invalid")
		}
		if err := validateSkillKindBindings(version.Kind, bindings); err != nil {
			return err
		}
	}
	return nil
}

func validateAssetBindingOutputs(version *model.SkillVersion) error {
	var bindings []skillBindingSnapshot
	if json.Unmarshal([]byte(version.BindingsJSON), &bindings) != nil {
		return errors.New("skill version bindings are invalid")
	}
	restricted := false
	for i := range bindings {
		if bindings[i].Enabled && bindings[i].Surface == "asset" &&
			(bindings[i].TargetType == "*" || bindings[i].TargetType == "character" || bindings[i].TargetType == "scene") {
			restricted = true
			break
		}
	}
	if !restricted {
		return nil
	}
	finalTypes := map[string]bool{}
	if version.Kind == model.SkillKindAgent {
		var manifest struct {
			Steps []struct {
				Type            string `json:"type"`
				OutputType      string `json:"outputType"`
				OutputRole      string `json:"outputRole"`
				PromotePrevious bool   `json:"promotePrevious"`
			} `json:"steps"`
		}
		if json.Unmarshal([]byte(version.ManifestJSON), &manifest) == nil {
			for i := range manifest.Steps {
				step := manifest.Steps[i]
				if step.Type != "text" && step.Type != "generate" {
					continue
				}
				promoted := i+1 < len(manifest.Steps) && manifest.Steps[i+1].Type == "approval" && manifest.Steps[i+1].PromotePrevious
				if step.OutputRole == "final" || (step.OutputRole == "" && i == len(manifest.Steps)-1) || promoted {
					output := strings.ToLower(strings.TrimSpace(step.OutputType))
					if output == "" && step.Type == "text" {
						output = "text"
					}
					finalTypes[output] = true
				}
			}
		}
	}
	if len(finalTypes) == 0 {
		finalTypes[strings.ToLower(strings.TrimSpace(version.PrimaryOutputType))] = true
	}
	if len(finalTypes) != 1 || !finalTypes["image"] {
		return errors.New("asset character/scene bindings require image-only final output")
	}
	return nil
}

func defaultAdminSkillBindingTarget(surface, primaryOutputType string) string {
	if strings.EqualFold(strings.TrimSpace(surface), "asset") &&
		!strings.EqualFold(strings.TrimSpace(primaryOutputType), "image") {
		return "general"
	}
	return "*"
}

func currentOrDefaultBindingSnapshotsTx(
	tx *gorm.DB,
	skillID idgen.ID,
	entryPointsJSON string,
	primaryOutputType string,
) ([]skillBindingSnapshot, error) {
	var rows []model.SkillSurfaceBinding
	if err := tx.Where("skill_id = ?", skillID).Order("surface ASC, sort_order ASC, target_type ASC").Find(&rows).Error; err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		out := make([]skillBindingSnapshot, 0)
		for _, surface := range model.JSONStrings(entryPointsJSON, []string{"chat", "studio", "canvas"}) {
			out = append(out, skillBindingSnapshot{
				Surface: surface, TargetType: defaultAdminSkillBindingTarget(surface, primaryOutputType),
				Enabled: true, Defaults: json.RawMessage(`{}`),
			})
		}
		return out, nil
	}
	out := make([]skillBindingSnapshot, 0, len(rows))
	for i := range rows {
		defaults := json.RawMessage(defaultAdminObject(rows[i].Defaults))
		out = append(out, skillBindingSnapshot{Surface: rows[i].Surface, TargetType: rows[i].TargetType, Enabled: rows[i].Enabled, SortOrder: rows[i].SortOrder, Defaults: defaults})
	}
	return out, nil
}

func applyVersionBindingsTx(tx *gorm.DB, skillID idgen.ID, version *model.SkillVersion) error {
	var snapshots []skillBindingSnapshot
	if strings.TrimSpace(version.BindingsJSON) == "" {
		var err error
		snapshots, err = currentOrDefaultBindingSnapshotsTx(
			tx,
			skillID,
			version.EntryPoints,
			version.PrimaryOutputType,
		)
		if err != nil {
			return err
		}
	} else if err := json.Unmarshal([]byte(version.BindingsJSON), &snapshots); err != nil {
		return errors.New("skill version bindings are invalid")
	}
	if err := tx.Unscoped().Where("skill_id = ?", skillID).Delete(&model.SkillSurfaceBinding{}).Error; err != nil {
		return err
	}
	for i := range snapshots {
		row := model.SkillSurfaceBinding{SkillID: skillID, Surface: snapshots[i].Surface, TargetType: snapshots[i].TargetType,
			Enabled: snapshots[i].Enabled, SortOrder: snapshots[i].SortOrder, Defaults: string(snapshots[i].Defaults)}
		if err := tx.Create(&row).Error; err != nil {
			return err
		}
	}
	return nil
}

func normalizeSkillFiles(in []AdminSkillFileDTO, requestedPrimary string) ([]model.SkillFile, string, error) {
	if len(in) == 0 {
		return nil, "", nil
	}
	if len(in) > maxSkillImportFiles {
		return nil, "", fmt.Errorf("a Skill package may contain at most %d text files", maxSkillImportFiles)
	}
	seen := map[string]bool{}
	total := 0
	out := make([]model.SkillFile, 0, len(in))
	for _, item := range in {
		p, err := cleanSkillPath(item.Path)
		if err != nil {
			return nil, "", err
		}
		pathKey := strings.ToLower(p)
		if seen[pathKey] {
			return nil, "", fmt.Errorf("duplicate skill file path %q", p)
		}
		seen[pathKey] = true
		size := len([]byte(item.Content))
		total += size
		if size == 0 || size > maxSkillImportFileBytes || total > maxSkillImportTotalBytes {
			return nil, "", errors.New("skill file package exceeds size limit")
		}
		if strings.ContainsRune(item.Content, '\x00') {
			return nil, "", fmt.Errorf("skill file %q contains invalid NUL bytes", p)
		}
		ext := strings.ToLower(path.Ext(p))
		if ext != ".md" && ext != ".txt" {
			return nil, "", fmt.Errorf("unsupported skill file %q", p)
		}
		mime := strings.TrimSpace(item.MimeType)
		if mime == "" {
			if ext == ".md" {
				mime = "text/markdown; charset=utf-8"
			} else {
				mime = "text/plain; charset=utf-8"
			}
		}
		if len([]rune(mime)) > maxSkillMimeTypeRunes || strings.IndexFunc(mime, func(r rune) bool {
			return r < 0x20 || r == 0x7f
		}) >= 0 {
			return nil, "", fmt.Errorf("skill file %q has an invalid mimeType", p)
		}
		out = append(out, model.SkillFile{Path: p, Content: item.Content, MimeType: mime, Size: int64(size), SHA256: hashAdminText(item.Content)})
	}
	primary := ""
	if requestedPrimary != "" {
		var err error
		primary, err = cleanSkillPath(requestedPrimary)
		if err != nil {
			return nil, "", err
		}
		primaryKey := strings.ToLower(primary)
		if !seen[primaryKey] {
			return nil, "", errors.New("primaryFilePath is not present in files")
		}
		for i := range out {
			if strings.ToLower(out[i].Path) == primaryKey {
				primary = out[i].Path
				break
			}
		}
	}
	if primary == "" {
		for i := range out {
			p := out[i].Path
			if strings.EqualFold(p, "SKILL.md") || strings.HasSuffix(strings.ToLower(p), "/skill.md") {
				if primary == "" || len(p) < len(primary) {
					primary = p
				}
			}
		}
	}
	if primary == "" && len(out) == 1 {
		primary = out[0].Path
	}
	if primary == "" {
		return nil, "", errors.New("folder import requires a SKILL.md primary file")
	}
	for i := range out {
		if strings.EqualFold(out[i].Path, primary) && strings.TrimSpace(out[i].Content) == "" {
			return nil, "", errors.New("primary skill file cannot be blank")
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Path < out[j].Path })
	return out, primary, nil
}

func cleanSkillPath(raw string) (string, error) {
	raw = strings.TrimSpace(strings.ReplaceAll(raw, "\\", "/"))
	if raw == "" || strings.HasPrefix(raw, "/") || strings.ContainsAny(raw, "{}") || strings.IndexFunc(raw, func(r rune) bool {
		return r < 0x20 || r == 0x7f
	}) >= 0 {
		return "", errors.New("invalid skill file path")
	}
	clean := path.Clean(raw)
	if clean == "." || clean == ".." || strings.HasPrefix(clean, "../") || strings.Contains(clean, ":") || len(clean) > 512 {
		return "", errors.New("invalid skill file path")
	}
	return clean, nil
}

func strictEnumList(field string, in []string, valid map[string]bool) ([]string, error) {
	out := []string{}
	seen := map[string]bool{}
	for _, v := range in {
		v = strings.ToLower(strings.TrimSpace(v))
		if !valid[v] {
			return nil, fmt.Errorf("%s contains unsupported value %q", field, v)
		}
		if !seen[v] {
			seen[v] = true
			out = append(out, v)
		}
	}
	return out, nil
}
func containsAdminString(in []string, want string) bool {
	for _, v := range in {
		if v == want {
			return true
		}
	}
	return false
}
func hashAdminText(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

func skillVersionContentHash(version *model.SkillVersion, files []model.SkillFile) string {
	h := sha256.New()
	parts := []string{
		version.Kind, version.EntryPoints, version.PrimaryOutputType, version.OutputTypes,
		version.InputSchema, version.ManifestJSON, version.PromptTemplate, version.ModelID,
		version.DefaultParams, version.BindingsJSON, version.PrimaryFilePath,
	}
	for _, part := range parts {
		_, _ = h.Write([]byte(part))
		_, _ = h.Write([]byte{0})
	}
	sorted := append([]model.SkillFile(nil), files...)
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].Path < sorted[j].Path })
	for _, file := range sorted {
		_, _ = h.Write([]byte(file.Path))
		_, _ = h.Write([]byte{0})
		_, _ = h.Write([]byte(file.SHA256))
		_, _ = h.Write([]byte{0})
	}
	return hex.EncodeToString(h.Sum(nil))
}

func requireJSONObject(field string, raw json.RawMessage) error {
	var value map[string]any
	if len(raw) == 0 || json.Unmarshal(raw, &value) != nil || value == nil {
		return fmt.Errorf("%s must be a JSON object", field)
	}
	return nil
}

func validateInputSchemaDefinition(raw json.RawMessage) error {
	var root map[string]any
	if json.Unmarshal(raw, &root) != nil || root == nil {
		return errors.New("inputSchema must be a JSON object")
	}
	if typeName, _ := root["type"].(string); typeName != "" && typeName != "object" {
		return errors.New("inputSchema root type must be object")
	}
	return validateInputSchemaNode(root, "inputSchema", 0, false)
}

func validateInputSchemaNode(node map[string]any, pathName string, depth int, compactField bool) error {
	if depth > 8 {
		return fmt.Errorf("%s nesting exceeds 8 levels", pathName)
	}
	allowed := map[string]bool{
		"$schema": true, "type": true, "title": true, "label": true, "description": true,
		"placeholder": true, "default": true, "examples": true, "format": true, "x-ui-widget": true,
		"key": true, "required": true, "properties": true, "fields": true, "additionalProperties": true,
		"enum": true, "options": true, "minimum": true, "maximum": true, "min": true, "max": true,
		"multipleOf": true, "step": true, "minLength": true, "maxLength": true, "pattern": true,
		"minItems": true, "maxItems": true, "items": true,
	}
	for key := range node {
		if !allowed[key] && !strings.HasPrefix(key, "x-") {
			return fmt.Errorf("%s.%s is not a supported input constraint", pathName, key)
		}
	}
	for _, key := range []string{"$schema", "title", "label", "description", "placeholder", "format", "x-ui-widget", "key"} {
		if rawValue, exists := node[key]; exists {
			if _, ok := rawValue.(string); !ok {
				return fmt.Errorf("%s.%s must be a string", pathName, key)
			}
		}
	}
	if rawType, exists := node["type"]; exists {
		typeName, ok := rawType.(string)
		valid := map[string]bool{"string": true, "number": true, "integer": true, "boolean": true, "array": true, "object": true}
		if compactField {
			valid["text"], valid["textarea"], valid["select"] = true, true, true
		}
		if !ok || !valid[typeName] {
			return fmt.Errorf("%s.type is unsupported", pathName)
		}
	}
	if rawRequired, exists := node["required"]; exists {
		if compactField {
			if _, ok := rawRequired.(bool); !ok {
				return fmt.Errorf("%s.required must be a boolean", pathName)
			}
		} else {
			items, ok := rawRequired.([]any)
			if !ok {
				return fmt.Errorf("%s.required must be an array", pathName)
			}
			seen := map[string]bool{}
			for _, item := range items {
				key, ok := item.(string)
				if !ok || strings.TrimSpace(key) == "" || seen[key] {
					return fmt.Errorf("%s.required contains an invalid field", pathName)
				}
				seen[key] = true
			}
		}
	}
	for _, key := range []string{"minimum", "maximum", "min", "max", "multipleOf", "step"} {
		if rawValue, exists := node[key]; exists {
			value, ok := rawValue.(float64)
			if !ok || ((key == "multipleOf" || key == "step") && value <= 0) {
				return fmt.Errorf("%s.%s must be a valid number", pathName, key)
			}
		}
	}
	for _, key := range []string{"minLength", "maxLength", "minItems", "maxItems"} {
		if rawValue, exists := node[key]; exists {
			value, ok := rawValue.(float64)
			if !ok || value < 0 || value != float64(int64(value)) {
				return fmt.Errorf("%s.%s must be a non-negative integer", pathName, key)
			}
		}
	}
	for _, pair := range [][2]string{{"minimum", "maximum"}, {"min", "max"}, {"minLength", "maxLength"}, {"minItems", "maxItems"}} {
		minimum, hasMinimum := node[pair[0]].(float64)
		maximum, hasMaximum := node[pair[1]].(float64)
		if hasMinimum && hasMaximum && minimum > maximum {
			return fmt.Errorf("%s.%s must not exceed %s", pathName, pair[0], pair[1])
		}
	}
	if rawPattern, exists := node["pattern"]; exists {
		pattern, ok := rawPattern.(string)
		if !ok {
			return fmt.Errorf("%s.pattern must be a string", pathName)
		}
		if _, err := regexp.Compile(pattern); err != nil {
			return fmt.Errorf("%s.pattern is invalid", pathName)
		}
	}
	if rawProperties, exists := node["properties"]; exists {
		properties, ok := rawProperties.(map[string]any)
		if !ok || len(properties) > 128 {
			return fmt.Errorf("%s.properties must be an object with at most 128 fields", pathName)
		}
		for key, rawChild := range properties {
			child, ok := rawChild.(map[string]any)
			if !ok {
				return fmt.Errorf("%s.properties.%s must be an object", pathName, key)
			}
			if err := validateInputSchemaNode(child, pathName+".properties."+key, depth+1, false); err != nil {
				return err
			}
		}
	}
	if rawFields, exists := node["fields"]; exists {
		fields, ok := rawFields.([]any)
		if !ok || len(fields) > 128 {
			return fmt.Errorf("%s.fields must be an array with at most 128 items", pathName)
		}
		seen := map[string]bool{}
		for index, rawField := range fields {
			field, ok := rawField.(map[string]any)
			if !ok {
				return fmt.Errorf("%s.fields[%d] must be an object", pathName, index)
			}
			key, _ := field["key"].(string)
			if strings.TrimSpace(key) == "" || seen[key] {
				return fmt.Errorf("%s.fields[%d].key is invalid", pathName, index)
			}
			seen[key] = true
			if err := validateInputSchemaNode(field, fmt.Sprintf("%s.fields[%d]", pathName, index), depth+1, true); err != nil {
				return err
			}
		}
	}
	if rawItems, exists := node["items"]; exists {
		items, ok := rawItems.(map[string]any)
		if !ok {
			return fmt.Errorf("%s.items must be an object", pathName)
		}
		if err := validateInputSchemaNode(items, pathName+".items", depth+1, false); err != nil {
			return err
		}
	}
	if rawAdditional, exists := node["additionalProperties"]; exists {
		switch rule := rawAdditional.(type) {
		case bool:
		case map[string]any:
			if err := validateInputSchemaNode(rule, pathName+".additionalProperties", depth+1, false); err != nil {
				return err
			}
		default:
			return fmt.Errorf("%s.additionalProperties must be a boolean or object", pathName)
		}
	}
	for _, key := range []string{"enum", "options", "examples"} {
		if rawList, exists := node[key]; exists {
			if _, ok := rawList.([]any); !ok {
				return fmt.Errorf("%s.%s must be an array", pathName, key)
			}
		}
	}
	return nil
}

func validateSkillManifest(
	raw json.RawMessage,
	kind string,
	primaryOutputType string,
	outputTypes []string,
) error {
	if err := requireJSONObject("manifest", raw); err != nil {
		return err
	}
	var manifest map[string]any
	_ = json.Unmarshal(raw, &manifest)
	allowedManifestFields := map[string]bool{
		"kind": true, "primaryOutputType": true, "outputTypes": true,
		"preferredNodeType": true, "steps": true,
		// Legacy preset snapshots may carry these execution fields inline.
		"promptTemplate": true, "modelId": true, "defaultParams": true,
	}
	for field := range manifest {
		if !allowedManifestFields[field] {
			return fmt.Errorf("manifest.%s is not supported", field)
		}
	}
	for _, field := range []string{"promptTemplate", "modelId"} {
		if rawValue, exists := manifest[field]; exists {
			value, ok := rawValue.(string)
			if !ok {
				return fmt.Errorf("manifest.%s must be a string", field)
			}
			if field == "modelId" && len(value) > 128 {
				return errors.New("manifest.modelId is too long")
			}
		}
	}
	if rawDefaults, exists := manifest["defaultParams"]; exists {
		encoded, err := json.Marshal(rawDefaults)
		if err != nil || requireJSONObject("manifest.defaultParams", encoded) != nil {
			return errors.New("manifest.defaultParams must be an object")
		}
	}
	if rawDeclared, exists := manifest["kind"]; exists {
		declared, ok := rawDeclared.(string)
		if !ok {
			return errors.New("manifest.kind must be a string")
		}
		if declared != strings.ToLower(declared) || declared != kind {
			return errors.New("manifest.kind must match kind and use canonical lowercase form")
		}
	}
	if rawPrimary, exists := manifest["primaryOutputType"]; exists {
		declared, ok := rawPrimary.(string)
		if !ok {
			return errors.New("manifest.primaryOutputType must be a string")
		}
		if declared != strings.ToLower(declared) || declared != primaryOutputType {
			return errors.New("manifest.primaryOutputType must match the version and use canonical lowercase form")
		}
	}
	if rawOutputs, exists := manifest["outputTypes"]; exists {
		items, ok := rawOutputs.([]any)
		if !ok || len(items) == 0 {
			return errors.New("manifest.outputTypes must be a non-empty array")
		}
		declared := make([]string, 0, len(items))
		for _, rawOutput := range items {
			output, ok := rawOutput.(string)
			if !ok || output != strings.ToLower(output) {
				return errors.New("manifest.outputTypes must contain canonical lowercase strings")
			}
			declared = append(declared, output)
		}
		if !sameStringValues(declared, outputTypes) {
			return errors.New("manifest.outputTypes must match the version outputTypes")
		}
	}
	if rawPreferred, exists := manifest["preferredNodeType"]; exists {
		preferred, ok := rawPreferred.(string)
		if !ok || (preferred != "" && preferred != "character" && preferred != "scene") {
			return errors.New("manifest.preferredNodeType must be character or scene")
		}
	}
	rawSteps, exists := manifest["steps"]
	if !exists {
		return nil
	}
	if kind == model.SkillKindPreset {
		return errors.New("preset manifest.steps is not supported; use agent for multi-step skills")
	}
	steps, ok := rawSteps.([]any)
	if !ok || len(steps) == 0 || len(steps) > 64 {
		return errors.New("manifest.steps must be a non-empty array with at most 64 items")
	}
	validTypes := map[string]bool{"text": true, "generate": true, "tool": true, "approval": true, "input": true}
	validHandlers := map[string]bool{
		"": true, "skill_text_completion": true, "assistant_chat": true,
		"text_to_image": true, "image_to_image": true, "text_to_video": true,
		"image_to_video": true, "start_end_to_video": true, "reference_to_video": true,
		"text_to_audio": true,
		"render_pptx":   true, "render_xlsx": true, "render_docx": true, "render_markdown": true,
		"analyze_image": true, "analyze_video": true, "analyze_audio": true, "analyze_webpage": true, "analyze_account": true,
	}
	toolHandlers := map[string]bool{
		"render_pptx": true, "render_xlsx": true, "render_docx": true, "render_markdown": true,
		"analyze_image": true, "analyze_video": true, "analyze_audio": true, "analyze_webpage": true, "analyze_account": true,
	}
	seen := map[string]bool{}
	finalOutputTypes := map[string]bool{}
	hasToolStep := false
	for index, item := range steps {
		step, ok := item.(map[string]any)
		if !ok {
			return fmt.Errorf("manifest.steps[%d] must be an object", index)
		}
		allowedStepFields := map[string]bool{
			"key": true, "title": true, "type": true, "handler": true, "modelId": true,
			"prompt": true, "systemPrompt": true, "outputType": true, "outputRole": true,
			"registerWork": true, "strictJson": true, "preferredNodeType": true,
			"message": true, "schema": true, "promotePrevious": true,
		}
		for field := range step {
			if !allowedStepFields[field] {
				return fmt.Errorf("manifest.steps[%d].%s is not supported", index, field)
			}
		}
		for field, maxRunes := range map[string]int{
			"key": 128, "title": 128, "handler": 64, "modelId": 128,
			"prompt": 1 << 20, "systemPrompt": 1 << 20, "message": 2000, "preferredNodeType": 32,
		} {
			rawValue, exists := step[field]
			if !exists {
				continue
			}
			value, ok := rawValue.(string)
			if !ok {
				return fmt.Errorf("manifest.steps[%d].%s must be a string", index, field)
			}
			if len([]rune(value)) > maxRunes {
				return fmt.Errorf("manifest.steps[%d].%s is too long", index, field)
			}
			if (field == "prompt" || field == "systemPrompt") && len([]byte(value)) > maxSkillExecutablePromptBytes {
				return fmt.Errorf("manifest.steps[%d].%s exceeds 1 MiB", index, field)
			}
		}
		if preferred, _ := step["preferredNodeType"].(string); preferred != "" && preferred != "character" && preferred != "scene" {
			return fmt.Errorf("manifest.steps[%d].preferredNodeType must be character or scene", index)
		}
		key, _ := step["key"].(string)
		key = strings.TrimSpace(key)
		if rawKey, exists := step["key"].(string); exists && rawKey != key {
			return fmt.Errorf("manifest.steps[%d].key must not contain surrounding whitespace", index)
		}
		if key == "" {
			key = fmt.Sprintf("step_%d", index+1)
		}
		if seen[key] {
			return fmt.Errorf("manifest.steps contains duplicate key %q", key)
		}
		seen[key] = true
		typeName, _ := step["type"].(string)
		typeName = strings.ToLower(strings.TrimSpace(typeName))
		if !validTypes[typeName] {
			return fmt.Errorf("manifest.steps[%d].type is unsupported", index)
		}
		if rawType, _ := step["type"].(string); rawType != typeName {
			return fmt.Errorf("manifest.steps[%d].type must use canonical lowercase form", index)
		}
		handler, _ := step["handler"].(string)
		handler = strings.TrimSpace(handler)
		if !validHandlers[handler] {
			return fmt.Errorf("manifest.steps[%d].handler is unsupported", index)
		}
		if typeName == "tool" {
			hasToolStep = true
			if !toolHandlers[handler] {
				return fmt.Errorf("manifest.steps[%d] tool handler is required and must be registered", index)
			}
		} else if toolHandlers[handler] {
			return fmt.Errorf("manifest.steps[%d] registered tool handler requires type tool", index)
		}
		if (typeName == "approval" || typeName == "input") && handler != "" {
			return fmt.Errorf("manifest.steps[%d] approval/input cannot declare handler", index)
		}
		if typeName == "text" && handler != "" && handler != "skill_text_completion" && handler != "assistant_chat" {
			return fmt.Errorf("manifest.steps[%d] text handler is incompatible", index)
		}
		if typeName == "generate" && (handler == "skill_text_completion" || handler == "assistant_chat") {
			return fmt.Errorf("manifest.steps[%d] generate handler is incompatible", index)
		}
		if value, exists := step["promotePrevious"]; exists {
			promote, ok := value.(bool)
			if !ok {
				return fmt.Errorf("manifest.steps[%d].promotePrevious must be a boolean", index)
			}
			if typeName != "approval" {
				return fmt.Errorf("manifest.steps[%d].promotePrevious is only valid on approval", index)
			}
			if promote && (index == 0 || func() bool {
				previous, _ := steps[index-1].(map[string]any)
				return previous["type"] != "text" && previous["type"] != "generate"
			}()) {
				return fmt.Errorf("manifest.steps[%d].promotePrevious requires a preceding executable step", index)
			}
		}
		if value, exists := step["strictJson"]; exists {
			if _, ok := value.(bool); !ok {
				return fmt.Errorf("manifest.steps[%d].strictJson must be a boolean", index)
			}
			if typeName != "text" {
				return fmt.Errorf("manifest.steps[%d].strictJson is only valid on text steps", index)
			}
		}
		if typeName == "approval" || typeName == "input" {
			for _, field := range []string{
				"handler", "modelId", "prompt", "systemPrompt", "outputRole", "registerWork",
				"strictJson", "preferredNodeType", "outputType",
			} {
				if _, exists := step[field]; exists {
					return fmt.Errorf("manifest.steps[%d] approval/input cannot declare ignored field %s", index, field)
				}
			}
		}
		if typeName != "approval" && typeName != "input" {
			for _, field := range []string{"message", "schema"} {
				if _, exists := step[field]; exists {
					return fmt.Errorf("manifest.steps[%d] executable step cannot declare ignored field %s", index, field)
				}
			}
		}
		if typeName == "generate" {
			if _, exists := step["systemPrompt"]; exists {
				return fmt.Errorf("manifest.steps[%d] generate step cannot declare ignored field systemPrompt", index)
			}
		}
		if typeName == "tool" && strings.HasPrefix(handler, "render_") {
			for _, field := range []string{"modelId", "systemPrompt", "preferredNodeType"} {
				if _, exists := step[field]; exists {
					return fmt.Errorf("manifest.steps[%d] render tool cannot declare ignored field %s", index, field)
				}
			}
		}
		registerWork := false
		if value, exists := step["registerWork"]; exists {
			var ok bool
			registerWork, ok = value.(bool)
			if !ok {
				return fmt.Errorf("manifest.steps[%d].registerWork must be a boolean", index)
			}
		}
		outputType, outputIsString := step["outputType"].(string)
		if _, exists := step["outputType"]; exists && !outputIsString {
			return fmt.Errorf("manifest.steps[%d].outputType must be a string", index)
		}
		outputType = strings.ToLower(strings.TrimSpace(outputType))
		if outputType == "" && typeName == "text" {
			outputType = "text"
		}
		if (typeName == "generate" || typeName == "tool") && outputType == "" {
			return fmt.Errorf("manifest.steps[%d].outputType is required for %s", index, typeName)
		}
		if typeName == "text" && outputType != "text" && outputType != "file" {
			return fmt.Errorf("manifest.steps[%d] text outputType must be text or file", index)
		}
		if typeName == "generate" && outputType != "image" && outputType != "video" && outputType != "audio" {
			return fmt.Errorf("manifest.steps[%d] generate outputType must be image, video, or audio", index)
		}
		if typeName == "tool" {
			if strings.HasPrefix(handler, "render_") && outputType != "file" {
				return fmt.Errorf("manifest.steps[%d] render tool outputType must be file", index)
			}
			if strings.HasPrefix(handler, "analyze_") && outputType != "text" {
				return fmt.Errorf("manifest.steps[%d] analysis tool outputType must be text", index)
			}
		}
		if outputType != "" && !containsAdminString(outputTypes, outputType) {
			return fmt.Errorf("manifest.steps[%d].outputType is not declared by the version", index)
		}
		handlerOutput := map[string]string{
			"text_to_image": "image", "image_to_image": "image",
			"text_to_video": "video", "image_to_video": "video", "start_end_to_video": "video", "reference_to_video": "video",
			"text_to_audio": "audio",
		}[handler]
		if typeName == "generate" && handlerOutput != "" && handlerOutput != outputType {
			return fmt.Errorf("manifest.steps[%d].handler does not match outputType", index)
		}
		role, roleIsString := step["outputRole"].(string)
		if _, exists := step["outputRole"]; exists && !roleIsString {
			return fmt.Errorf("manifest.steps[%d].outputRole must be a string", index)
		}
		role = strings.ToLower(strings.TrimSpace(role))
		if role != "" && role != "final" && role != "intermediate" && role != "draft" {
			return fmt.Errorf("manifest.steps[%d].outputRole is unsupported", index)
		}
		if rawRole, ok := step["outputRole"].(string); ok && rawRole != role {
			return fmt.Errorf("manifest.steps[%d].outputRole must use canonical lowercase form", index)
		}
		promotedByNext := false
		if index+1 < len(steps) {
			next, _ := steps[index+1].(map[string]any)
			promote, _ := next["promotePrevious"].(bool)
			promotedByNext = next["type"] == "approval" && promote
		}
		effectiveFinal := role == "final" || (role == "" && index == len(steps)-1) || promotedByNext
		if registerWork && !effectiveFinal {
			return fmt.Errorf("manifest.steps[%d].registerWork requires a final output", index)
		}
		if effectiveFinal && (typeName == "text" || typeName == "generate" || typeName == "tool") {
			finalOutputTypes[outputType] = true
		}
		if rawSchema, ok := step["schema"]; ok {
			encoded, err := json.Marshal(rawSchema)
			if err != nil || requireJSONObject(fmt.Sprintf("manifest.steps[%d].schema", index), encoded) != nil {
				return fmt.Errorf("manifest.steps[%d].schema must be an object", index)
			}
			if err := validateInputSchemaDefinition(encoded); err != nil {
				return fmt.Errorf("manifest.steps[%d].schema is invalid: %w", index, err)
			}
		}
	}
	if kind == model.SkillKindTool && !hasToolStep {
		return errors.New("tool skills must contain at least one registered tool step")
	}
	if kind == model.SkillKindAgent || kind == model.SkillKindTool {
		if len(finalOutputTypes) == 0 {
			return errors.New("multi-step skills must declare a final output or an approval-finalized draft")
		}
		primary := strings.ToLower(strings.TrimSpace(primaryOutputType))
		if !finalOutputTypes[primary] {
			return errors.New("final outputs must include primaryOutputType")
		}
	}
	return nil
}

func sameStringValues(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	counts := make(map[string]int, len(left))
	for _, value := range left {
		counts[value]++
	}
	for _, value := range right {
		counts[value]--
		if counts[value] < 0 {
			return false
		}
	}
	return true
}

var skillFileReferencePattern = regexp.MustCompile(`\{\{skill\.file:([^{}]+)\}\}`)
var unsupportedSkillReferencePattern = regexp.MustCompile(`\{\{skill\.[^{}]*\}\}`)

func validateSkillFileReferences(manifest, promptTemplate string, files []model.SkillFile, primary string) error {
	available := make(map[string]bool, len(files))
	contents := make(map[string]string, len(files))
	values := []string{manifest, promptTemplate}
	for i := range files {
		available[files[i].Path] = true
		contents[files[i].Path] = files[i].Content
		values = append(values, files[i].Content)
	}
	if !available[primary] {
		return errors.New("primary skill file is missing")
	}
	for _, value := range values {
		for _, match := range skillFileReferencePattern.FindAllStringSubmatch(value, -1) {
			if _, err := resolveImportedSkillReference(match[1], primary, available); err != nil {
				return fmt.Errorf("skill file reference %q is missing or invalid", match[1])
			}
		}
	}
	for label, value := range map[string]string{
		"manifest": manifest, "promptTemplate": promptTemplate, "primary skill file": contents[primary],
	} {
		if err := validateSkillExpansion(value, primary, contents, available); err != nil {
			return fmt.Errorf("%s: %w", label, err)
		}
	}
	return nil
}

func validateSkillExpansion(value, primary string, contents map[string]string, available map[string]bool) error {
	if len(value) > 1<<20 {
		return errors.New("expanded prompt exceeds 1 MiB")
	}
	result := value
	for depth := 0; depth < 8 && strings.Contains(result, "{{skill."); depth++ {
		changed := false
		if strings.Contains(result, "{{skill.primary}}") {
			result = strings.ReplaceAll(result, "{{skill.primary}}", contents[primary])
			changed = true
		}
		result = skillFileReferencePattern.ReplaceAllStringFunc(result, func(token string) string {
			match := skillFileReferencePattern.FindStringSubmatch(token)
			ref, err := resolveImportedSkillReference(match[1], primary, available)
			if err != nil {
				return token
			}
			changed = true
			return contents[ref]
		})
		if len(result) > 1<<20 {
			return errors.New("expanded prompt exceeds 1 MiB")
		}
		if !changed {
			break
		}
	}
	if strings.Contains(result, "{{skill.primary}}") || skillFileReferencePattern.MatchString(result) {
		return errors.New("skill file references contain a cycle")
	}
	if unsupportedSkillReferencePattern.MatchString(result) {
		return errors.New("skill prompt contains an unsupported {{skill.*}} reference")
	}
	return nil
}

func resolveImportedSkillReference(raw, primary string, available map[string]bool) (string, error) {
	ref, err := cleanSkillPath(raw)
	if err != nil {
		return "", err
	}
	if available[ref] {
		return ref, nil
	}
	base := path.Dir(primary)
	if base != "." {
		relative, err := cleanSkillPath(path.Join(base, ref))
		if err == nil && available[relative] {
			return relative, nil
		}
	}
	return "", errors.New("referenced file does not exist")
}
func defaultAdminObject(s string) string {
	s = strings.TrimSpace(s)
	if s == "" || !json.Valid([]byte(s)) {
		return "{}"
	}
	return s
}
