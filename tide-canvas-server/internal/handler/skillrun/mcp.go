package skillrun

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"tidecanvas/internal/app"
	"tidecanvas/internal/middleware"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/mcpconfig"
	"tidecanvas/internal/pkg/response"
	"tidecanvas/internal/pkg/skillformat"
)

var mcpRequestID = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$`)

// Serialize task admission with the admin exposure switch and publication.
// Earlier validation alone can go stale before the task/action is persisted.
func lockMCPSkillAccess(tx *gorm.DB, skillID, versionID idgen.ID) error {
	var current model.Skill
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Select("id", "status", "mcp_enabled", "current_version_id").First(&current, "id = ?", skillID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return invalid("技能 MCP 未开启或已下架")
	}
	if err != nil {
		return err
	}
	if current.Status != 1 || !current.MCPEnabled {
		return invalid("技能 MCP 未开启或已下架")
	}
	if versionID != 0 && current.CurrentVersionID != versionID {
		return invalid("技能版本已更新，请沿用原 clientRequestId 重新提交")
	}
	return nil
}

func (s *service) allowMCPContinuation(ctx context.Context, skillID idgen.ID) error {
	policy, err := mcpconfig.Read(ctx, s.db)
	if err != nil || !policy.Enabled {
		return invalid("MCP 接入暂不可用")
	}
	var count int64
	if err := s.db.WithContext(ctx).Model(&model.Skill{}).Where("id = ? AND status = 1 AND mcp_enabled = ?", skillID, true).Count(&count).Error; err != nil || count != 1 {
		return invalid("技能 MCP 未开启或已下架")
	}
	return nil
}

// The remote contract never includes SkillFile, Manifest, defaults, step
// inputs, model/system prompts or raw provider errors.
type mcpSkillVO struct {
	Enabled     bool            `json:"enabled"`
	ID          idgen.ID        `json:"id"`
	Title       string          `json:"title"`
	Description string          `json:"description"`
	InputSchema json.RawMessage `json:"inputSchema"`
	OutputTypes []string        `json:"outputTypes"`
	VersionID   idgen.ID        `json:"versionId"`
}

type mcpSkillUnavailable struct {
	code    int
	message string
}

func (e *mcpSkillUnavailable) Error() string { return e.message }

func (s *service) loadMCPSkill(ctx context.Context, id idgen.ID) (*model.Skill, *model.SkillVersion, error) {
	var skill model.Skill
	if err := s.db.WithContext(ctx).Where("id = ? AND status = 1 AND mcp_enabled = ?", id, true).First(&skill).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil, &mcpSkillUnavailable{404, "技能 MCP 未开启或已下架"}
		}
		return nil, nil, err
	}
	var version model.SkillVersion
	if err := s.db.WithContext(ctx).Where("id = ? AND skill_id = ? AND status = ?", skill.CurrentVersionID, skill.ID, model.SkillVersionPublished).First(&version).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil, &mcpSkillUnavailable{404, "技能没有可用的已发布版本"}
		}
		return nil, nil, err
	}
	if _, err := skillformat.ValidateVersion(ctx, s.db, &version); err != nil {
		var formatErr *skillformat.Error
		if errors.As(err, &formatErr) {
			return nil, nil, &mcpSkillUnavailable{400, "此技能未通过标准 Skill 格式校验，请管理员修正 SKILL.md 后重新发布"}
		}
		return nil, nil, err
	}
	return &skill, &version, nil
}

func writeMCPSkillAvailabilityError(c *gin.Context, err error) {
	var unavailable *mcpSkillUnavailable
	if errors.As(err, &unavailable) {
		response.Fail(c, unavailable.code, unavailable.message)
	} else {
		response.Fail(c, 500, "暂时无法读取技能配置")
	}
}

type mcpArtifactVO struct {
	Type    string `json:"type"`
	Title   string `json:"title,omitempty"`
	URL     string `json:"url,omitempty"`
	Text    string `json:"text,omitempty"`
	IsFinal bool   `json:"isFinal"`
}

type mcpPendingVO struct {
	Type    string          `json:"type"`
	Title   string          `json:"title,omitempty"`
	Message string          `json:"message,omitempty"`
	Schema  json.RawMessage `json:"schema,omitempty"`
}

type mcpRunVO struct {
	ID            idgen.ID        `json:"id"`
	SkillID       idgen.ID        `json:"skillId"`
	Status        string          `json:"status"`
	Progress      int             `json:"progress"`
	Revision      int64           `json:"revision"`
	PointCost     int64           `json:"pointCost"`
	PendingAction *mcpPendingVO   `json:"pendingAction,omitempty"`
	Artifacts     []mcpArtifactVO `json:"artifacts"`
	ErrorMessage  string          `json:"errorMessage,omitempty"`
	CreateTime    string          `json:"createTime"`
}

func (h *handler) registerMCPRoutes(api *gin.RouterGroup, deps *app.Deps) {
	g := api.Group("/open/v1/mcp/skills", middleware.UserAPIKeyAuth(deps.UserKeys), middleware.RateLimit(deps, 120, time.Minute))
	g.GET("/:skillId", h.mcpSkill)
	g.POST("/:skillId/runs", middleware.RateLimit(deps, 30, time.Minute), h.mcpCreate)
	g.GET("/:skillId/runs/:runId", h.mcpGet)
	g.POST("/:skillId/runs/:runId/actions", middleware.RateLimit(deps, 30, time.Minute), h.mcpAction)
}

func (h *handler) availableMCPSkill(c *gin.Context) (*model.Skill, *model.SkillVersion, bool) {
	id, err := idgen.Parse(c.Param("skillId"))
	if err != nil || id <= 0 {
		response.Fail(c, 404, "技能 MCP 不可用")
		return nil, nil, false
	}
	skill, version, err := h.svc.loadMCPSkill(c.Request.Context(), id)
	if err != nil {
		writeMCPSkillAvailabilityError(c, err)
		return nil, nil, false
	}
	return skill, version, true
}

func (h *handler) mcpPolicyEnabled(c *gin.Context) bool {
	policy, err := mcpconfig.Read(c.Request.Context(), h.svc.db)
	if err != nil {
		response.Fail(c, 503, "暂时无法读取 MCP 配置")
		return false
	}
	if !policy.Enabled {
		response.Fail(c, 403, "MCP 接入已被管理员停用")
		return false
	}
	return true
}

func (h *handler) mcpSkill(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	if !h.mcpPolicyEnabled(c) {
		return
	}
	id, err := idgen.Parse(c.Param("skillId"))
	if err != nil || id <= 0 {
		response.Fail(c, 404, "技能 MCP 不可用")
		return
	}
	skill, version, err := h.svc.loadMCPSkill(c.Request.Context(), id)
	if err != nil {
		var unavailable *mcpSkillUnavailable
		if errors.As(err, &unavailable) {
			// An owner can still reconnect to inspect/cancel an accepted run after
			// this Skill is disabled. Do not expose unpublished catalogue metadata.
			var accepted model.SkillRun
			lookup := h.svc.db.WithContext(c.Request.Context()).Select("id").Where("skill_id = ? AND user_id = ? AND entry_point = ?", id, middleware.CurrentUserID(c), "mcp").Limit(1).Find(&accepted)
			if lookup.Error != nil {
				response.Fail(c, 500, "暂时无法查询技能任务")
				return
			}
			if lookup.RowsAffected > 0 {
				response.OK(c, mcpSkillVO{ID: id, Enabled: false, Title: "已受理的技能任务", Description: "此技能已停止接收新任务，仅可查询或取消当前账号已受理的任务。", InputSchema: json.RawMessage(`{"type":"object"}`), OutputTypes: []string{}})
				return
			}
		}
		writeMCPSkillAvailabilityError(c, err)
		return
	}
	response.OK(c, mcpSkillVO{Enabled: true, ID: skill.ID, Title: skill.Title, Description: skill.Description,
		InputSchema: rawObject(version.InputSchema), OutputTypes: model.JSONStrings(version.OutputTypes, []string{}), VersionID: version.ID})
}

func decodeMCPBody(c *gin.Context, value any) bool {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2<<20)
	d := json.NewDecoder(c.Request.Body)
	d.DisallowUnknownFields()
	if d.Decode(value) != nil || d.Decode(new(any)) != io.EOF {
		response.Fail(c, 400, "请求格式不正确或包含不支持的字段")
		return false
	}
	return true
}

func (h *handler) mcpCreate(c *gin.Context) {
	if !h.mcpPolicyEnabled(c) {
		return
	}
	skill, _, ok := h.availableMCPSkill(c)
	if !ok {
		return
	}
	var dto struct {
		ClientRequestID string   `json:"clientRequestId"`
		Input           RunInput `json:"input"`
	}
	if !decodeMCPBody(c, &dto) {
		return
	}
	if !mcpRequestID.MatchString(dto.ClientRequestID) {
		response.Fail(c, 400, "clientRequestId 需要 1–80 位字母、数字、点、下划线、冒号或连字符")
		return
	}
	// Prefix isolates remote retries from IDs supplied to the native UI.
	run, existed, err := h.svc.createRun(c.Request.Context(), middleware.CurrentUserID(c), CreateDTO{
		SkillID: skill.ID.String(), EntryPoint: "mcp", MCP: true,
		ClientRequestID: "mcp:" + dto.ClientRequestID, Input: dto.Input,
	})
	if err != nil {
		writeMCPRunError(c, err)
		return
	}
	if !existed {
		h.svc.enqueue(run.ID)
	}
	h.writeMCPRun(c, run)
}

func writeMCPRunError(c *gin.Context, err error) {
	var validation validationError
	if errors.As(err, &validation) {
		response.Fail(c, 400, validation.Error())
		return
	}
	response.Fail(c, 500, "技能执行暂时失败，请沿用原 clientRequestId 重试")
}

func (h *handler) ownedMCPRun(c *gin.Context) (*model.SkillRun, bool) {
	skillID, e1 := idgen.Parse(c.Param("skillId"))
	runID, e2 := idgen.Parse(c.Param("runId"))
	var run model.SkillRun
	if e1 != nil || e2 != nil || skillID <= 0 || runID <= 0 {
		response.Fail(c, 404, "技能任务不存在")
		return nil, false
	}
	err := h.svc.db.WithContext(c.Request.Context()).Where("id = ? AND skill_id = ? AND user_id = ? AND entry_point = ?", runID, skillID, middleware.CurrentUserID(c), "mcp").First(&run).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			response.Fail(c, 404, "技能任务不存在")
		} else {
			response.Fail(c, 500, "暂时无法查询技能任务")
		}
		return nil, false
	}
	return &run, true
}

func (h *handler) mcpGet(c *gin.Context) {
	run, ok := h.ownedMCPRun(c)
	if ok {
		h.writeMCPRun(c, run)
	}
}

func (h *handler) mcpAction(c *gin.Context) {
	run, ok := h.ownedMCPRun(c)
	if !ok {
		return
	}
	var dto ActionDTO
	if !decodeMCPBody(c, &dto) {
		return
	}
	if !mcpRequestID.MatchString(dto.ClientRequestID) || dto.ExpectedRevision == nil || *dto.ExpectedRevision < 0 ||
		!contains([]string{"confirm", "revise", "submit_input", "retry", "cancel"}, dto.Action) || len(dto.Feedback) > 8192 || len(dto.Message) > 8192 {
		response.Fail(c, 400, "操作参数不正确，需要 action、expectedRevision 和 clientRequestId")
		return
	}
	if dto.Action != "cancel" {
		if !h.mcpPolicyEnabled(c) {
			return
		}
		if _, _, ok := h.availableMCPSkill(c); !ok {
			return
		}
	}
	if err := h.svc.applyAction(c.Request.Context(), run, dto); err != nil {
		writeMCPRunError(c, err)
		return
	}
	if h.svc.db.First(run, "id = ?", run.ID).Error != nil {
		response.Fail(c, 500, "暂时无法查询技能任务")
		return
	}
	h.writeMCPRun(c, run)
}

func (h *handler) writeMCPRun(c *gin.Context, run *model.SkillRun) {
	var rows []model.SkillRunArtifact
	tx, err := h.svc.mcpArtifactQuery(c.Request.Context(), run)
	if err != nil {
		response.Fail(c, 500, "暂时无法查询技能确认状态")
		return
	}
	if tx.Order("sort_order ASC, id ASC").Find(&rows).Error != nil {
		response.Fail(c, 500, "暂时无法查询技能结果")
		return
	}
	vo := mcpRunVO{ID: run.ID, SkillID: run.SkillID, Status: run.Status, Progress: run.Progress, Revision: run.StateRevision,
		PointCost: run.PointCost, CreateTime: formatTime(run.CreateTime), Artifacts: []mcpArtifactVO{}}
	for _, item := range rows {
		vo.Artifacts = append(vo.Artifacts, mcpArtifactVO{Type: item.Type, Title: artifactVO(&item).Title, URL: item.URL, Text: item.Text, IsFinal: item.IsFinal})
	}
	if run.Status == model.SkillRunWaitingConfirmation || run.Status == model.SkillRunWaitingInput {
		var pending mcpPendingVO
		if json.Unmarshal([]byte(run.PendingAction), &pending) == nil {
			vo.PendingAction = &pending
		}
	}
	if run.Status == model.SkillRunFailed {
		vo.ErrorMessage = publicMCPRunError(run.ErrorMessage)
	}
	c.Header("Cache-Control", "no-store")
	response.OK(c, vo)
}

// Approval does not make arbitrary preceding planning output public. A draft
// must be explicitly labelled draft, or the pinned manifest must declare that
// this approval promotes the immediately preceding result to final output.
func (s *service) mcpArtifactQuery(ctx context.Context, run *model.SkillRun) (*gorm.DB, error) {
	base := func() *gorm.DB { return s.db.WithContext(ctx).Where("run_id = ?", run.ID) }
	final := func() *gorm.DB { return base().Where("is_final = ?", true) }
	if run.Status != model.SkillRunWaitingConfirmation {
		return final(), nil
	}
	var waiting model.SkillRunStep
	if err := s.db.WithContext(ctx).Where("run_id = ? AND step_key = ? AND type = ? AND status = ?", run.ID, run.CurrentStep, "approval", model.SkillStepWaiting).Order("attempt DESC").First(&waiting).Error; err != nil {
		return nil, err
	}
	if waiting.Sequence <= 0 {
		return final(), nil
	}
	var prior model.SkillRunStep
	err := s.db.WithContext(ctx).Where("run_id = ? AND sequence_no = ? AND type IN ? AND status = ?", run.ID, waiting.Sequence-1, []string{"text", "generate", "tool"}, model.SkillStepSucceeded).Order("attempt DESC").First(&prior).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return final(), nil
	}
	if err != nil {
		return nil, err
	}
	var version model.SkillVersion
	if err := s.db.WithContext(ctx).Select("manifest_json").Where("id = ? AND skill_id = ?", run.SkillVersionID, run.SkillID).First(&version).Error; err != nil {
		return nil, err
	}
	var manifest agentManifest
	if err := json.Unmarshal([]byte(version.ManifestJSON), &manifest); err != nil {
		return nil, err
	}
	promotes := false
	if waiting.Sequence < len(manifest.Steps) {
		spec := manifest.Steps[waiting.Sequence]
		key := spec.Key
		if key == "" {
			key = fmt.Sprintf("step_%d", waiting.Sequence+1)
		}
		promotes = spec.Type == "approval" && key == run.CurrentStep && spec.PromotePrevious
	}
	if promotes {
		return base().Where("(is_final = ? OR step_id = ?)", true, prior.ID), nil
	}
	return base().Where("(is_final = ? OR (step_id = ? AND role = ?))", true, prior.ID, "draft"), nil
}

func mcpPublicGenerationInput(raw string) json.RawMessage {
	var input RunInput
	_ = json.Unmarshal([]byte(raw), &input)
	out := map[string]any{"prompt": input.Prompt}
	for _, key := range []string{"ratio", "resolution", "quality", "duration", "size", "batchCount", "count"} {
		if value, ok := input.Parameters[key]; ok {
			out[key] = value
		}
	}
	for _, asset := range input.Assets {
		if url := strings.TrimSpace(asset.URL); url != "" {
			key := map[string]string{"image": "imageUrls", "video": "videoUrls", "audio": "audioUrls", "file": "files"}[asset.Type]
			if key != "" {
				values, _ := out[key].([]string)
				out[key] = append(values, url)
			}
		}
	}
	encoded, _ := json.Marshal(out)
	return encoded
}
