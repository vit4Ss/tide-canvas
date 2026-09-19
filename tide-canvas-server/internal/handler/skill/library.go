package skill

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"errors"
	"math"
	"mime"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"tidecanvas/internal/app"
	"tidecanvas/internal/middleware"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/mcpconfig"
	"tidecanvas/internal/pkg/response"
	"tidecanvas/internal/pkg/skillformat"
)

type libraryHandler struct{ db *gorm.DB }

// Public marketing metadata only. Never serialize model.Skill/SkillVersion or
// original package files into the install catalogue.
type librarySkillVO struct {
	ID                   idgen.ID        `json:"id"`
	Title                string          `json:"title"`
	Description          string          `json:"description"`
	UsageScenario        string          `json:"usageScenario"`
	HowTo                string          `json:"howTo"`
	OutputDescription    string          `json:"outputDescription"`
	InputDescription     string          `json:"inputDescription,omitempty"`
	InputExample         string          `json:"inputExample,omitempty"`
	OutputExample        string          `json:"outputExample,omitempty"`
	CoverURL             string          `json:"coverUrl"`
	Category             string          `json:"category"`
	AuthorName           string          `json:"authorName"`
	Kind                 string          `json:"kind"`
	OutputTypes          []string        `json:"outputTypes"`
	UseCount             int64           `json:"useCount"`
	Version              int             `json:"version"`
	UpdateTime           string          `json:"updateTime"`
	MCPEnabled           bool            `json:"mcpEnabled"`
	Installable          bool            `json:"installable"`
	UnavailableReason    string          `json:"unavailableReason,omitempty"`
	MCPAvailable         bool            `json:"mcpAvailable"`
	MCPUnavailableReason string          `json:"mcpUnavailableReason,omitempty"`
	MCPEndpoint          string          `json:"mcpEndpoint,omitempty"`
	InstallPath          string          `json:"installPath,omitempty"`
	DownloadPath         string          `json:"downloadPath,omitempty"`
	SkillName            string          `json:"skillName"`
	NativePath           string          `json:"nativePath,omitempty"`
	InputSchema          json.RawMessage `json:"inputSchema,omitempty"`
}

func registerSkillLibrary(api *gin.RouterGroup, d *app.Deps) {
	h := &libraryHandler{db: d.DB}
	g := api.Group("/skill-library", middleware.RateLimit(d, 120, time.Minute))
	h.routes(g)
}

func (h *libraryHandler) routes(g *gin.RouterGroup) {
	g.Use(func(c *gin.Context) {
		c.Header("Cache-Control", "no-store")
		c.Header("X-Content-Type-Options", "nosniff")
		c.Next()
	})
	g.GET("", h.list)
	g.GET("/:id", h.detail)
	g.GET("/:id/SKILL.md", h.document)
	g.GET("/:id/download", h.download)
}

func (h *libraryHandler) published(c *gin.Context) *gorm.DB {
	return h.db.WithContext(c.Request.Context()).Model(&model.Skill{}).
		Where("skill.status = 1 AND skill.mcp_enabled = ?", true).
		Where("EXISTS (SELECT 1 FROM skill_version sv WHERE sv.id = skill.current_version_id AND sv.skill_id = skill.id AND sv.status = ? AND sv.deleted IS NULL)", model.SkillVersionPublished)
}

const libraryColumns = "skill.id, skill.title, skill.description, skill.usage_scenario, skill.how_to, skill.output_description, skill.cover_url, skill.category, skill.author_name, skill.kind, skill.output_type, skill.use_count, skill.current_version_id, skill.mcp_enabled, skill.update_time"
const libraryDetailColumns = libraryColumns + ", skill.input_description, skill.input_example, skill.output_example"

func (h *libraryHandler) list(c *gin.Context) {
	page, err := strconv.Atoi(c.DefaultQuery("pageNum", "1"))
	if err != nil || page < 1 || page > 100000 {
		page = 1
	}
	size, err := strconv.Atoi(c.DefaultQuery("pageSize", "12"))
	if err != nil || size < 1 || size > 24 {
		size = 12
	}
	var categories []string
	if err := h.published(c).Where("category <> ''").Distinct().Order("category ASC").Pluck("category", &categories).Error; err != nil {
		response.Fail(c, 500, "failed to load skill categories")
		return
	}
	if categories == nil {
		categories = []string{}
	}
	tx := h.published(c)
	if category := strings.TrimSpace(c.Query("category")); category != "" {
		tx = tx.Where("category = ?", category)
	}
	if keyword := strings.TrimSpace(c.Query("keyword")); keyword != "" {
		if len([]rune(keyword)) > 100 {
			response.Fail(c, 400, "搜索内容请控制在 100 个字符以内")
			return
		}
		like := "%" + keyword + "%"
		tx = tx.Where("title LIKE ? OR description LIKE ?", like, like)
	}
	var total int64
	if err := tx.Count(&total).Error; err != nil {
		response.Fail(c, 500, "failed to count skills")
		return
	}
	var rows []model.Skill
	if err := tx.Select(libraryColumns).Order("sort_order ASC, skill.id DESC").Offset((page - 1) * size).Limit(size).Find(&rows).Error; err != nil {
		response.Fail(c, 500, "failed to load skills")
		return
	}
	policy, policyErr := mcpconfig.Read(c.Request.Context(), h.db)
	ids := make([]idgen.ID, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.CurrentVersionID)
	}
	var versions []model.SkillVersion
	if len(ids) > 0 {
		if err := h.db.WithContext(c.Request.Context()).Select("id", "skill_id", "kind", "version_no", "primary_file_path", "output_types", "entry_points", "bindings_json").Where("id IN ?", ids).Find(&versions).Error; err != nil {
			response.Fail(c, 500, "failed to load skill versions")
			return
		}
	}
	byID := make(map[idgen.ID]model.SkillVersion, len(versions))
	for _, v := range versions {
		byID[v.ID] = v
	}
	items := make([]librarySkillVO, 0, len(rows))
	for _, row := range rows {
		v := byID[row.CurrentVersionID]
		items = append(items, h.view(c, row, v, policy, policyErr))
	}
	c.Header("Cache-Control", "no-store")
	response.OK(c, struct {
		response.PageData[librarySkillVO]
		Categories []string `json:"categories"`
	}{response.PageData[librarySkillVO]{Records: items, Total: total, PageNum: page, PageSize: size, Pages: int(math.Ceil(float64(total) / float64(size)))}, categories})
}

func (h *libraryHandler) view(c *gin.Context, row model.Skill, version model.SkillVersion, policy mcpconfig.Snapshot, policyErr error) librarySkillVO {
	vo := librarySkillVO{ID: row.ID, Title: row.Title, Description: row.Description, UsageScenario: row.UsageScenario,
		HowTo: row.HowTo, OutputDescription: row.OutputDescription, CoverURL: row.CoverURL, Category: row.Category, AuthorName: row.AuthorName,
		InputDescription: row.InputDescription, InputExample: row.InputExample, OutputExample: row.OutputExample,
		Kind: row.Kind, OutputTypes: model.JSONStrings(version.OutputTypes, []string{row.OutputType}), UseCount: row.UseCount,
		Version: version.Version, UpdateTime: row.UpdateTime.Format(time.RFC3339), MCPEnabled: row.MCPEnabled, SkillName: libraryInstallName(row.Title, "")}
	vo.NativePath = libraryNativePath(version)
	if !row.MCPEnabled {
		vo.UnavailableReason = "该技能尚未对外开放"
		return vo
	}
	meta, err := skillformat.ValidateVersion(c.Request.Context(), h.db, &version)
	if err != nil {
		vo.UnavailableReason = "该技能的安装包正在维护，请稍后重试"
		return vo
	}
	vo.SkillName = libraryInstallName(row.Title, meta.Name)
	// Installing public instructions does not execute a task or require a key.
	// Keep the package available while MCP is stopped or awaiting configuration.
	vo.Installable = true
	vo.InstallPath = "/api/skill-library/" + row.ID.String() + "/SKILL.md"
	vo.DownloadPath = "/api/skill-library/" + row.ID.String() + "/download"
	if policyErr == nil && strings.TrimSpace(policy.PublicURL) != "" {
		vo.MCPEndpoint = strings.TrimRight(policy.PublicURL, "/") + "/skills/" + row.ID.String()
	}
	switch {
	case policyErr != nil:
		vo.MCPUnavailableReason = "可先安装 Skill；调用配置暂时无法读取，请稍后连接 MCP"
	case !policy.Enabled:
		vo.MCPUnavailableReason = "可先安装 Skill；MCP 调用暂时关闭，恢复后即可连接使用"
	case vo.MCPEndpoint == "":
		vo.MCPUnavailableReason = "可先安装 Skill；MCP 接入地址尚未配置，智能体会在使用前重新读取"
	default:
		vo.MCPAvailable = true
	}
	return vo
}

func libraryNativePath(version model.SkillVersion) string {
	var bindings []publicSkillBinding
	hasSnapshot := strings.TrimSpace(version.BindingsJSON) != ""
	if hasSnapshot && json.Unmarshal([]byte(version.BindingsJSON), &bindings) != nil {
		return ""
	}
	for _, entry := range publicSkillEntryPoints(version.Kind, model.JSONStrings(version.EntryPoints, nil)) {
		route := map[string]string{"studio": "/studio", "canvas": "/projects", "chat": "/chat"}[entry]
		if route == "" {
			continue
		}
		if !hasSnapshot {
			return route
		}
		for _, binding := range bindings {
			if binding.Surface == entry && binding.Enabled {
				return route
			}
		}
	}
	return ""
}

func (h *libraryHandler) get(c *gin.Context) (*librarySkillVO, bool) {
	id, err := idgen.Parse(c.Param("id"))
	if err != nil || id == 0 {
		response.Fail(c, 404, "技能不存在或已下架")
		return nil, false
	}
	var row model.Skill
	if err := h.published(c).Select(libraryDetailColumns).Where("skill.id = ?", id).First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			response.Fail(c, 404, "技能不存在或已下架")
		} else {
			response.Fail(c, 500, "failed to load public skill")
		}
		return nil, false
	}
	var version model.SkillVersion
	if err := h.db.WithContext(c.Request.Context()).Select("id", "skill_id", "kind", "version_no", "primary_file_path", "output_types", "input_schema", "entry_points", "bindings_json").Where("id = ? AND skill_id = ?", row.CurrentVersionID, row.ID).First(&version).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			response.Fail(c, 404, "技能版本暂不可用")
		} else {
			response.Fail(c, 500, "failed to load public skill version")
		}
		return nil, false
	}
	policy, policyErr := mcpconfig.Read(c.Request.Context(), h.db)
	vo := h.view(c, row, version, policy, policyErr)
	if json.Valid([]byte(version.InputSchema)) {
		vo.InputSchema = json.RawMessage(version.InputSchema)
	}
	return &vo, true
}

func (h *libraryHandler) detail(c *gin.Context) {
	vo, ok := h.get(c)
	if !ok {
		return
	}
	c.Header("Cache-Control", "no-store")
	response.OK(c, vo)
}

func (h *libraryHandler) installDocument(c *gin.Context) (*librarySkillVO, []byte, bool) {
	vo, ok := h.get(c)
	if !ok {
		return nil, nil, false
	}
	if !vo.Installable {
		response.Fail(c, 409, vo.UnavailableReason)
		return nil, nil, false
	}
	content := publicWrapperDocument(*vo)
	if _, err := skillformat.ValidateFiles([]skillformat.File{{Path: vo.SkillName + "/SKILL.md", Content: content}}, vo.SkillName+"/SKILL.md", ""); err != nil {
		response.Fail(c, 500, "failed to build public Skill wrapper")
		return nil, nil, false
	}
	c.Header("Cache-Control", "no-store")
	c.Header("X-Content-Type-Options", "nosniff")
	return vo, []byte(content), true
}

func (h *libraryHandler) document(c *gin.Context) {
	_, content, ok := h.installDocument(c)
	if !ok {
		return
	}
	c.Header("Content-Disposition", `inline; filename="SKILL.md"`)
	c.Data(http.StatusOK, "text/plain; charset=utf-8", content)
}

func (h *libraryHandler) download(c *gin.Context) {
	vo, content, ok := h.installDocument(c)
	if !ok {
		return
	}
	var buffer bytes.Buffer
	w := zip.NewWriter(&buffer)
	entry, err := w.Create(vo.SkillName + "/SKILL.md")
	if err != nil {
		response.Fail(c, 500, "failed to create Skill package")
		return
	}
	if _, err = entry.Write(content); err != nil {
		_ = w.Close()
		response.Fail(c, 500, "failed to write Skill package")
		return
	}
	if err = w.Close(); err != nil {
		response.Fail(c, 500, "failed to finalize Skill package")
		return
	}
	c.Header("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": vo.SkillName + ".zip"}))
	c.Data(http.StatusOK, "application/zip", buffer.Bytes())
}
