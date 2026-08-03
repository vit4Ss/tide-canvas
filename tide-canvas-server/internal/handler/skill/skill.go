// Package skill serves the public 技能广场 read API (JWTAuth-gated):
//
//	GET  /api/skills            SkillQuery -> PageData<SkillVO>(仅上架,按 sortOrder)
//	GET  /api/skills/categories -> []string(当前模态下非空的分类)
//	POST /api/skills/:id/use    -> void(使用计数 +1,best-effort)
//
// 技能内容由后台 /api/admin/skills(admin/g2_skills.go)维护;两端共用
// model.Skill,VO 即模型 JSON 形状(无用户态字段,直接下发)。
package skill

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"tidecanvas/internal/app"
	"tidecanvas/internal/middleware"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/response"
)

type handler struct{ db *gorm.DB }

// PublicSkillVO intentionally omits executable prompt/manifest/file content.
// Legacy fields remain as empty/default values so older clients can render the
// card while all execution stays server-side and pinned to CurrentVersionID.
type PublicSkillVO struct {
	ID                idgen.ID        `json:"id"`
	Title             string          `json:"title"`
	Description       string          `json:"description"`
	UsageScenario     string          `json:"usageScenario"`
	HowTo             string          `json:"howTo"`
	OutputDescription string          `json:"outputDescription"`
	CoverURL          string          `json:"coverUrl"`
	Category          string          `json:"category"`
	OutputType        string          `json:"outputType"`
	Kind              string          `json:"kind"`
	CurrentVersionID  idgen.ID        `json:"currentVersionId"`
	EntryPoints       []string        `json:"entryPoints"`
	OutputTypes       []string        `json:"outputTypes"`
	InputSchema       json.RawMessage `json:"inputSchema"`
	PromptTemplate    string          `json:"promptTemplate"`
	ModelID           string          `json:"modelId"`
	DefaultParams     string          `json:"defaultParams"`
	AuthorName        string          `json:"authorName"`
	Status            int             `json:"status"`
	SortOrder         int             `json:"sortOrder"`
	UseCount          int64           `json:"useCount"`
	CreateTime        time.Time       `json:"createTime"`
	UpdateTime        time.Time       `json:"updateTime"`
}

// Register mounts the public skill routes.
func Register(api *gin.RouterGroup, d *app.Deps) {
	if err := ensureBaselineSkills(d.DB); err != nil {
		panic(fmt.Errorf("seed skills: %w", err))
	}
	if err := model.BackfillSkillVersions(d.DB); err != nil {
		panic(fmt.Errorf("backfill skill versions: %w", err))
	}
	h := &handler{db: d.DB}
	g := api.Group("/skills")
	g.Use(middleware.JWTAuth(d))
	g.GET("", h.list)
	g.GET("/categories", h.categories)
	g.GET("/:id", h.get)
	g.POST("/:id/use", h.recordUse)
}

func atoiDefault(s string, def int) int {
	n := 0
	for _, r := range s {
		if r < '0' || r > '9' {
			return def
		}
		n = n*10 + int(r-'0')
	}
	if s == "" {
		return def
	}
	return n
}

// list returns 上架技能,支持分类/输出类型/关键字过滤;排序 sortOrder 升序、新建在前。
func (h *handler) list(c *gin.Context) {
	keyword := strings.TrimSpace(c.Query("keyword"))
	category := strings.TrimSpace(c.Query("category"))
	outputType := strings.TrimSpace(c.Query("outputType"))
	kinds := splitSkillKinds(c.Query("kinds"), c.Query("kind"))
	entryPoint := strings.ToLower(strings.TrimSpace(c.Query("entryPoint")))
	targetType := strings.ToLower(strings.TrimSpace(c.Query("targetType")))
	pageNum := atoiDefault(c.Query("pageNum"), 1)
	pageSize := atoiDefault(c.Query("pageSize"), 24)
	if pageNum < 1 {
		pageNum = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 24
	}

	tx := h.db.Model(&model.Skill{}).Where("status = 1")
	if category != "" {
		tx = tx.Where("category = ?", category)
	}
	if outputType != "" {
		tx = applySkillOutputFilter(tx, outputType)
	}
	if len(kinds) > 0 {
		tx = tx.Where("kind IN ?", kinds)
	}
	tx = applySurfaceFilter(tx, entryPoint, targetType)
	if keyword != "" {
		like := "%" + keyword + "%"
		tx = tx.Where("title LIKE ? OR description LIKE ?", like, like)
	}

	var total int64
	if err := tx.Count(&total).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to list skills")
		return
	}
	var rows []model.Skill
	if entryPoint != "" {
		targets := []string{"*"}
		preferred := "*"
		if targetType != "" {
			targets = []string{"*", targetType}
			preferred = targetType
		}
		tx = tx.Order(clause.Expr{SQL: `COALESCE((SELECT sb.sort_order FROM skill_surface_binding sb
			WHERE sb.skill_id = skill.id AND sb.deleted IS NULL AND sb.surface = ? AND sb.enabled = ? AND sb.target_type IN ?
			ORDER BY CASE WHEN sb.target_type = ? THEN 0 ELSE 1 END, sb.sort_order ASC, sb.id ASC LIMIT 1), skill.sort_order) ASC`,
			Vars: []any{entryPoint, true, targets, preferred}, WithoutParentheses: true})
	}
	if err := tx.Order("skill.sort_order ASC, skill.id DESC").
		Offset((pageNum - 1) * pageSize).Limit(pageSize).Find(&rows).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to list skills")
		return
	}
	vos, err := h.publicVOs(rows, entryPoint, targetType)
	if err != nil {
		response.Fail(c, response.CodeServerError, "failed to load skill versions")
		return
	}
	response.Page(c, vos, total, pageNum, pageSize)
}

func (h *handler) get(c *gin.Context) {
	id, err := idgen.Parse(c.Param("id"))
	if err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid skill id")
		return
	}
	var row model.Skill
	if err := h.db.Where("id = ? AND status = 1", id).First(&row).Error; err != nil {
		response.Fail(c, response.CodeNotFound, "skill not found")
		return
	}
	vos, err := h.publicVOs([]model.Skill{row}, strings.ToLower(strings.TrimSpace(c.Query("entryPoint"))), strings.ToLower(strings.TrimSpace(c.Query("targetType"))))
	if err != nil || len(vos) == 0 {
		response.Fail(c, response.CodeServerError, "failed to load skill")
		return
	}
	response.OK(c, vos[0])
}

// categories returns 当前模态下确实有上架技能的分类。前端据此隐藏空页签——
// 图片入口下「短剧漫剧」「音乐MV」点进去永远是空的,不如不展示。
// 不吃 keyword:页签集合只随模态变,否则打字时页签会跟着跳。
func (h *handler) categories(c *gin.Context) {
	outputType := strings.TrimSpace(c.Query("outputType"))
	entryPoint := strings.ToLower(strings.TrimSpace(c.Query("entryPoint")))
	targetType := strings.ToLower(strings.TrimSpace(c.Query("targetType")))
	kinds := splitSkillKinds(c.Query("kinds"), c.Query("kind"))
	tx := h.db.Model(&model.Skill{}).Where("status = 1").Where("category <> ''")
	if outputType != "" {
		tx = applySkillOutputFilter(tx, outputType)
	}
	if len(kinds) > 0 {
		tx = tx.Where("kind IN ?", kinds)
	}
	tx = applySurfaceFilter(tx, entryPoint, targetType)
	var rows []string
	if err := tx.Distinct().Order("category ASC").Pluck("category", &rows).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to list skill categories")
		return
	}
	response.OK(c, rows)
}

func splitSkillKinds(values ...string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, value := range values {
		for _, item := range strings.Split(value, ",") {
			item = strings.ToLower(strings.TrimSpace(item))
			if model.ValidSkillKind(item) && !seen[item] {
				seen[item] = true
				out = append(out, item)
			}
		}
	}
	return out
}

func applySurfaceFilter(tx *gorm.DB, entryPoint, targetType string) *gorm.DB {
	if entryPoint == "" {
		return tx
	}
	versionMatch := "%\"" + entryPoint + "\"%"
	tx = tx.Where("EXISTS (SELECT 1 FROM skill_version sv WHERE sv.id = skill.current_version_id AND sv.deleted IS NULL AND sv.status = ? AND sv.entry_points LIKE ?)", model.SkillVersionPublished, versionMatch)
	legacyUnbound := "EXISTS (SELECT 1 FROM skill_version sv WHERE sv.id = skill.current_version_id AND sv.deleted IS NULL AND (sv.bindings_json IS NULL OR sv.bindings_json = '')) AND NOT EXISTS (SELECT 1 FROM skill_surface_binding sb WHERE sb.skill_id = skill.id AND sb.deleted IS NULL AND sb.surface = ?)"
	if targetType == "" {
		return tx.Where("("+legacyUnbound+") OR EXISTS (SELECT 1 FROM skill_surface_binding sb WHERE sb.skill_id = skill.id AND sb.deleted IS NULL AND sb.surface = ? AND sb.enabled = ? AND sb.target_type = '*')", entryPoint, entryPoint, true)
	}
	exactEnabled := "EXISTS (SELECT 1 FROM skill_surface_binding sb WHERE sb.skill_id = skill.id AND sb.deleted IS NULL AND sb.surface = ? AND sb.target_type = ? AND sb.enabled = ?)"
	exactExists := "EXISTS (SELECT 1 FROM skill_surface_binding sb WHERE sb.skill_id = skill.id AND sb.deleted IS NULL AND sb.surface = ? AND sb.target_type = ?)"
	wildcardEnabled := "EXISTS (SELECT 1 FROM skill_surface_binding sb WHERE sb.skill_id = skill.id AND sb.deleted IS NULL AND sb.surface = ? AND sb.target_type = '*' AND sb.enabled = ?)"
	return tx.Where("("+legacyUnbound+") OR "+exactEnabled+" OR (NOT "+exactExists+" AND "+wildcardEnabled+")",
		entryPoint, entryPoint, targetType, true, entryPoint, targetType, entryPoint, true)
}

func applySkillOutputFilter(tx *gorm.DB, outputType string) *gorm.DB {
	member := "%\"" + strings.ToLower(strings.TrimSpace(outputType)) + "\"%"
	return tx.Where("EXISTS (SELECT 1 FROM skill_version sv WHERE sv.id = skill.current_version_id AND sv.deleted IS NULL AND sv.status = ? AND sv.output_types LIKE ?) OR (skill.current_version_id = 0 AND skill.output_type = ?)", model.SkillVersionPublished, member, outputType)
}

func (h *handler) publicVOs(rows []model.Skill, entryPoint, targetType string) ([]PublicSkillVO, error) {
	ids := make([]idgen.ID, 0, len(rows))
	for i := range rows {
		if rows[i].CurrentVersionID != 0 {
			ids = append(ids, rows[i].CurrentVersionID)
		}
	}
	versions := []model.SkillVersion{}
	if len(ids) > 0 {
		if err := h.db.Where("id IN ? AND status = ?", ids, model.SkillVersionPublished).Find(&versions).Error; err != nil {
			return nil, err
		}
	}
	byID := make(map[idgen.ID]model.SkillVersion, len(versions))
	for i := range versions {
		byID[versions[i].ID] = versions[i]
	}
	bindings := map[idgen.ID]model.SkillSurfaceBinding{}
	hasSurfaceBinding := map[idgen.ID]bool{}
	if entryPoint != "" && len(rows) > 0 {
		skillIDs := make([]idgen.ID, 0, len(rows))
		for i := range rows {
			skillIDs = append(skillIDs, rows[i].ID)
		}
		var bindingRows []model.SkillSurfaceBinding
		if err := h.db.Where("skill_id IN ? AND surface = ?", skillIDs, entryPoint).
			Order("sort_order ASC, id ASC").Find(&bindingRows).Error; err != nil {
			return nil, err
		}
		for i := range bindingRows {
			hasSurfaceBinding[bindingRows[i].SkillID] = true
			if bindingRows[i].TargetType != "*" && (targetType == "" || bindingRows[i].TargetType != targetType) {
				continue
			}
			current, exists := bindings[bindingRows[i].SkillID]
			exact := targetType != "" && bindingRows[i].TargetType == targetType
			currentExact := targetType != "" && current.TargetType == targetType
			if !exists || (exact && !currentExact) {
				bindings[bindingRows[i].SkillID] = bindingRows[i]
			}
		}
	}
	result := make([]PublicSkillVO, 0, len(rows))
	for i := range rows {
		row := rows[i]
		version, ok := byID[row.CurrentVersionID]
		entryPoints := []string{"chat", "studio", "canvas"}
		outputTypes := []string{row.OutputType}
		inputSchema := json.RawMessage(`{"type":"object"}`)
		kind := row.Kind
		outputType := row.OutputType
		modelID := row.ModelID
		defaultParams := row.DefaultParams
		if strings.TrimSpace(defaultParams) == "" {
			defaultParams = "{}"
		}
		if ok {
			kind = version.Kind
			outputType = version.PrimaryOutputType
			entryPoints = model.JSONStrings(version.EntryPoints, entryPoints)
			outputTypes = model.JSONStrings(version.OutputTypes, outputTypes)
			if json.Valid([]byte(version.InputSchema)) {
				inputSchema = publicInputSchema(version.InputSchema)
			}
			modelID = version.ModelID
			defaultParams = version.DefaultParams
			if strings.TrimSpace(defaultParams) == "" {
				defaultParams = "{}"
			}
		}
		if kind == "workflow" { // defensive read compatibility before startup normalization completes
			kind = model.SkillKindAgent
		}
		if !model.ValidSkillKind(kind) {
			continue
		}
		entryPoints = publicSkillEntryPoints(kind, entryPoints)
		sortOrder := row.SortOrder
		if entryPoint != "" {
			if ok && strings.TrimSpace(version.BindingsJSON) != "" {
				var snapshots []publicSkillBinding
				if json.Unmarshal([]byte(version.BindingsJSON), &snapshots) != nil {
					return nil, errors.New("skill placement configuration is invalid")
				}
				binding := choosePublicSkillBinding(snapshots, entryPoint, targetType)
				if binding == nil || !binding.Enabled {
					continue
				}
				sortOrder = binding.SortOrder
				defaultParams = mergeDefaultParams(defaultParams, string(binding.Defaults))
			} else if binding, exists := bindings[row.ID]; exists {
				if !binding.Enabled {
					continue
				}
				sortOrder = binding.SortOrder
				defaultParams = mergeDefaultParams(defaultParams, binding.Defaults)
			} else if hasSurfaceBinding[row.ID] {
				continue
			}
		}
		result = append(result, PublicSkillVO{
			ID: row.ID, Title: row.Title, Description: row.Description,
			UsageScenario: row.UsageScenario, HowTo: row.HowTo, OutputDescription: row.OutputDescription,
			CoverURL: row.CoverURL,
			Category: row.Category, OutputType: outputType, Kind: kind,
			CurrentVersionID: row.CurrentVersionID, EntryPoints: entryPoints, OutputTypes: outputTypes,
			InputSchema: inputSchema, PromptTemplate: "", ModelID: modelID, DefaultParams: defaultParams,
			AuthorName: row.AuthorName, Status: row.Status, SortOrder: sortOrder, UseCount: row.UseCount,
			CreateTime: row.CreateTime, UpdateTime: row.UpdateTime,
		})
	}
	return result, nil
}

func publicSkillEntryPoints(kind string, values []string) []string {
	if kind == model.SkillKindAgent {
		return []string{"canvas"}
	}
	allowed := map[string]bool{"chat": true, "studio": true, "canvas": true}
	out := make([]string, 0, len(values))
	seen := map[string]bool{}
	for _, value := range values {
		value = strings.ToLower(strings.TrimSpace(value))
		if allowed[value] && !seen[value] {
			seen[value] = true
			out = append(out, value)
		}
	}
	return out
}

type publicSkillBinding struct {
	Surface    string          `json:"surface"`
	TargetType string          `json:"targetType"`
	Enabled    bool            `json:"enabled"`
	SortOrder  int             `json:"sortOrder"`
	Defaults   json.RawMessage `json:"defaults"`
}

func choosePublicSkillBinding(bindings []publicSkillBinding, surface, targetType string) *publicSkillBinding {
	var exact, wildcard *publicSkillBinding
	for i := range bindings {
		binding := &bindings[i]
		if binding.Surface != surface {
			continue
		}
		if targetType != "" && binding.TargetType == targetType && exact == nil {
			exact = binding
		}
		if binding.TargetType == "*" && wildcard == nil {
			wildcard = binding
		}
	}
	if exact != nil {
		return exact
	}
	return wildcard
}

func mergeDefaultParams(base, overlay string) string {
	merged := map[string]any{}
	for _, raw := range []string{base, overlay} {
		var values map[string]any
		if json.Unmarshal([]byte(raw), &values) != nil {
			continue
		}
		for key, value := range values {
			merged[key] = value
		}
	}
	encoded, _ := json.Marshal(merged)
	return string(encoded)
}

func publicInputSchema(raw string) json.RawMessage {
	var schema map[string]any
	if json.Unmarshal([]byte(raw), &schema) != nil {
		return json.RawMessage(`{"type":"object"}`)
	}
	if properties, ok := schema["properties"].(map[string]any); ok {
		delete(properties, "prompt")
		delete(properties, "assets")
		delete(properties, "sourceNodeIds")
	}
	if required, ok := schema["required"].([]any); ok {
		filtered := make([]any, 0, len(required))
		for _, item := range required {
			name, _ := item.(string)
			if name != "prompt" && name != "assets" && name != "sourceNodeIds" {
				filtered = append(filtered, item)
			}
		}
		schema["required"] = filtered
	}
	encoded, _ := json.Marshal(schema)
	return encoded
}

// recordUse bumps the skill use counter (best-effort;不存在也返回成功,
// 计数丢失不值得打断生成链路)。
func (h *handler) recordUse(c *gin.Context) {
	if _, err := idgen.Parse(c.Param("id")); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid skill id")
		return
	}
	// Compatibility no-op: usage is incremented atomically by accepted direct
	// generations and SkillRun creation, never by a client fire-and-forget call.
	response.OK[any](c, nil)
}
