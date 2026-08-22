package skillrun

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"reflect"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"tidecanvas/internal/app"
	"tidecanvas/internal/handler/ai"
	"tidecanvas/internal/middleware"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/logger"
	"tidecanvas/internal/pkg/response"
)

type service struct {
	db       *gorm.DB
	ai       *ai.GenerationFacade
	deps     *app.Deps
	workerID string
	running  sync.Map
}

type handler struct{ svc *service }

type validationError struct{ message string }

func (e validationError) Error() string { return e.message }
func invalid(message string) error      { return validationError{message: message} }
func invalidf(format string, args ...any) error {
	return validationError{message: fmt.Sprintf(format, args...)}
}

type AssetInput struct {
	ID       string         `json:"id"`
	Type     string         `json:"type"`
	URL      string         `json:"url"`
	Content  string         `json:"content"`
	Role     string         `json:"role"`
	Name     string         `json:"name"`
	NodeType string         `json:"nodeType"`
	NodeID   string         `json:"nodeId"`
	Metadata map[string]any `json:"metadata"`
}

// RunMessage is recent conversational context supplied by an assistant surface.
// It is execution metadata, not a user-configurable Skill input field: schema
// validation therefore continues to apply only to prompt/assets/parameters.
type RunMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type RunInput struct {
	Prompt        string         `json:"prompt"`
	Messages      []RunMessage   `json:"messages,omitempty"`
	Assets        []AssetInput   `json:"assets"`
	SourceNodeIDs []string       `json:"sourceNodeIds"`
	Parameters    map[string]any `json:"parameters"`
}

type CreateDTO struct {
	SkillID         string   `json:"skillId" binding:"required"`
	EntryPoint      string   `json:"entryPoint" binding:"required,oneof=chat studio canvas asset api"`
	TargetType      string   `json:"targetType" binding:"omitempty,max=32"`
	ProjectID       string   `json:"projectId"`
	ConversationID  string   `json:"conversationId"`
	ClientRequestID string   `json:"clientRequestId" binding:"required,max=96"`
	Input           RunInput `json:"input"`
}

type ActionDTO struct {
	Action           string         `json:"action" binding:"required,oneof=confirm revise submit_input retry cancel"`
	ExpectedRevision *int64         `json:"expectedRevision" binding:"required"`
	Input            map[string]any `json:"input"`
	Feedback         string         `json:"feedback" binding:"omitempty,max=8192"`
	Message          string         `json:"message" binding:"omitempty,max=8192"`
	ClientRequestID  string         `json:"clientRequestId" binding:"required,max=96"`
}

type ArtifactVO struct {
	ID                idgen.ID        `json:"id"`
	RunID             idgen.ID        `json:"runId"`
	StepID            idgen.ID        `json:"stepId"`
	Type              string          `json:"type"`
	Role              string          `json:"role"`
	Title             string          `json:"title,omitempty"`
	URL               string          `json:"url,omitempty"`
	Text              string          `json:"text,omitempty"`
	Content           string          `json:"content,omitempty"`
	TaskID            idgen.ID        `json:"taskId,omitempty"`
	FileID            idgen.ID        `json:"fileId,omitempty"`
	IsFinal           bool            `json:"isFinal"`
	PreferredNodeType string          `json:"preferredNodeType,omitempty"`
	Metadata          json.RawMessage `json:"metadata,omitempty"`
	CreateTime        string          `json:"createTime"`
}

type StepVO struct {
	ID           idgen.ID     `json:"id"`
	Key          string       `json:"key"`
	Title        string       `json:"title"`
	Status       string       `json:"status"`
	Progress     int          `json:"progress"`
	ErrorMessage string       `json:"errorMessage,omitempty"`
	Artifacts    []ArtifactVO `json:"artifacts"`
	CreateTime   string       `json:"createTime"`
	UpdateTime   string       `json:"updateTime"`
}

type RunVO struct {
	ID               idgen.ID        `json:"id"`
	SkillID          idgen.ID        `json:"skillId"`
	SkillVersionID   idgen.ID        `json:"skillVersionId"`
	SkillTitle       string          `json:"skillTitle"`
	SkillKind        string          `json:"skillKind"`
	UserID           idgen.ID        `json:"userId"`
	EntryPoint       string          `json:"entryPoint"`
	TargetType       string          `json:"targetType,omitempty"`
	ProjectID        *idgen.ID       `json:"projectId,omitempty"`
	ConversationID   *idgen.ID       `json:"conversationId,omitempty"`
	ClientRequestID  *string         `json:"clientRequestId,omitempty"`
	Status           string          `json:"status"`
	CurrentStep      string          `json:"currentStep,omitempty"`
	CurrentStepTitle string          `json:"currentStepTitle,omitempty"`
	Progress         int             `json:"progress"`
	Input            json.RawMessage `json:"input,omitempty"`
	PendingAction    json.RawMessage `json:"pendingAction,omitempty"`
	Steps            []StepVO        `json:"steps"`
	Artifacts        []ArtifactVO    `json:"artifacts"`
	ErrorMessage     string          `json:"errorMessage,omitempty"`
	ErrorMsg         string          `json:"errorMsg,omitempty"`
	PointCost        int64           `json:"pointCost"`
	Revision         int64           `json:"revision"`
	CreateTime       string          `json:"createTime"`
	UpdateTime       string          `json:"updateTime"`
	CompleteTime     string          `json:"completeTime,omitempty"`
}

func Register(apiGroup *gin.RouterGroup, deps *app.Deps) {
	svc := &service{db: deps.DB, ai: ai.NewGenerationFacade(deps), deps: deps, workerID: idgen.Next().String()}
	h := &handler{svc: svc}
	g := apiGroup.Group("/skill-runs")
	g.Use(middleware.JWTAuth(deps))
	g.POST("", h.create)
	g.GET("", h.list)
	g.GET("/:id", h.get)
	g.GET("/:id/artifacts", h.artifacts)
	g.POST("/:id/actions", h.action)

	// Durable queued/running work survives process restarts. The AI startup sweep
	// runs before route registration, so orphaned child tasks resolve as failure.
	var resume []model.SkillRun
	if err := deps.DB.Where("status = ? OR (status = ? AND (lease_expires_at IS NULL OR lease_expires_at < ?))", model.SkillRunQueued, model.SkillRunRunning, time.Now()).Find(&resume).Error; err == nil {
		for i := range resume {
			svc.enqueue(resume[i].ID)
		}
	}
	go svc.recoveryLoop()
}

func (h *handler) create(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2<<20)
	var dto CreateDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid skill run: "+err.Error())
		return
	}
	userID := middleware.CurrentUserID(c)
	run, existed, err := h.svc.createRun(c.Request.Context(), userID, dto)
	if err != nil {
		var validation validationError
		if errors.As(err, &validation) {
			response.Fail(c, response.CodeBadRequest, validation.Error())
		} else {
			logger.L().Error("skill run create failed", zap.Error(err), zap.String("userId", userID.String()))
			response.Fail(c, response.CodeServerError, "failed to create skill run")
		}
		return
	}
	if !existed {
		h.svc.enqueue(run.ID)
	}
	vo, err := h.svc.toVO(run)
	if err != nil {
		response.Fail(c, response.CodeServerError, "failed to load skill run")
		return
	}
	response.OK(c, vo)
}

func (h *handler) get(c *gin.Context) {
	run, ok := h.ownedRun(c)
	if !ok {
		return
	}
	vo, err := h.svc.toVO(run)
	if err != nil {
		response.Fail(c, response.CodeServerError, "failed to load skill run")
		return
	}
	response.OK(c, vo)
}

func (h *handler) list(c *gin.Context) {
	userID := middleware.CurrentUserID(c)
	page := parsePositive(c.Query("pageNum"), 1)
	size := parsePositive(c.Query("pageSize"), 20)
	if size > 100 {
		size = 100
	}
	tx := h.svc.db.Model(&model.SkillRun{}).Where("user_id = ?", userID)
	for query, column := range map[string]string{
		"skillId": "skill_id", "projectId": "project_id", "conversationId": "conversation_id",
	} {
		if raw := strings.TrimSpace(c.Query(query)); raw != "" {
			id, err := idgen.Parse(raw)
			if err != nil {
				response.Fail(c, response.CodeBadRequest, "invalid "+query)
				return
			}
			tx = tx.Where(column+" = ?", id)
		}
	}
	if value := strings.TrimSpace(c.Query("entryPoint")); value != "" {
		tx = tx.Where("entry_point = ?", value)
	}
	if raw := strings.TrimSpace(c.Query("clientRequestIds")); raw != "" {
		requestIDs, err := parseClientRequestIDs(raw)
		if err != nil {
			response.Fail(c, response.CodeBadRequest, "invalid clientRequestIds")
			return
		}
		tx = tx.Where("client_request_id IN ?", requestIDs)
	}
	if value := strings.TrimSpace(c.Query("status")); value != "" {
		tx = tx.Where("status = ?", value)
	}
	if strings.EqualFold(c.Query("active"), "true") || c.Query("active") == "1" {
		tx = tx.Where("status IN ?", []string{model.SkillRunQueued, model.SkillRunRunning, model.SkillRunWaitingInput, model.SkillRunWaitingConfirmation})
	}
	var total int64
	if err := tx.Count(&total).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to list skill runs")
		return
	}
	var rows []model.SkillRun
	if err := tx.Order("create_time DESC, id DESC").Offset((page - 1) * size).Limit(size).Find(&rows).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to list skill runs")
		return
	}
	vos := make([]RunVO, 0, len(rows))
	for i := range rows {
		vo, err := h.svc.toVO(&rows[i])
		if err != nil {
			response.Fail(c, response.CodeServerError, "failed to load skill runs")
			return
		}
		vos = append(vos, vo)
	}
	response.Page(c, vos, total, page, size)
}

func (h *handler) artifacts(c *gin.Context) {
	run, ok := h.ownedRun(c)
	if !ok {
		return
	}
	var rows []model.SkillRunArtifact
	if err := h.svc.db.Where("run_id = ?", run.ID).Order("sort_order ASC, create_time ASC").Find(&rows).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to list artifacts")
		return
	}
	out := make([]ArtifactVO, 0, len(rows))
	for i := range rows {
		out = append(out, artifactVO(&rows[i]))
	}
	response.OK(c, out)
}

func (h *handler) action(c *gin.Context) {
	run, ok := h.ownedRun(c)
	if !ok {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2<<20)
	var dto ActionDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid action: "+err.Error())
		return
	}
	if err := h.svc.applyAction(c.Request.Context(), run, dto); err != nil {
		var validation validationError
		if errors.As(err, &validation) {
			response.Fail(c, response.CodeBadRequest, validation.Error())
		} else {
			logger.L().Error("skill run action failed", zap.Error(err), zap.String("runId", run.ID.String()))
			response.Fail(c, response.CodeServerError, "failed to apply skill run action")
		}
		return
	}
	if err := h.svc.db.First(run, "id = ?", run.ID).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to reload skill run")
		return
	}
	vo, err := h.svc.toVO(run)
	if err != nil {
		response.Fail(c, response.CodeServerError, "failed to load skill run")
		return
	}
	response.OK(c, vo)
}

func (h *handler) ownedRun(c *gin.Context) (*model.SkillRun, bool) {
	id, err := idgen.Parse(c.Param("id"))
	if err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid skill run id")
		return nil, false
	}
	var run model.SkillRun
	if err := h.svc.db.Where("id = ? AND user_id = ?", id, middleware.CurrentUserID(c)).First(&run).Error; err != nil {
		response.Fail(c, response.CodeNotFound, "skill run not found")
		return nil, false
	}
	return &run, true
}

func (s *service) createRun(ctx context.Context, userID idgen.ID, dto CreateDTO) (*model.SkillRun, bool, error) {
	clientID := strings.TrimSpace(dto.ClientRequestID)
	if clientID == "" {
		return nil, false, invalid("clientRequestId is required")
	}
	if len(clientID) > 96 {
		return nil, false, invalid("clientRequestId is too long")
	}
	requestHash, err := requestFingerprint(struct {
		SkillID        string   `json:"skillId"`
		EntryPoint     string   `json:"entryPoint"`
		TargetType     string   `json:"targetType"`
		ProjectID      string   `json:"projectId"`
		ConversationID string   `json:"conversationId"`
		Input          RunInput `json:"input"`
	}{strings.TrimSpace(dto.SkillID), strings.ToLower(strings.TrimSpace(dto.EntryPoint)), strings.ToLower(strings.TrimSpace(dto.TargetType)),
		strings.TrimSpace(dto.ProjectID), strings.TrimSpace(dto.ConversationID), dto.Input})
	if err != nil {
		return nil, false, invalid("invalid skill run request")
	}
	skillID, err := idgen.Parse(dto.SkillID)
	if err != nil || skillID == 0 {
		return nil, false, invalid("invalid skillId")
	}
	projectID, err := optionalID(dto.ProjectID)
	if err != nil {
		return nil, false, invalid("invalid projectId")
	}
	conversationID, err := optionalID(dto.ConversationID)
	if err != nil {
		return nil, false, invalid("invalid conversationId")
	}
	var existing model.SkillRun
	if err := s.db.Where("user_id = ? AND client_request_id = ?", userID, clientID).First(&existing).Error; err == nil {
		if existing.ClientRequestHash != "" && existing.ClientRequestHash != requestHash {
			return nil, false, invalid("clientRequestId was already used for a different request")
		}
		return &existing, true, nil
	}
	var skill model.Skill
	if err := s.db.Where("id = ? AND status = 1", skillID).First(&skill).Error; err != nil || skill.CurrentVersionID == 0 {
		return nil, false, invalid("skill is unavailable")
	}
	var version model.SkillVersion
	if err := s.db.Where("id = ? AND skill_id = ? AND status = ?", skill.CurrentVersionID, skill.ID, model.SkillVersionPublished).First(&version).Error; err != nil {
		return nil, false, invalid("published skill version not found")
	}
	entryPoint := strings.ToLower(strings.TrimSpace(dto.EntryPoint))
	if !model.ValidSkillKind(version.Kind) {
		return nil, false, invalid("skill kind is unsupported")
	}
	if version.Kind == model.SkillKindAgent && entryPoint != "canvas" {
		return nil, false, invalid("agent skills can only run on canvas")
	}
	if version.Kind == model.SkillKindTool && entryPoint != "studio" && entryPoint != "api" {
		return nil, false, invalid("tool skills can only run in studio or api")
	}
	if version.Kind == model.SkillKindPreset {
		if entryPoint != "chat" && entryPoint != "studio" && entryPoint != "canvas" {
			return nil, false, invalid("preset skills can only run in chat, studio or canvas")
		}
		outputs := model.JSONStrings(version.OutputTypes, nil)
		if len(outputs) != 1 || !strings.EqualFold(strings.TrimSpace(outputs[0]), strings.TrimSpace(version.PrimaryOutputType)) {
			return nil, false, invalid("preset skill must have exactly one output type")
		}
	}
	targetType := strings.ToLower(strings.TrimSpace(dto.TargetType))
	if len(targetType) > 32 || strings.ContainsAny(targetType, " /\\\x00") {
		return nil, false, invalid("invalid targetType")
	}
	if !contains(model.JSONStrings(version.EntryPoints, nil), entryPoint) {
		return nil, false, invalid("skill does not support this entry point")
	}
	binding, err := s.versionPlacement(&version, entryPoint, targetType)
	if err != nil {
		return nil, false, err
	}
	if binding == nil {
		return nil, false, invalid("skill is not enabled for this target type")
	}
	if err := validateRunInput(dto.Input); err != nil {
		return nil, false, err
	}
	parameters, err := mergeRunParameters(version.DefaultParams, binding.Defaults, dto.Input.Parameters)
	if err != nil {
		return nil, false, err
	}
	dto.Input.Parameters = parameters
	if err := validateRunInput(dto.Input); err != nil {
		return nil, false, err
	}
	if err := validateSchemaValues(version.InputSchema, runInputValues(dto.Input)); err != nil {
		return nil, false, err
	}
	if projectID != 0 {
		var count int64
		if err := s.db.Model(&model.Project{}).Where("id = ? AND owner_id = ?", projectID, userID).Count(&count).Error; err != nil || count == 0 {
			return nil, false, invalid("project not found")
		}
	}
	if conversationID != 0 {
		var count int64
		if err := s.db.Model(&model.IMConversation{}).Where("id = ? AND owner_id = ?", conversationID, userID).Count(&count).Error; err != nil || count == 0 {
			return nil, false, invalid("conversation not found")
		}
	}
	if err := s.validateAssets(userID, dto.Input.Assets); err != nil {
		return nil, false, err
	}
	rawInput, err := json.Marshal(dto.Input)
	if err != nil {
		return nil, false, invalid("invalid input")
	}
	run := &model.SkillRun{
		UserID: userID, SkillID: skill.ID, SkillVersionID: version.ID, EntryPoint: entryPoint, TargetType: targetType,
		ProjectID: projectID, ConversationID: conversationID, Status: model.SkillRunQueued,
		Progress: 0, Input: string(rawInput), Context: "{}",
	}
	run.ClientRequestID = &clientID
	run.ClientRequestHash = requestHash
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(run).Error; err != nil {
			return err
		}
		if err := tx.Model(&model.Skill{}).Where("id = ?", skill.ID).
			UpdateColumn("use_count", gorm.Expr("use_count + 1")).Error; err != nil {
			return err
		}
		if conversationID != 0 {
			now := time.Now()
			prompt := strings.TrimSpace(dto.Input.Prompt)
			if prompt == "" {
				prompt = skill.Title
			}
			userMessage := model.IMMessage{ConversationID: conversationID, SenderID: userID, ContentType: "text", Content: prompt,
				Params: messageAttachmentParams(dto.Input.Assets)}
			if err := tx.Create(&userMessage).Error; err != nil {
				return err
			}
			assistantMessage := model.IMMessage{ConversationID: conversationID, SenderID: 0, ContentType: "skill_run", Content: skill.Title, SkillRunID: &run.ID}
			if err := tx.Create(&assistantMessage).Error; err != nil {
				return err
			}
			if err := tx.Model(&model.IMConversation{}).Where("id = ?", conversationID).Updates(map[string]any{
				"last_message_id": assistantMessage.ID, "last_message_at": now,
			}).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		var existing model.SkillRun
		if lookupErr := s.db.Where("user_id = ? AND client_request_id = ?", userID, clientID).First(&existing).Error; lookupErr == nil {
			if existing.ClientRequestHash != "" && existing.ClientRequestHash != requestHash {
				return nil, false, invalid("clientRequestId was already used for a different request")
			}
			return &existing, true, nil
		}
		return nil, false, err
	}
	return run, false, nil
}

type versionBinding struct {
	Surface    string          `json:"surface"`
	TargetType string          `json:"targetType"`
	Enabled    bool            `json:"enabled"`
	SortOrder  int             `json:"sortOrder"`
	Defaults   json.RawMessage `json:"defaults"`
}

// versionPlacement resolves the immutable binding pinned to this version. An
// exact target wins over the wildcard; this same precedence is used by the
// catalog ordering and prevents a broad binding from shadowing a specific one.
func (s *service) versionPlacement(version *model.SkillVersion, entryPoint, targetType string) (*versionBinding, error) {
	if strings.TrimSpace(version.BindingsJSON) != "" {
		var bindings []versionBinding
		if err := json.Unmarshal([]byte(version.BindingsJSON), &bindings); err != nil {
			return nil, errors.New("skill placement configuration is invalid")
		}
		var exact, wildcard *versionBinding
		for i := range bindings {
			binding := &bindings[i]
			if binding.Surface != entryPoint {
				continue
			}
			if targetType != "" && binding.TargetType == targetType {
				if exact == nil {
					exact = binding
				}
			}
			if binding.TargetType == "*" && wildcard == nil {
				wildcard = binding
			}
		}
		if exact != nil {
			if !exact.Enabled {
				return nil, nil
			}
			return exact, nil
		}
		if wildcard != nil && !wildcard.Enabled {
			return nil, nil
		}
		return wildcard, nil
	}
	// Compatibility for snapshots created before versioned bindings. Once startup
	// backfill runs, all current versions use the immutable branch above.
	var count int64
	if err := s.db.Model(&model.SkillSurfaceBinding{}).Where("skill_id = ? AND surface = ?", version.SkillID, entryPoint).Count(&count).Error; err != nil {
		return nil, err
	}
	if count == 0 {
		return &versionBinding{Surface: entryPoint, TargetType: "*", Enabled: true, Defaults: json.RawMessage(`{}`)}, nil
	}
	var rows []model.SkillSurfaceBinding
	if err := s.db.Where("skill_id = ? AND surface = ? AND target_type IN ?", version.SkillID, entryPoint, []string{"*", targetType}).
		Order(clause.Expr{SQL: "CASE WHEN target_type = ? THEN 0 ELSE 1 END, sort_order ASC, id ASC", Vars: []any{targetType}, WithoutParentheses: true}).Find(&rows).Error; err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, nil
	}
	if !rows[0].Enabled {
		return nil, nil
	}
	defaults := strings.TrimSpace(rows[0].Defaults)
	if defaults == "" {
		defaults = "{}"
	}
	return &versionBinding{Surface: rows[0].Surface, TargetType: rows[0].TargetType, Enabled: rows[0].Enabled,
		SortOrder: rows[0].SortOrder, Defaults: json.RawMessage(defaults)}, nil
}

func (s *service) validateAssets(userID idgen.ID, assets []AssetInput) error {
	for index, asset := range assets {
		if strings.TrimSpace(asset.URL) == "" && strings.TrimSpace(asset.ID) == "" {
			continue
		}
		clientURL := strings.TrimSpace(asset.URL)
		owned := false
		if rawID := strings.TrimSpace(asset.ID); rawID != "" {
			assetID, err := idgen.Parse(rawID)
			if err != nil || assetID == 0 {
				return invalidf("input.assets[%d].id is invalid", index)
			}
			var file model.File
			if err := s.db.Where("id = ? AND owner_id = ?", assetID, userID).First(&file).Error; err == nil {
				assets[index].URL = file.FileUrl
				owned = true
			} else if !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
			if !owned {
				var artifact model.SkillRunArtifact
				err := s.db.Model(&model.SkillRunArtifact{}).
					Joins("JOIN skill_run ON skill_run.id = skill_run_artifact.run_id AND skill_run.deleted IS NULL").
					Where("skill_run_artifact.id = ? AND skill_run.user_id = ?", assetID, userID).First(&artifact).Error
				if err == nil {
					assets[index].URL = artifact.URL
					owned = true
				} else if !errors.Is(err, gorm.ErrRecordNotFound) {
					return err
				}
			}
		}
		if owned {
			continue
		}
		if clientURL != "" {
			candidates := s.ownedAssetURLCandidates(clientURL)
			var file model.File
			if err := s.db.Select("id", "file_url").Where("owner_id = ? AND file_url IN ?", userID, candidates).First(&file).Error; err == nil {
				assets[index].URL = file.FileUrl
				owned = true
			} else if !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
		}
		if !owned && strings.TrimSpace(asset.URL) != "" {
			candidates := s.ownedAssetURLCandidates(clientURL)
			var artifact model.SkillRunArtifact
			err := s.db.Model(&model.SkillRunArtifact{}).
				Joins("JOIN skill_run ON skill_run.id = skill_run_artifact.run_id AND skill_run.deleted IS NULL").
				Where("skill_run.user_id = ? AND skill_run_artifact.url IN ?", userID, candidates).First(&artifact).Error
			if err == nil {
				assets[index].URL = artifact.URL
				owned = true
			} else if !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
			if !owned {
				var task model.AiTask
				err = s.db.Select("id", "result_url").Where("user_id = ? AND result_url IN ?", userID, candidates).First(&task).Error
				if err == nil {
					assets[index].URL = task.ResultUrl
					owned = true
				} else if !errors.Is(err, gorm.ErrRecordNotFound) {
					return err
				}
			}
			if !owned {
				var tasks []model.AiTask
				likeSQL := make([]string, 0, len(candidates))
				likeArgs := make([]any, 0, len(candidates))
				for _, candidate := range candidates {
					likeSQL = append(likeSQL, "result_meta LIKE ?")
					likeArgs = append(likeArgs, "%"+candidate+"%")
				}
				query := s.db.Select("result_meta").Where("user_id = ? AND result_meta <> ''", userID)
				if len(likeSQL) > 0 {
					query = query.Where("("+strings.Join(likeSQL, " OR ")+")", likeArgs...)
				}
				if err := query.Order("create_time DESC").Limit(100).Find(&tasks).Error; err != nil {
					return err
				}
				for i := range tasks {
					for _, candidate := range candidates {
						if metadataContainsURL(tasks[i].ResultMeta, candidate) {
							assets[index].URL = candidate
							owned = true
							break
						}
					}
					if owned {
						break
					}
				}
			}
		}
		if !owned {
			return invalidf("input.assets[%d] is not owned by the current user", index)
		}
	}
	return nil
}

func (s *service) ownedAssetURLCandidates(raw string) []string {
	candidates := []string{strings.TrimSpace(raw)}
	if s.deps != nil && s.deps.Storage != nil {
		if canonical, ok := s.deps.Storage.OwnsURL(raw); ok {
			candidates = append(candidates, canonical)
		}
		for _, pair := range s.deps.Storage.PublicRewrites() {
			if pair[0] != "" && pair[1] != "" && strings.HasPrefix(raw, pair[1]) {
				candidates = append(candidates, pair[0]+strings.TrimPrefix(raw, pair[1]))
			}
		}
	}
	seen := map[string]bool{}
	out := make([]string, 0, len(candidates))
	for _, candidate := range candidates {
		candidate = strings.TrimSpace(candidate)
		if candidate != "" && !seen[candidate] {
			seen[candidate] = true
			out = append(out, candidate)
		}
	}
	return out
}

func (s *service) applyAction(ctx context.Context, run *model.SkillRun, dto ActionDTO) error {
	requestID := strings.TrimSpace(dto.ClientRequestID)
	if requestID == "" {
		return invalid("clientRequestId is required")
	}
	actionHash, err := requestFingerprint(struct {
		Action   string         `json:"action"`
		Input    map[string]any `json:"input"`
		Feedback string         `json:"feedback"`
		Message  string         `json:"message"`
	}{dto.Action, dto.Input, dto.Feedback, dto.Message})
	if err != nil {
		return invalid("invalid action request")
	}
	isReplay := func(tx *gorm.DB, locked *model.SkillRun) (bool, error) {
		if requestID == "" {
			return false, nil
		}
		var receipt model.SkillRunActionReceipt
		err := tx.Where("run_id = ? AND client_request_id = ?", locked.ID, requestID).First(&receipt).Error
		if err == nil {
			if receipt.RequestHash != actionHash {
				return false, invalid("clientRequestId was already used for a different action")
			}
			return true, nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return false, err
		}
		// Compatibility for the single receipt stored by workers deployed before
		// the durable action ledger existed.
		if locked.LastActionRequestID != requestID {
			return false, nil
		}
		if locked.LastActionRequestHash != "" && locked.LastActionRequestHash != actionHash {
			return false, invalid("clientRequestId was already used for a different action")
		}
		return true, nil
	}
	recordReceipt := func(tx *gorm.DB) error {
		if requestID == "" {
			return nil
		}
		return tx.Create(&model.SkillRunActionReceipt{RunID: run.ID, ClientRequestID: requestID,
			RequestHash: actionHash, Action: dto.Action}).Error
	}
	checkRevision := func(locked *model.SkillRun) error {
		if dto.ExpectedRevision == nil {
			return invalid("expectedRevision is required")
		}
		if locked.StateRevision != *dto.ExpectedRevision {
			return invalid("run state changed; refresh and try again")
		}
		return nil
	}
	withRequestID := func(updates map[string]any) map[string]any {
		if requestID != "" {
			updates["last_action_request_id"] = requestID
			updates["last_action_request_hash"] = actionHash
		}
		return updates
	}
	switch dto.Action {
	case "cancel":
		var steps []model.SkillRunStep
		now := time.Now()
		if err := s.db.Transaction(func(tx *gorm.DB) error {
			var locked model.SkillRun
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&locked, "id = ?", run.ID).Error; err != nil {
				return err
			}
			replay, err := isReplay(tx, &locked)
			if err != nil {
				return err
			}
			if replay {
				return nil
			}
			if err := checkRevision(&locked); err != nil {
				return err
			}
			if isTerminal(locked.Status) {
				return recordReceipt(tx)
			}
			if err := tx.Where("run_id = ? AND status IN ?", run.ID, []string{model.SkillStepRunning, model.SkillStepWaiting}).Find(&steps).Error; err != nil {
				return err
			}
			if err := tx.Model(&model.SkillRunStep{}).Where("run_id = ? AND status IN ?", run.ID, []string{model.SkillStepRunning, model.SkillStepWaiting}).Updates(map[string]any{
				"status": model.SkillStepCancelled, "completed_at": now,
			}).Error; err != nil {
				return err
			}
			if err := tx.Model(&model.SkillRunArtifact{}).Where("run_id = ?", run.ID).Update("is_final", false).Error; err != nil {
				return err
			}
			if err := demoteRunChildTasksTx(tx, run.ID); err != nil {
				return err
			}
			result := tx.Model(&model.SkillRun{}).Where("id = ? AND revision = ? AND status NOT IN ?", run.ID, locked.Revision, []string{model.SkillRunSucceeded, model.SkillRunFailed, model.SkillRunCancelled}).Updates(withRequestID(map[string]any{
				"status": model.SkillRunCancelled, "progress": 100, "pending_action": "", "completed_at": now,
				"worker_id": "", "lease_expires_at": nil, "revision": gorm.Expr("revision + 1"), "state_revision": gorm.Expr("state_revision + 1"),
			}))
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return invalid("run state changed; refresh and try again")
			}
			return recordReceipt(tx)
		}); err != nil {
			return err
		}
		for i := range steps {
			if steps[i].AiTaskID != 0 {
				_ = s.ai.Cancel(ctx, run.UserID, steps[i].AiTaskID)
			}
		}
		// Defensive sweep for child tasks created by older workers before task
		// attachment became atomic. Only in-flight rows are cancelled; completed
		// intermediates remain as hidden audit records.
		var orphanTaskIDs []idgen.ID
		if err := s.db.Model(&model.AiTask{}).Where("skill_run_id = ? AND status = ?", run.ID, ai.TaskProcessing).
			Pluck("id", &orphanTaskIDs).Error; err == nil {
			for _, taskID := range orphanTaskIDs {
				_ = s.ai.Cancel(ctx, run.UserID, taskID)
			}
		}
		return nil
	case "retry":
		if err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			var locked model.SkillRun
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&locked, "id = ?", run.ID).Error; err != nil {
				return err
			}
			replay, err := isReplay(tx, &locked)
			if err != nil {
				return err
			}
			if replay {
				return nil
			}
			if err := checkRevision(&locked); err != nil {
				return err
			}
			if locked.Status != model.SkillRunFailed && locked.Status != model.SkillRunCancelled {
				return invalid("only failed or cancelled runs can be retried")
			}
			// Cancellation/failure hides final artifacts without destroying their
			// declared role. Restore reusable succeeded output before replay; an
			// unapproved draft remains intermediate and therefore non-final.
			if err := tx.Model(&model.SkillRunArtifact{}).Where("run_id = ?", run.ID).
				Update("is_final", gorm.Expr("CASE WHEN role = 'final' THEN ? ELSE ? END", true, false)).Error; err != nil {
				return err
			}
			result := tx.Model(&model.SkillRun{}).Where("id = ? AND revision = ? AND status IN ?", run.ID, locked.Revision,
				[]string{model.SkillRunFailed, model.SkillRunCancelled}).Updates(withRequestID(map[string]any{
				"status": model.SkillRunQueued, "error_message": "", "pending_action": "", "completed_at": nil,
				"progress": 0, "finalize_attempts": 0, "revision": gorm.Expr("revision + 1"), "state_revision": gorm.Expr("state_revision + 1"), "worker_id": "", "lease_expires_at": nil,
			}))
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return invalid("run state changed; refresh and try again")
			}
			return recordReceipt(tx)
		}); err != nil {
			return err
		}
		s.enqueue(run.ID)
		return nil
	case "confirm", "revise", "submit_input":
		feedback := strings.TrimSpace(dto.Feedback)
		if feedback == "" {
			feedback = strings.TrimSpace(dto.Message)
		}
		err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			var locked model.SkillRun
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&locked, "id = ?", run.ID).Error; err != nil {
				return err
			}
			replay, err := isReplay(tx, &locked)
			if err != nil {
				return err
			}
			if replay {
				return nil
			}
			if err := checkRevision(&locked); err != nil {
				return err
			}
			expected := model.SkillRunWaitingConfirmation
			if dto.Action == "submit_input" {
				expected = model.SkillRunWaitingInput
			}
			if locked.Status != expected {
				return invalid("run state changed; refresh and try again")
			}
			if dto.Action == "revise" && feedback == "" {
				return invalid("feedback is required when revising")
			}
			if dto.Action == "submit_input" {
				var pending struct {
					Schema json.RawMessage `json:"schema"`
				}
				if json.Unmarshal([]byte(locked.PendingAction), &pending) != nil {
					return invalid("pending input schema is invalid")
				}
				if err := validateSchemaValues(string(pending.Schema), dto.Input); err != nil {
					return err
				}
			}
			contextMap := map[string]any{}
			_ = json.Unmarshal([]byte(locked.Context), &contextMap)
			contextMap["lastAction"] = dto.Action
			contextMap["feedback"] = feedback
			if dto.Input != nil {
				contextMap["userInput"] = dto.Input
			}
			contextJSON, _ := json.Marshal(contextMap)
			var waiting model.SkillRunStep
			if err := tx.Where("run_id = ? AND status = ?", run.ID, model.SkillStepWaiting).Order("sequence_no DESC, attempt DESC").First(&waiting).Error; err != nil {
				return err
			}
			if dto.Action == "revise" {
				if err := tx.Model(&model.SkillRunStep{}).Where("id = ?", waiting.ID).Updates(map[string]any{
					"status": model.SkillStepCancelled, "output_json": string(contextJSON), "completed_at": time.Now(),
				}).Error; err != nil {
					return err
				}
				var previous model.SkillRunStep
				if err := tx.Where("run_id = ? AND sequence_no < ? AND type IN ?", run.ID, waiting.Sequence, []string{"text", "generate"}).
					Order("sequence_no DESC, attempt DESC").First(&previous).Error; err != nil {
					return invalid("there is no executable step to revise")
				}
				if err := tx.Model(&model.SkillRunStep{}).Where("id = ?", previous.ID).Updates(map[string]any{
					"status": model.SkillStepCancelled, "completed_at": time.Now(),
				}).Error; err != nil {
					return err
				}
				if err := tx.Model(&model.SkillRunArtifact{}).Where("step_id = ?", previous.ID).
					Updates(map[string]any{"is_final": false, "role": "intermediate"}).Error; err != nil {
					return err
				}
				// Defensive cleanup for drafts produced by older workers that registered
				// a work before approval. The next confirmed attempt will promote again.
				if previous.AiTaskID != 0 {
					if err := tx.Where("task_id = ?", previous.AiTaskID).Delete(&model.CommunityPost{}).Error; err != nil {
						return err
					}
					if err := tx.Model(&model.AiTask{}).Where("id = ?", previous.AiTaskID).
						Updates(map[string]any{"register_work": false, "output_role": "intermediate"}).Error; err != nil {
						return err
					}
				}
			} else {
				if err := tx.Model(&model.SkillRunStep{}).Where("id = ?", waiting.ID).Updates(map[string]any{
					"status": model.SkillStepSucceeded, "output_json": string(contextJSON), "completed_at": time.Now(),
				}).Error; err != nil {
					return err
				}
			}
			result := tx.Model(&model.SkillRun{}).Where("id = ? AND revision = ? AND status = ?", run.ID, locked.Revision, expected).Updates(withRequestID(map[string]any{
				"status": model.SkillRunQueued, "context_json": string(contextJSON), "pending_action": "", "revision": gorm.Expr("revision + 1"),
				"state_revision": gorm.Expr("state_revision + 1"), "worker_id": "", "lease_expires_at": nil,
			}))
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return invalid("run state changed; refresh and try again")
			}
			return recordReceipt(tx)
		})
		if err != nil {
			return err
		}
		s.enqueue(run.ID)
		return nil
	}
	return invalid("unsupported action")
}

func demoteRunChildTasksTx(tx *gorm.DB, runID idgen.ID) error {
	var taskIDs []idgen.ID
	if err := tx.Model(&model.AiTask{}).Where("skill_run_id = ?", runID).Pluck("id", &taskIDs).Error; err != nil {
		return err
	}
	if len(taskIDs) == 0 {
		return nil
	}
	if err := tx.Where("task_id IN ?", taskIDs).Delete(&model.CommunityPost{}).Error; err != nil {
		return err
	}
	return tx.Model(&model.AiTask{}).Where("id IN ?", taskIDs).
		Updates(map[string]any{"register_work": false, "output_role": "intermediate"}).Error
}

func (s *service) toVO(run *model.SkillRun) (RunVO, error) {
	var skill model.Skill
	_ = s.db.Select("id", "title").First(&skill, "id = ?", run.SkillID).Error
	var version model.SkillVersion
	_ = s.db.Select("id", "kind", "manifest_json").First(&version, "id = ?", run.SkillVersionID).Error
	titles := map[string]string{}
	var manifest agentManifest
	if json.Unmarshal([]byte(version.ManifestJSON), &manifest) == nil {
		for i := range manifest.Steps {
			titles[manifest.Steps[i].Key] = manifest.Steps[i].Title
		}
	}
	var steps []model.SkillRunStep
	if err := s.db.Where("run_id = ?", run.ID).Order("sequence_no ASC, attempt ASC").Find(&steps).Error; err != nil {
		return RunVO{}, err
	}
	var artifacts []model.SkillRunArtifact
	if err := s.db.Where("run_id = ?", run.ID).Order("sort_order ASC, create_time ASC").Find(&artifacts).Error; err != nil {
		return RunVO{}, err
	}
	artifactsByStep := map[idgen.ID][]ArtifactVO{}
	artifactVOs := make([]ArtifactVO, 0, len(artifacts))
	for i := range artifacts {
		vo := artifactVO(&artifacts[i])
		artifactVOs = append(artifactVOs, vo)
		artifactsByStep[artifacts[i].StepID] = append(artifactsByStep[artifacts[i].StepID], vo)
	}
	stepVOs := make([]StepVO, 0, len(steps))
	for i := range steps {
		progress := 0
		if steps[i].Status == model.SkillStepSucceeded || steps[i].Status == model.SkillStepFailed || steps[i].Status == model.SkillStepCancelled {
			progress = 100
		} else if steps[i].Status == model.SkillStepRunning || steps[i].Status == model.SkillStepWaiting {
			progress = 50
		}
		title := nonEmpty(titles[steps[i].StepKey], steps[i].StepKey)
		stepVOs = append(stepVOs, StepVO{ID: steps[i].ID, Key: steps[i].StepKey, Title: title,
			Status: steps[i].Status, Progress: progress, ErrorMessage: steps[i].ErrorMessage,
			Artifacts: artifactsByStep[steps[i].ID], CreateTime: formatTime(steps[i].CreateTime), UpdateTime: formatTime(steps[i].UpdateTime)})
	}
	var projectID, conversationID *idgen.ID
	if run.ProjectID != 0 {
		value := run.ProjectID
		projectID = &value
	}
	if run.ConversationID != 0 {
		value := run.ConversationID
		conversationID = &value
	}
	vo := RunVO{ID: run.ID, SkillID: run.SkillID, SkillVersionID: run.SkillVersionID,
		SkillTitle: skill.Title, SkillKind: version.Kind, UserID: run.UserID, EntryPoint: run.EntryPoint, TargetType: run.TargetType,
		ProjectID: projectID, ConversationID: conversationID, ClientRequestID: run.ClientRequestID,
		Status: run.Status, CurrentStep: run.CurrentStep, CurrentStepTitle: nonEmpty(titles[run.CurrentStep], run.CurrentStep),
		Progress: run.Progress, Input: rawObject(run.Input), PendingAction: rawObject(run.PendingAction),
		Steps: stepVOs, Artifacts: artifactVOs, ErrorMessage: run.ErrorMessage, ErrorMsg: run.ErrorMessage,
		PointCost: run.PointCost, Revision: run.StateRevision, CreateTime: formatTime(run.CreateTime), UpdateTime: formatTime(run.UpdateTime)}
	if run.CompletedAt != nil {
		vo.CompleteTime = formatTime(*run.CompletedAt)
	}
	return vo, nil
}

func artifactVO(row *model.SkillRunArtifact) ArtifactVO {
	meta := rawObject(row.Metadata)
	preferred := ""
	title := row.Role
	if len(meta) > 0 {
		var object map[string]any
		if json.Unmarshal(meta, &object) == nil {
			preferred, _ = object["preferredNodeType"].(string)
			if filename, _ := object["filename"].(string); strings.TrimSpace(filename) != "" {
				title = strings.TrimSpace(filename)
			}
		}
	}
	return ArtifactVO{ID: row.ID, RunID: row.RunID, StepID: row.StepID, Type: row.Type,
		Role: row.Role, Title: title, URL: row.URL, Text: row.Text, Content: row.Text,
		TaskID: row.TaskID, FileID: row.FileID, IsFinal: row.IsFinal, PreferredNodeType: preferred,
		Metadata: meta, CreateTime: formatTime(row.CreateTime)}
}

func rawObject(value string) json.RawMessage {
	value = strings.TrimSpace(value)
	if value == "" || !json.Valid([]byte(value)) {
		return nil
	}
	return json.RawMessage(value)
}

func validateRunInput(input RunInput) error {
	if len([]byte(input.Prompt)) > 32<<10 {
		return invalid("input.prompt exceeds 32 KiB")
	}
	if len(input.Messages) > 40 {
		return invalid("input.messages exceeds 40 items")
	}
	messageBytes := 0
	for index, message := range input.Messages {
		if message.Role != "user" && message.Role != "assistant" {
			return invalidf("input.messages[%d].role must be user or assistant", index)
		}
		if strings.TrimSpace(message.Content) == "" {
			return invalidf("input.messages[%d].content is required", index)
		}
		messageBytes += len(message.Role) + len([]byte(message.Content))
		if messageBytes > 256<<10 {
			return invalid("input.messages exceeds 256 KiB")
		}
	}
	if len(input.Assets) > 32 {
		return invalid("input.assets exceeds 32 items")
	}
	if len(input.SourceNodeIDs) > 64 {
		return invalid("input.sourceNodeIds exceeds 64 items")
	}
	parameters, err := json.Marshal(input.Parameters)
	if err != nil || len(parameters) > 64<<10 {
		return invalid("input.parameters exceeds 64 KiB or is invalid")
	}
	total := len([]byte(input.Prompt)) + messageBytes + len(parameters)
	for index, asset := range input.Assets {
		if len([]byte(asset.Content)) > 256<<10 {
			return invalidf("input.assets[%d].content exceeds 256 KiB", index)
		}
		for field, value := range map[string]string{
			"id": asset.ID, "url": asset.URL, "name": asset.Name, "role": asset.Role,
			"nodeType": asset.NodeType, "nodeId": asset.NodeID, "type": asset.Type,
		} {
			limit := 256
			if field == "url" {
				limit = 2048
			}
			if len([]byte(value)) > limit {
				return invalidf("input.assets[%d].%s is too long", index, field)
			}
			total += len([]byte(value))
		}
		metadata, err := json.Marshal(asset.Metadata)
		if err != nil || len(metadata) > 64<<10 {
			return invalidf("input.assets[%d].metadata exceeds 64 KiB or is invalid", index)
		}
		total += len([]byte(asset.Content)) + len(metadata)
	}
	for index, nodeID := range input.SourceNodeIDs {
		if len([]byte(nodeID)) > 128 {
			return invalidf("input.sourceNodeIds[%d] is too long", index)
		}
		total += len([]byte(nodeID))
	}
	if total > 1<<20 {
		return invalid("skill run input exceeds 1 MiB")
	}
	return nil
}

func runInputValues(input RunInput) map[string]any {
	values := make(map[string]any, len(input.Parameters)+3)
	for key, value := range input.Parameters {
		values[key] = value
	}
	values["prompt"] = input.Prompt
	values["assets"] = input.Assets
	values["sourceNodeIds"] = input.SourceNodeIDs
	return values
}

func mergeRunParameters(versionDefaults string, bindingDefaults json.RawMessage, user map[string]any) (map[string]any, error) {
	merged := map[string]any{}
	for _, raw := range []string{versionDefaults, string(bindingDefaults)} {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			continue
		}
		var values map[string]any
		if json.Unmarshal([]byte(raw), &values) != nil || values == nil {
			return nil, errors.New("skill default parameters are invalid")
		}
		for key, value := range values {
			merged[key] = value
		}
	}
	for key, value := range user {
		merged[key] = value
	}
	return merged, nil
}

func requestFingerprint(value any) (string, error) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(encoded)
	return fmt.Sprintf("%x", sum[:]), nil
}

func validateSchemaValues(schemaJSON string, values map[string]any) error {
	schemaJSON = strings.TrimSpace(schemaJSON)
	if schemaJSON == "" {
		return nil
	}
	var schema map[string]any
	if json.Unmarshal([]byte(schemaJSON), &schema) != nil {
		return invalid("skill input schema is invalid")
	}
	if typeName, _ := schema["type"].(string); typeName != "" && typeName != "object" {
		return invalid("skill input schema root must be an object")
	}
	// Convert typed DTO fields such as []AssetInput to the same JSON-native
	// representation used by parameters before applying recursive item schemas.
	encodedValues, err := json.Marshal(values)
	if err != nil || json.Unmarshal(encodedValues, &values) != nil {
		return invalid("skill input values are invalid")
	}
	required := map[string]bool{}
	if list, ok := schema["required"].([]any); ok {
		for _, item := range list {
			if key, ok := item.(string); ok {
				required[key] = true
			}
		}
	}
	properties, _ := schema["properties"].(map[string]any)
	if fields, ok := schema["fields"].([]any); ok {
		if properties == nil {
			properties = map[string]any{}
		}
		for _, item := range fields {
			field, ok := item.(map[string]any)
			if !ok {
				continue
			}
			key, _ := field["key"].(string)
			if key == "" {
				continue
			}
			properties[key] = field
			if flag, _ := field["required"].(bool); flag {
				required[key] = true
			}
		}
	}
	for key := range required {
		value, exists := values[key]
		if !exists || requiredValueEmpty(value) {
			return invalidf("input.%s is required", key)
		}
	}
	for key, rawSpec := range properties {
		value, exists := values[key]
		if !exists || value == nil {
			continue
		}
		spec, ok := rawSpec.(map[string]any)
		if !ok {
			continue
		}
		if err := validateSchemaValue(spec, value, "input."+key, 0); err != nil {
			return err
		}
	}
	if additional, exists := schema["additionalProperties"]; exists {
		for key, value := range values {
			if _, declared := properties[key]; declared {
				continue
			}
			switch rule := additional.(type) {
			case bool:
				if !rule {
					return invalidf("input.%s is not allowed", key)
				}
			case map[string]any:
				if err := validateSchemaValue(rule, value, "input."+key, 0); err != nil {
					return err
				}
			default:
				return invalid("skill input schema additionalProperties is invalid")
			}
		}
	}
	return nil
}

func validateSchemaValue(spec map[string]any, value any, path string, depth int) error {
	if depth > 8 {
		return invalid("skill input schema nesting exceeds limit")
	}
	typeName, _ := spec["type"].(string)
	typeName = strings.ToLower(strings.TrimSpace(typeName))
	matchType := typeName
	if typeName == "text" || typeName == "textarea" {
		matchType = "string"
	}
	if matchType != "" && matchType != "select" && !matchesJSONType(value, matchType) {
		return invalidf("%s must be %s", path, typeName)
	}
	enumValues, _ := spec["enum"].([]any)
	if len(enumValues) == 0 {
		enumValues = compactSchemaOptions(spec["options"])
	}
	if len(enumValues) > 0 && !containsJSONValue(enumValues, value) {
		return invalidf("%s is not an allowed value", path)
	}
	if number, ok := asFloat(value); ok {
		minimumValue := spec["minimum"]
		if minimumValue == nil {
			minimumValue = spec["min"]
		}
		maximumValue := spec["maximum"]
		if maximumValue == nil {
			maximumValue = spec["max"]
		}
		if minimum, ok := asFloat(minimumValue); ok && number < minimum {
			return invalidf("%s is below minimum", path)
		}
		if maximum, ok := asFloat(maximumValue); ok && number > maximum {
			return invalidf("%s exceeds maximum", path)
		}
		if multiple, ok := asFloat(spec["multipleOf"]); ok {
			if multiple <= 0 {
				return invalid("skill input schema multipleOf must be positive")
			}
			remainder := math.Mod(math.Abs(number), multiple)
			if remainder > 1e-9 && math.Abs(remainder-multiple) > 1e-9 {
				return invalidf("%s is not a valid increment", path)
			}
		}
	}
	if text, ok := value.(string); ok {
		length := utf8.RuneCountInString(text)
		if minimum, exists, err := nonNegativeSchemaInt(spec, "minLength"); err != nil {
			return err
		} else if exists && length < minimum {
			return invalidf("%s is shorter than minLength", path)
		}
		if maximum, exists, err := nonNegativeSchemaInt(spec, "maxLength"); err != nil {
			return err
		} else if exists && length > maximum {
			return invalidf("%s exceeds maxLength", path)
		}
		if rawPattern, exists := spec["pattern"]; exists {
			pattern, ok := rawPattern.(string)
			if !ok {
				return invalid("skill input schema pattern must be a string")
			}
			compiled, err := regexp.Compile(pattern)
			if err != nil {
				return invalid("skill input schema pattern is invalid")
			}
			if !compiled.MatchString(text) {
				return invalidf("%s does not match the required pattern", path)
			}
		}
	}
	if items, ok := value.([]any); ok {
		if minimum, exists, err := nonNegativeSchemaInt(spec, "minItems"); err != nil {
			return err
		} else if exists && len(items) < minimum {
			return invalidf("%s has too few items", path)
		}
		if maximum, exists, err := nonNegativeSchemaInt(spec, "maxItems"); err != nil {
			return err
		} else if exists && len(items) > maximum {
			return invalidf("%s has too many items", path)
		}
		if rawItems, exists := spec["items"]; exists {
			itemSpec, ok := rawItems.(map[string]any)
			if !ok {
				return invalid("skill input schema items must be an object")
			}
			for index, item := range items {
				if err := validateSchemaValue(itemSpec, item, fmt.Sprintf("%s[%d]", path, index), depth+1); err != nil {
					return err
				}
			}
		}
	}
	if object, ok := value.(map[string]any); ok {
		properties, _ := spec["properties"].(map[string]any)
		required := map[string]bool{}
		if values, ok := spec["required"].([]any); ok {
			for _, item := range values {
				if key, ok := item.(string); ok {
					required[key] = true
				}
			}
		}
		for key := range required {
			item, exists := object[key]
			if !exists || requiredValueEmpty(item) {
				return invalidf("%s.%s is required", path, key)
			}
		}
		for key, rawChild := range properties {
			item, exists := object[key]
			if !exists || item == nil {
				continue
			}
			child, ok := rawChild.(map[string]any)
			if !ok {
				return invalid("skill input schema property must be an object")
			}
			if err := validateSchemaValue(child, item, path+"."+key, depth+1); err != nil {
				return err
			}
		}
		if additional, exists := spec["additionalProperties"]; exists {
			for key, item := range object {
				if _, declared := properties[key]; declared {
					continue
				}
				switch rule := additional.(type) {
				case bool:
					if !rule {
						return invalidf("%s.%s is not allowed", path, key)
					}
				case map[string]any:
					if err := validateSchemaValue(rule, item, path+"."+key, depth+1); err != nil {
						return err
					}
				default:
					return invalid("skill input schema additionalProperties is invalid")
				}
			}
		}
	}
	return nil
}

func nonNegativeSchemaInt(spec map[string]any, key string) (int, bool, error) {
	raw, exists := spec[key]
	if !exists {
		return 0, false, nil
	}
	value, ok := asFloat(raw)
	if !ok || value < 0 || value != math.Trunc(value) || value > float64(^uint(0)>>1) {
		return 0, false, invalidf("skill input schema %s must be a non-negative integer", key)
	}
	return int(value), true, nil
}

func compactSchemaOptions(raw any) []any {
	items, _ := raw.([]any)
	values := make([]any, 0, len(items))
	for _, item := range items {
		if object, ok := item.(map[string]any); ok {
			if value, exists := object["value"]; exists {
				values = append(values, value)
			}
			continue
		}
		values = append(values, item)
	}
	return values
}

func requiredValueEmpty(value any) bool {
	if value == nil {
		return true
	}
	if text, ok := value.(string); ok {
		return strings.TrimSpace(text) == ""
	}
	rv := reflect.ValueOf(value)
	switch rv.Kind() {
	case reflect.Array, reflect.Slice, reflect.Map:
		return rv.Len() == 0
	}
	return false
}

func isString(value any) bool { _, ok := value.(string); return ok }

func matchesJSONType(value any, typeName string) bool {
	switch typeName {
	case "string":
		_, ok := value.(string)
		return ok
	case "number":
		_, ok := asFloat(value)
		return ok
	case "integer":
		number, ok := asFloat(value)
		return ok && number == float64(int64(number))
	case "boolean":
		_, ok := value.(bool)
		return ok
	case "array":
		valueType := fmt.Sprintf("%T", value)
		return strings.HasPrefix(valueType, "[]")
	case "object":
		_, ok := value.(map[string]any)
		return ok
	}
	return true
}

func asFloat(value any) (float64, bool) {
	switch number := value.(type) {
	case float64:
		return number, true
	case float32:
		return float64(number), true
	case int:
		return float64(number), true
	case int64:
		return float64(number), true
	case json.Number:
		value, err := number.Float64()
		return value, err == nil
	}
	return 0, false
}

func containsJSONValue(values []any, want any) bool {
	wantJSON, _ := json.Marshal(want)
	for _, value := range values {
		valueJSON, _ := json.Marshal(value)
		if string(valueJSON) == string(wantJSON) {
			return true
		}
	}
	return false
}

func metadataContainsURL(raw, want string) bool {
	var object map[string]any
	if json.Unmarshal([]byte(raw), &object) != nil {
		return false
	}
	for _, key := range []string{"urls", "images", "audioTracks", "videos", "resultUrls"} {
		if containsExactString(object[key], want) {
			return true
		}
	}
	return false
}

func matchesOwnedAssetURL(clientURL, storedURL string) bool {
	return strings.TrimSpace(clientURL) == "" || strings.TrimSpace(clientURL) == strings.TrimSpace(storedURL)
}

func messageAttachmentParams(assets []AssetInput) string {
	attachments := make([]map[string]string, 0, len(assets))
	for _, asset := range assets {
		url := strings.TrimSpace(asset.URL)
		if url == "" {
			continue
		}
		kind := normalizedOutput(asset.Type)
		if kind == "text" {
			kind = "file"
		}
		attachments = append(attachments, map[string]string{"url": url, "kind": kind})
	}
	if len(attachments) == 0 {
		return ""
	}
	raw, _ := json.Marshal(map[string]any{"attachments": attachments})
	return string(raw)
}

func containsExactString(value any, want string) bool {
	switch item := value.(type) {
	case string:
		return item == want
	case []any:
		for _, child := range item {
			if containsExactString(child, want) {
				return true
			}
		}
	case map[string]any:
		for _, key := range []string{"url", "src", "audioUrl", "videoUrl"} {
			if containsExactString(item[key], want) {
				return true
			}
		}
	}
	return false
}

func optionalID(raw string) (idgen.ID, error) {
	if strings.TrimSpace(raw) == "" {
		return 0, nil
	}
	return idgen.Parse(strings.TrimSpace(raw))
}

func parsePositive(raw string, fallback int) int {
	value := 0
	for _, char := range raw {
		if char < '0' || char > '9' {
			return fallback
		}
		value = value*10 + int(char-'0')
	}
	if value <= 0 {
		return fallback
	}
	return value
}

func parseClientRequestIDs(raw string) ([]string, error) {
	var parts []string
	if err := json.Unmarshal([]byte(raw), &parts); err != nil {
		return nil, errors.New("client request ids must be a JSON array")
	}
	if len(parts) == 0 || len(parts) > 40 {
		return nil, errors.New("client request id count is invalid")
	}
	seen := make(map[string]struct{}, len(parts))
	values := make([]string, 0, len(parts))
	for _, part := range parts {
		value := strings.TrimSpace(part)
		if value == "" || len(value) > 96 {
			return nil, errors.New("client request id is invalid")
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		values = append(values, value)
	}
	if len(values) == 0 {
		return nil, errors.New("client request ids are empty")
	}
	return values, nil
}

func contains(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

func isTerminal(status string) bool {
	return status == model.SkillRunSucceeded || status == model.SkillRunFailed || status == model.SkillRunCancelled
}

func formatTime(value time.Time) string {
	if value.IsZero() {
		return ""
	}
	return value.Format(time.RFC3339)
}
