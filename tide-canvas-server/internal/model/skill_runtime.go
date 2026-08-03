package model

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"tidecanvas/internal/pkg/idgen"
)

const (
	SkillKindPreset = "preset"
	SkillKindAgent  = "agent"

	// legacySkillKindWorkflow is a persisted compatibility value only. It is
	// normalized to agent during startup and is deliberately not accepted by
	// ValidSkillKind or exposed as a third public Skill kind.
	legacySkillKindWorkflow = "workflow"

	SkillVersionDraft     = "draft"
	SkillVersionPublished = "published"
	SkillVersionArchived  = "archived"

	SkillRunQueued              = "queued"
	SkillRunRunning             = "running"
	SkillRunWaitingInput        = "waiting_input"
	SkillRunWaitingConfirmation = "waiting_confirmation"
	SkillRunSucceeded           = "succeeded"
	SkillRunFailed              = "failed"
	SkillRunCancelled           = "cancelled"

	SkillStepPending   = "pending"
	SkillStepRunning   = "running"
	SkillStepWaiting   = "waiting"
	SkillStepSucceeded = "succeeded"
	SkillStepFailed    = "failed"
	SkillStepCancelled = "cancelled"
)

// SkillVersion is an immutable execution snapshot. Public catalog responses use
// its schemas/capabilities but never expose PromptTemplate, ManifestJSON or files.
type SkillVersion struct {
	BaseModel
	SkillID           idgen.ID   `gorm:"column:skill_id;not null;uniqueIndex:idx_skill_version_no,priority:1;index" json:"skillId"`
	Version           int        `gorm:"column:version_no;not null;uniqueIndex:idx_skill_version_no,priority:2" json:"version"`
	Kind              string     `gorm:"column:kind;size:16;not null;default:'preset';index" json:"kind"`
	Status            string     `gorm:"column:status;size:16;not null;default:'draft';index" json:"status"`
	EntryPoints       string     `gorm:"column:entry_points;type:text" json:"entryPoints"`
	PrimaryOutputType string     `gorm:"column:primary_output_type;size:16;index" json:"primaryOutputType"`
	OutputTypes       string     `gorm:"column:output_types;type:text" json:"outputTypes"`
	InputSchema       string     `gorm:"column:input_schema;type:longtext" json:"inputSchema"`
	ManifestJSON      string     `gorm:"column:manifest_json;type:longtext" json:"manifest"`
	PromptTemplate    string     `gorm:"column:prompt_template;type:longtext" json:"promptTemplate"`
	ModelID           string     `gorm:"column:model_id;size:128" json:"modelId"`
	DefaultParams     string     `gorm:"column:default_params;type:longtext" json:"defaultParams"`
	BindingsJSON      string     `gorm:"column:bindings_json;type:longtext" json:"bindings"`
	PrimaryFilePath   string     `gorm:"column:primary_file_path;size:512" json:"primaryFilePath"`
	ContentHash       string     `gorm:"column:content_hash;size:64;index" json:"contentHash"`
	CreatedBy         idgen.ID   `gorm:"column:created_by;default:0;index" json:"createdBy"`
	PublishedAt       *time.Time `gorm:"column:published_at" json:"publishedAt"`
}

func (SkillVersion) TableName() string { return "skill_version" }

// SkillFile stores the text package belonging to a version. Binary examples and
// covers should live in object storage and set StorageKey instead of Content.
type SkillFile struct {
	BaseModel
	SkillVersionID idgen.ID `gorm:"column:skill_version_id;not null;uniqueIndex:idx_skill_file_path,priority:1;index" json:"skillVersionId"`
	Path           string   `gorm:"column:path;size:512;not null;uniqueIndex:idx_skill_file_path,priority:2" json:"path"`
	Content        string   `gorm:"column:content;type:longtext" json:"content"`
	StorageKey     string   `gorm:"column:storage_key;size:512" json:"storageKey"`
	MimeType       string   `gorm:"column:mime_type;size:128" json:"mimeType"`
	Size           int64    `gorm:"column:size;not null;default:0" json:"size"`
	SHA256         string   `gorm:"column:sha256;size:64;index" json:"sha256"`
}

func (SkillFile) TableName() string { return "skill_file" }

// SkillRun is the durable, surface-independent execution. Redis may mirror live
// progress, but this row is always authoritative and supports restart recovery.
type SkillRun struct {
	BaseModel
	UserID            idgen.ID `gorm:"column:user_id;not null;index;uniqueIndex:idx_skill_run_user_client,priority:1" json:"userId"`
	SkillID           idgen.ID `gorm:"column:skill_id;not null;index" json:"skillId"`
	SkillVersionID    idgen.ID `gorm:"column:skill_version_id;not null;index" json:"skillVersionId"`
	EntryPoint        string   `gorm:"column:entry_point;size:16;not null;index" json:"entryPoint"`
	TargetType        string   `gorm:"column:target_type;size:32;index" json:"targetType"`
	ProjectID         idgen.ID `gorm:"column:project_id;default:0;index" json:"projectId"`
	ConversationID    idgen.ID `gorm:"column:conversation_id;default:0;index" json:"conversationId"`
	ClientRequestID   *string  `gorm:"column:client_request_id;size:96;uniqueIndex:idx_skill_run_user_client,priority:2" json:"clientRequestId,omitempty"`
	ClientRequestHash string   `gorm:"column:client_request_hash;size:64" json:"-"`
	// LastActionRequestID makes confirm/revise/input/retry/cancel replay-safe per
	// run. It is updated under the same row lock as the state transition.
	LastActionRequestID   string     `gorm:"column:last_action_request_id;size:96;index" json:"-"`
	LastActionRequestHash string     `gorm:"column:last_action_request_hash;size:64" json:"-"`
	Status                string     `gorm:"column:status;size:32;not null;default:'queued';index" json:"status"`
	CurrentStep           string     `gorm:"column:current_step;size:128" json:"currentStep"`
	Progress              int        `gorm:"column:progress;not null;default:0" json:"progress"`
	Input                 string     `gorm:"column:input_json;type:longtext" json:"input"`
	Context               string     `gorm:"column:context_json;type:longtext" json:"context"`
	PendingAction         string     `gorm:"column:pending_action;type:longtext" json:"pendingAction"`
	ErrorMessage          string     `gorm:"column:error_message;type:text" json:"errorMessage"`
	PointCost             int64      `gorm:"column:point_cost;not null;default:0" json:"pointCost"`
	StateRevision         int64      `gorm:"column:state_revision;not null;default:0" json:"revision"`
	Revision              int64      `gorm:"column:revision;not null;default:0" json:"-"`
	FinalizeAttempts      int        `gorm:"column:finalize_attempts;not null;default:0" json:"-"`
	WorkerID              string     `gorm:"column:worker_id;size:64;index" json:"-"`
	LeaseExpiresAt        *time.Time `gorm:"column:lease_expires_at;index" json:"-"`
	StartedAt             *time.Time `gorm:"column:started_at" json:"startedAt"`
	CompletedAt           *time.Time `gorm:"column:completed_at" json:"completedAt"`
}

func (SkillRun) TableName() string { return "skill_run" }

// SkillRunActionReceipt is the durable idempotency ledger for run actions.
// Keeping every request id (rather than only the latest one on SkillRun) stops
// a delayed retry from accidentally applying to a later approval/input step.
type SkillRunActionReceipt struct {
	BaseModel
	RunID           idgen.ID `gorm:"column:run_id;not null;uniqueIndex:idx_skill_action_request,priority:1;index" json:"-"`
	ClientRequestID string   `gorm:"column:client_request_id;size:96;not null;uniqueIndex:idx_skill_action_request,priority:2" json:"-"`
	RequestHash     string   `gorm:"column:request_hash;size:64;not null" json:"-"`
	Action          string   `gorm:"column:action;size:32;not null" json:"-"`
}

func (SkillRunActionReceipt) TableName() string { return "skill_run_action_receipt" }

type SkillRunStep struct {
	BaseModel
	RunID        idgen.ID   `gorm:"column:run_id;not null;uniqueIndex:idx_skill_step_attempt,priority:1;index" json:"runId"`
	StepKey      string     `gorm:"column:step_key;size:128;not null;uniqueIndex:idx_skill_step_attempt,priority:2" json:"stepKey"`
	Sequence     int        `gorm:"column:sequence_no;not null;default:0" json:"sequence"`
	Attempt      int        `gorm:"column:attempt;not null;default:1;uniqueIndex:idx_skill_step_attempt,priority:3" json:"attempt"`
	Type         string     `gorm:"column:type;size:32;not null" json:"type"`
	Status       string     `gorm:"column:status;size:32;not null;default:'pending';index" json:"status"`
	AiTaskID     idgen.ID   `gorm:"column:ai_task_id;default:0;index" json:"taskId"`
	RegisterWork bool       `gorm:"column:register_work;not null;default:false" json:"-"`
	Input        string     `gorm:"column:input_json;type:longtext" json:"input"`
	Output       string     `gorm:"column:output_json;type:longtext" json:"output"`
	ErrorMessage string     `gorm:"column:error_message;type:text" json:"errorMessage"`
	StartedAt    *time.Time `gorm:"column:started_at" json:"startedAt"`
	CompletedAt  *time.Time `gorm:"column:completed_at" json:"completedAt"`
}

func (SkillRunStep) TableName() string { return "skill_run_step" }

type SkillRunArtifact struct {
	BaseModel
	RunID     idgen.ID `gorm:"column:run_id;not null;index" json:"runId"`
	StepID    idgen.ID `gorm:"column:step_id;not null;index" json:"stepId"`
	TaskID    idgen.ID `gorm:"column:task_id;default:0;index" json:"taskId"`
	Type      string   `gorm:"column:type;size:16;not null;index" json:"type"`
	Role      string   `gorm:"column:role;size:64;not null;default:'final';index" json:"role"`
	Text      string   `gorm:"column:text_content;type:longtext" json:"text"`
	URL       string   `gorm:"column:url;size:2048" json:"url"`
	MimeType  string   `gorm:"column:mime_type;size:128" json:"mimeType"`
	Metadata  string   `gorm:"column:metadata_json;type:longtext" json:"metadata"`
	FileID    idgen.ID `gorm:"column:file_id;default:0;index" json:"fileId"`
	SourceID  idgen.ID `gorm:"column:source_artifact_id;default:0;index" json:"sourceArtifactId"`
	SortOrder int      `gorm:"column:sort_order;not null;default:0" json:"sortOrder"`
	IsFinal   bool     `gorm:"column:is_final;not null;default:false;index" json:"isFinal"`
}

func (SkillRunArtifact) TableName() string { return "skill_run_artifact" }

// SkillSurfaceBinding is product placement, separate from executable node
// features. TargetType is a canvas node type / asset type or "*".
type SkillSurfaceBinding struct {
	BaseModel
	SkillID    idgen.ID `gorm:"column:skill_id;not null;uniqueIndex:idx_skill_surface_target,priority:1;index" json:"skillId"`
	Surface    string   `gorm:"column:surface;size:16;not null;uniqueIndex:idx_skill_surface_target,priority:2;index" json:"surface"`
	TargetType string   `gorm:"column:target_type;size:32;not null;default:'*';uniqueIndex:idx_skill_surface_target,priority:3" json:"targetType"`
	Enabled    bool     `gorm:"column:enabled;not null;default:false" json:"enabled"`
	SortOrder  int      `gorm:"column:sort_order;not null;default:0" json:"sortOrder"`
	Defaults   string   `gorm:"column:defaults_json;type:text" json:"defaults"`
}

func (SkillSurfaceBinding) TableName() string { return "skill_surface_binding" }

func ValidSkillKind(kind string) bool {
	switch kind {
	case SkillKindPreset, SkillKindAgent:
		return true
	}
	return false
}

type normalizedSkillBinding struct {
	Surface    string          `json:"surface"`
	TargetType string          `json:"targetType"`
	Enabled    bool            `json:"enabled"`
	SortOrder  int             `json:"sortOrder"`
	Defaults   json.RawMessage `json:"defaults"`
}

// NormalizeSkillKinds collapses the historical workflow public kind into
// agent without deleting versions, files, runs, steps or artifacts. Multi-step
// manifests remain intact and are still executed by the Agent runner. The same
// pass enforces the current product contract on persisted snapshots:
//   - preset has exactly one declared output;
//   - agent is placed on canvas only.
//
// It is idempotent and runs after the legacy preset-version backfill.
func NormalizeSkillKinds(db *gorm.DB) error {
	return db.Transaction(func(tx *gorm.DB) error {
		var versions []SkillVersion
		if err := tx.Where("kind IN ?", []string{SkillKindPreset, SkillKindAgent, legacySkillKindWorkflow}).
			Order("id ASC").Find(&versions).Error; err != nil {
			return err
		}

		for i := range versions {
			version := &versions[i]
			kind := strings.ToLower(strings.TrimSpace(version.Kind))
			if kind == legacySkillKindWorkflow {
				kind = SkillKindAgent
			}
			primary := strings.ToLower(strings.TrimSpace(version.PrimaryOutputType))
			if primary == "" {
				primary = "text"
			}
			outputs := JSONStrings(version.OutputTypes, []string{primary})
			entryPoints := version.EntryPoints
			bindingsJSON := version.BindingsJSON
			if kind == SkillKindPreset {
				outputs = []string{primary}
				entryPoints = JSONString([]string{"chat", "studio", "canvas"})
				bindingsJSON = JSONString(presetSkillBindings(version.BindingsJSON))
			} else if kind == SkillKindAgent {
				entryPoints = JSONString([]string{"canvas"})
				bindingsJSON = JSONString(canvasOnlySkillBindings(version.BindingsJSON))
			}
			manifestJSON := normalizePersistedSkillManifest(version.ManifestJSON, kind, primary, outputs)

			if version.Kind == kind && version.PrimaryOutputType == primary &&
				version.OutputTypes == JSONString(outputs) && version.EntryPoints == entryPoints &&
				version.BindingsJSON == bindingsJSON && version.ManifestJSON == manifestJSON {
				continue
			}
			var files []SkillFile
			if err := tx.Where("skill_version_id = ?", version.ID).Order("path ASC").Find(&files).Error; err != nil {
				return err
			}
			parts := []string{kind, entryPoints, primary, JSONString(outputs), version.InputSchema,
				manifestJSON, version.PromptTemplate, version.ModelID, version.DefaultParams,
				bindingsJSON, version.PrimaryFilePath}
			for j := range files {
				parts = append(parts, files[j].Path, files[j].SHA256)
			}
			if err := tx.Model(&SkillVersion{}).Where("id = ?", version.ID).Updates(map[string]any{
				"kind": kind, "entry_points": entryPoints, "primary_output_type": primary,
				"output_types": JSONString(outputs), "manifest_json": manifestJSON,
				"bindings_json": bindingsJSON, "content_hash": skillContentHash(parts...),
			}).Error; err != nil {
				return err
			}
		}

		if err := tx.Model(&Skill{}).Where("kind = ?", legacySkillKindWorkflow).
			Update("kind", SkillKindAgent).Error; err != nil {
			return err
		}
		// Keep the mutable catalog row aligned with its immutable current version
		// for both public kinds. Public filters use the version snapshot, while
		// cards and legacy admin views still read Skill.OutputType.
		var catalogSkills []Skill
		if err := tx.Where("current_version_id <> 0").Order("id ASC").Find(&catalogSkills).Error; err != nil {
			return err
		}
		for i := range catalogSkills {
			var current SkillVersion
			if err := tx.Select("id", "kind", "primary_output_type").
				First(&current, "id = ? AND skill_id = ?", catalogSkills[i].CurrentVersionID, catalogSkills[i].ID).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					continue
				}
				return err
			}
			kind := strings.ToLower(strings.TrimSpace(current.Kind))
			if kind == legacySkillKindWorkflow {
				kind = SkillKindAgent
			}
			if !ValidSkillKind(kind) {
				continue
			}
			outputType := strings.ToLower(strings.TrimSpace(current.PrimaryOutputType))
			if outputType == "" {
				outputType = "text"
			}
			if err := tx.Model(&Skill{}).Where("id = ?", catalogSkills[i].ID).Updates(map[string]any{
				"kind": kind, "output_type": outputType,
			}).Error; err != nil {
				return err
			}
		}
		// Retire placements that no longer belong to either public surface
		// contract. Public version snapshots are normalized above as well.
		if err := tx.Unscoped().Where("skill_id IN (?) AND surface NOT IN ?",
			tx.Model(&Skill{}).Select("id").Where("kind = ?", SkillKindPreset),
			[]string{"chat", "studio", "canvas"}).Delete(&SkillSurfaceBinding{}).Error; err != nil {
			return err
		}
		var agentSkills []Skill
		if err := tx.Where("kind = ?", SkillKindAgent).Order("id ASC").Find(&agentSkills).Error; err != nil {
			return err
		}
		for i := range agentSkills {
			skill := &agentSkills[i]
			bindings := []normalizedSkillBinding{{Surface: "canvas", TargetType: "*", Enabled: true, Defaults: json.RawMessage(`{}`)}}
			if skill.CurrentVersionID != 0 {
				var current SkillVersion
				if err := tx.Select("id", "kind", "primary_output_type", "bindings_json").
					First(&current, "id = ? AND skill_id = ?", skill.CurrentVersionID, skill.ID).Error; err == nil {
					bindings = canvasOnlySkillBindings(current.BindingsJSON)
					if err := tx.Model(&Skill{}).Where("id = ?", skill.ID).Updates(map[string]any{
						"kind": SkillKindAgent, "output_type": current.PrimaryOutputType,
					}).Error; err != nil {
						return err
					}
				} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
					return err
				}
			}
			var live []SkillSurfaceBinding
			if err := tx.Where("skill_id = ?", skill.ID).Order("sort_order ASC, target_type ASC, id ASC").Find(&live).Error; err != nil {
				return err
			}
			if liveSkillBindingsMatch(live, bindings) {
				continue
			}
			if err := tx.Unscoped().Where("skill_id = ?", skill.ID).Delete(&SkillSurfaceBinding{}).Error; err != nil {
				return err
			}
			for j := range bindings {
				row := SkillSurfaceBinding{SkillID: skill.ID, Surface: "canvas", TargetType: bindings[j].TargetType,
					Enabled: bindings[j].Enabled, SortOrder: bindings[j].SortOrder, Defaults: string(bindings[j].Defaults)}
				if err := tx.Create(&row).Error; err != nil {
					return err
				}
			}
		}
		return nil
	})
}

func liveSkillBindingsMatch(live []SkillSurfaceBinding, expected []normalizedSkillBinding) bool {
	if len(live) != len(expected) {
		return false
	}
	used := make([]bool, len(live))
	for i := range expected {
		found := false
		for j := range live {
			if used[j] || live[j].Surface != "canvas" || live[j].TargetType != expected[i].TargetType ||
				live[j].Enabled != expected[i].Enabled || live[j].SortOrder != expected[i].SortOrder ||
				canonicalSkillJSON(live[j].Defaults) != canonicalSkillJSON(string(expected[i].Defaults)) {
				continue
			}
			used[j] = true
			found = true
			break
		}
		if !found {
			return false
		}
	}
	return true
}

func canonicalSkillJSON(raw string) string {
	var value any
	if json.Unmarshal([]byte(raw), &value) != nil {
		return raw
	}
	encoded, _ := json.Marshal(value)
	return string(encoded)
}

func canvasOnlySkillBindings(raw string) []normalizedSkillBinding {
	var parsed []normalizedSkillBinding
	if json.Unmarshal([]byte(raw), &parsed) != nil {
		parsed = nil
	}
	out := make([]normalizedSkillBinding, 0, len(parsed))
	for i := range parsed {
		if !strings.EqualFold(strings.TrimSpace(parsed[i].Surface), "canvas") {
			continue
		}
		parsed[i].Surface = "canvas"
		parsed[i].TargetType = strings.ToLower(strings.TrimSpace(parsed[i].TargetType))
		if parsed[i].TargetType == "" {
			parsed[i].TargetType = "*"
		}
		if len(parsed[i].Defaults) == 0 || !json.Valid(parsed[i].Defaults) {
			parsed[i].Defaults = json.RawMessage(`{}`)
		}
		out = append(out, parsed[i])
	}
	if len(out) == 0 {
		out = append(out, normalizedSkillBinding{Surface: "canvas", TargetType: "*", Enabled: true, Defaults: json.RawMessage(`{}`)})
	}
	return out
}

func presetSkillBindings(raw string) []normalizedSkillBinding {
	var parsed []normalizedSkillBinding
	if json.Unmarshal([]byte(raw), &parsed) != nil {
		parsed = nil
	}
	allowed := map[string]bool{"chat": true, "studio": true, "canvas": true}
	out := make([]normalizedSkillBinding, 0, len(parsed))
	for i := range parsed {
		surface := strings.ToLower(strings.TrimSpace(parsed[i].Surface))
		if !allowed[surface] {
			continue
		}
		parsed[i].Surface = surface
		parsed[i].TargetType = strings.ToLower(strings.TrimSpace(parsed[i].TargetType))
		if parsed[i].TargetType == "" {
			parsed[i].TargetType = "*"
		}
		if len(parsed[i].Defaults) == 0 || !json.Valid(parsed[i].Defaults) {
			parsed[i].Defaults = json.RawMessage(`{}`)
		}
		out = append(out, parsed[i])
	}
	if len(out) == 0 {
		for _, surface := range []string{"chat", "studio", "canvas"} {
			out = append(out, normalizedSkillBinding{Surface: surface, TargetType: "*", Enabled: true, Defaults: json.RawMessage(`{}`)})
		}
	}
	return out
}

func normalizePersistedSkillManifest(raw, kind, primary string, outputs []string) string {
	var manifest map[string]any
	if json.Unmarshal([]byte(raw), &manifest) != nil || manifest == nil {
		return raw
	}
	manifest["kind"] = kind
	manifest["primaryOutputType"] = primary
	manifest["outputTypes"] = outputs
	encoded, err := json.Marshal(manifest)
	if err != nil {
		return raw
	}
	return string(encoded)
}

func JSONStrings(raw string, fallback []string) []string {
	var out []string
	if json.Unmarshal([]byte(raw), &out) != nil || len(out) == 0 {
		return append([]string(nil), fallback...)
	}
	return out
}

func JSONString(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}

func skillContentHash(parts ...string) string {
	h := sha256.New()
	for _, part := range parts {
		_, _ = h.Write([]byte(part))
		_, _ = h.Write([]byte{0})
	}
	return hex.EncodeToString(h.Sum(nil))
}

// EnsurePresetSkillVersion backfills an existing legacy Skill as published v1.
// It is idempotent and never overwrites an existing version or administrator
// content. The legacy row remains intact for /api/ai/generate compatibility.
func EnsurePresetSkillVersion(db *gorm.DB, skill *Skill) (*SkillVersion, error) {
	if skill == nil || skill.ID == 0 {
		return nil, errors.New("invalid skill")
	}
	var existing SkillVersion
	err := db.Where("skill_id = ? AND version_no = 1", skill.ID).First(&existing).Error
	if err == nil {
		if skill.CurrentVersionID == 0 {
			_ = db.Model(&Skill{}).Where("id = ?", skill.ID).Updates(map[string]any{
				"current_version_id": existing.ID, "kind": existing.Kind,
			}).Error
		}
		return &existing, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	now := time.Now()
	entryPoints := []string{"chat", "studio", "canvas"}
	var liveBindings []SkillSurfaceBinding
	if err := db.Where("skill_id = ?", skill.ID).Order("surface ASC, sort_order ASC, target_type ASC").Find(&liveBindings).Error; err != nil {
		return nil, err
	}
	bindings := make([]map[string]any, 0, len(liveBindings)+len(entryPoints))
	if len(liveBindings) == 0 {
		for _, surface := range entryPoints {
			bindings = append(bindings, map[string]any{"surface": surface, "targetType": legacySkillBindingTarget(surface, skill.OutputType), "enabled": true, "sortOrder": 0, "defaults": map[string]any{}})
		}
	} else {
		for i := range liveBindings {
			defaults := map[string]any{}
			_ = json.Unmarshal([]byte(defaultJSONObject(liveBindings[i].Defaults)), &defaults)
			bindings = append(bindings, map[string]any{"surface": liveBindings[i].Surface, "targetType": liveBindings[i].TargetType,
				"enabled": liveBindings[i].Enabled, "sortOrder": liveBindings[i].SortOrder, "defaults": defaults})
		}
	}
	outputs := []string{skill.OutputType}
	manifest := map[string]any{
		"kind": SkillKindPreset, "promptTemplate": skill.PromptTemplate,
		"modelId": skill.ModelID, "defaultParams": json.RawMessage(defaultJSONObject(skill.DefaultParams)),
		"primaryOutputType": skill.OutputType, "outputTypes": outputs,
	}
	manifestJSON, _ := json.Marshal(manifest)
	content := strings.TrimSpace(skill.PromptTemplate)
	if content == "" {
		content = "# " + skill.Title
	}
	fileHash := skillContentHash(content)
	version := &SkillVersion{
		SkillID: skill.ID, Version: 1, Kind: SkillKindPreset,
		Status: SkillVersionPublished, EntryPoints: JSONString(entryPoints),
		PrimaryOutputType: skill.OutputType, OutputTypes: JSONString(outputs),
		InputSchema:  `{"type":"object"}`,
		ManifestJSON: string(manifestJSON), PromptTemplate: skill.PromptTemplate,
		ModelID: skill.ModelID, DefaultParams: skill.DefaultParams,
		BindingsJSON:    JSONString(bindings),
		PrimaryFilePath: "SKILL.md",
		PublishedAt:     &now,
	}
	version.ContentHash = skillContentHash(
		version.Kind, version.EntryPoints, version.PrimaryOutputType, version.OutputTypes,
		version.InputSchema, version.ManifestJSON, version.PromptTemplate, version.ModelID,
		version.DefaultParams, version.BindingsJSON, version.PrimaryFilePath, "SKILL.md", fileHash,
	)
	err = db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(version).Error; err != nil {
			if errors.Is(err, gorm.ErrDuplicatedKey) {
				return tx.Where("skill_id = ? AND version_no = 1", skill.ID).First(version).Error
			}
			return err
		}
		file := &SkillFile{SkillVersionID: version.ID, Path: "SKILL.md", Content: content,
			MimeType: "text/markdown; charset=utf-8", Size: int64(len([]byte(content))), SHA256: fileHash}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(file).Error; err != nil {
			return err
		}
		if len(liveBindings) == 0 {
			if err := tx.Unscoped().Where("skill_id = ?", skill.ID).Delete(&SkillSurfaceBinding{}).Error; err != nil {
				return err
			}
			for _, surface := range entryPoints {
				binding := &SkillSurfaceBinding{SkillID: skill.ID, Surface: surface, TargetType: legacySkillBindingTarget(surface, skill.OutputType), Enabled: true, Defaults: "{}"}
				if err := tx.Create(binding).Error; err != nil {
					return err
				}
			}
		}
		return tx.Model(&Skill{}).Where("id = ?", skill.ID).Updates(map[string]any{
			"current_version_id": version.ID, "kind": SkillKindPreset,
		}).Error
	})
	if err != nil {
		return nil, err
	}
	return version, nil
}

func defaultJSONObject(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" || !json.Valid([]byte(raw)) || raw[0] != '{' {
		return "{}"
	}
	return raw
}

// BackfillSkillVersions migrates every legacy Skill to preset v1 without
// importing repository-local files or mutating published production content.
func BackfillSkillVersions(db *gorm.DB) error {
	var skills []Skill
	if err := db.Order("id ASC").Find(&skills).Error; err != nil {
		return err
	}
	for i := range skills {
		version, err := EnsurePresetSkillVersion(db, &skills[i])
		if err != nil {
			return err
		}
		if err := repairGeneratedLegacyAssetWildcard(db, &skills[i], version); err != nil {
			return err
		}
		var versions []SkillVersion
		if err := db.Where("skill_id = ? AND (bindings_json IS NULL OR bindings_json = '')", skills[i].ID).
			Order("version_no ASC").Find(&versions).Error; err != nil {
			return err
		}
		for j := range versions {
			if err := ensureLegacySkillVersionBindings(db, &skills[i], &versions[j]); err != nil {
				return err
			}
		}
	}
	return nil
}

// repairGeneratedLegacyAssetWildcard fixes v1 snapshots produced by the first
// version of the backfill, which exposed non-image preset outputs to asset/*.
// Only system-generated v1 rows are eligible; administrator-authored immutable
// versions are never rewritten.
func repairGeneratedLegacyAssetWildcard(db *gorm.DB, skill *Skill, version *SkillVersion) error {
	if skill == nil || version == nil || version.Version != 1 || version.CreatedBy != 0 ||
		version.Kind != SkillKindPreset || strings.EqualFold(strings.TrimSpace(version.PrimaryOutputType), "image") ||
		strings.TrimSpace(version.BindingsJSON) == "" {
		return nil
	}
	var snapshots []map[string]any
	if json.Unmarshal([]byte(version.BindingsJSON), &snapshots) != nil {
		return nil
	}
	if !rewriteLegacyAssetWildcard(snapshots) {
		return nil
	}
	bindingsJSON := JSONString(snapshots)
	var files []SkillFile
	if err := db.Where("skill_version_id = ?", version.ID).Order("path ASC").Find(&files).Error; err != nil {
		return err
	}
	parts := []string{version.Kind, version.EntryPoints, version.PrimaryOutputType, version.OutputTypes,
		version.InputSchema, version.ManifestJSON, version.PromptTemplate, version.ModelID,
		version.DefaultParams, bindingsJSON, version.PrimaryFilePath}
	for i := range files {
		parts = append(parts, files[i].Path, files[i].SHA256)
	}
	return db.Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&SkillVersion{}).
			Where("id = ? AND version_no = 1 AND created_by = 0 AND bindings_json = ?", version.ID, version.BindingsJSON).
			Updates(map[string]any{"bindings_json": bindingsJSON, "content_hash": skillContentHash(parts...)})
		if result.Error != nil || result.RowsAffected != 1 {
			return result.Error
		}
		var exactCount int64
		if err := tx.Model(&SkillSurfaceBinding{}).
			Where("skill_id = ? AND surface = ? AND target_type = ?", skill.ID, "asset", "general").Count(&exactCount).Error; err != nil {
			return err
		}
		wildcard := tx.Model(&SkillSurfaceBinding{}).
			Where("skill_id = ? AND surface = ? AND target_type = ? AND enabled = ?", skill.ID, "asset", "*", true)
		if exactCount > 0 {
			if err := wildcard.Delete(&SkillSurfaceBinding{}).Error; err != nil {
				return err
			}
		} else if err := wildcard.Update("target_type", "general").Error; err != nil {
			return err
		}
		version.BindingsJSON = bindingsJSON
		version.ContentHash = skillContentHash(parts...)
		return nil
	})
}

func rewriteLegacyAssetWildcard(snapshots []map[string]any) bool {
	changed := false
	for i := range snapshots {
		surface, _ := snapshots[i]["surface"].(string)
		target, _ := snapshots[i]["targetType"].(string)
		enabled, hasEnabled := snapshots[i]["enabled"].(bool)
		if strings.EqualFold(strings.TrimSpace(surface), "asset") && strings.TrimSpace(target) == "*" && (!hasEnabled || enabled) {
			snapshots[i]["targetType"] = "general"
			changed = true
		}
	}
	return changed
}

// ensureLegacySkillVersionBindings upgrades snapshots created before bindings
// became versioned. It only fills empty historical fields and an entirely empty
// live placement table; administrator-authored bindings are never overwritten.
func ensureLegacySkillVersionBindings(db *gorm.DB, skill *Skill, version *SkillVersion) error {
	if skill == nil || version == nil {
		return nil
	}
	entryPoints := JSONStrings(version.EntryPoints, []string{"chat", "studio", "canvas"})
	var rows []SkillSurfaceBinding
	if err := db.Where("skill_id = ?", skill.ID).Order("surface ASC, sort_order ASC, target_type ASC").Find(&rows).Error; err != nil {
		return err
	}
	if len(rows) == 0 {
		if err := db.Unscoped().Where("skill_id = ?", skill.ID).Delete(&SkillSurfaceBinding{}).Error; err != nil {
			return err
		}
		for _, surface := range entryPoints {
			row := &SkillSurfaceBinding{SkillID: skill.ID, Surface: surface, TargetType: legacySkillBindingTarget(surface, version.PrimaryOutputType), Enabled: true, Defaults: "{}"}
			if err := db.Clauses(clause.OnConflict{DoNothing: true}).Create(row).Error; err != nil {
				return err
			}
		}
		if err := db.Where("skill_id = ?", skill.ID).Order("surface ASC, sort_order ASC, target_type ASC").Find(&rows).Error; err != nil {
			return err
		}
	}
	if strings.TrimSpace(version.BindingsJSON) != "" {
		return nil
	}
	snapshots := make([]map[string]any, 0, len(rows))
	for i := range rows {
		defaults := map[string]any{}
		_ = json.Unmarshal([]byte(defaultJSONObject(rows[i].Defaults)), &defaults)
		snapshots = append(snapshots, map[string]any{"surface": rows[i].Surface, "targetType": rows[i].TargetType,
			"enabled": rows[i].Enabled, "sortOrder": rows[i].SortOrder, "defaults": defaults})
	}
	bindingsJSON := JSONString(snapshots)
	var files []SkillFile
	if err := db.Where("skill_version_id = ?", version.ID).Order("path ASC").Find(&files).Error; err != nil {
		return err
	}
	parts := []string{version.Kind, version.EntryPoints, version.PrimaryOutputType, version.OutputTypes,
		version.InputSchema, version.ManifestJSON, version.PromptTemplate, version.ModelID,
		version.DefaultParams, bindingsJSON, version.PrimaryFilePath}
	for i := range files {
		parts = append(parts, files[i].Path, files[i].SHA256)
	}
	return db.Model(&SkillVersion{}).Where("id = ? AND (bindings_json IS NULL OR bindings_json = '')", version.ID).
		Updates(map[string]any{"bindings_json": bindingsJSON, "content_hash": skillContentHash(parts...)}).Error
}

// legacySkillBindingTarget keeps legacy media skills available in the asset
// manager without granting character/scene placement to non-image outputs.
// Asset "*" includes those semantic image-only targets, while "general" is the
// correct category for audio, video, text and file results.
func legacySkillBindingTarget(surface, outputType string) string {
	if strings.EqualFold(strings.TrimSpace(surface), "asset") && !strings.EqualFold(strings.TrimSpace(outputType), "image") {
		return "general"
	}
	return "*"
}

// NextSkillVersion returns one greater than the highest existing version.
func NextSkillVersion(db *gorm.DB, skillID idgen.ID) (int, error) {
	var nums []int
	if err := db.Model(&SkillVersion{}).Where("skill_id = ?", skillID).Pluck("version_no", &nums).Error; err != nil {
		return 0, err
	}
	if len(nums) == 0 {
		return 1, nil
	}
	sort.Ints(nums)
	return nums[len(nums)-1] + 1, nil
}
