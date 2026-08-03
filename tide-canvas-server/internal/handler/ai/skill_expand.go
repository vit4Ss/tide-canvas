package ai

import (
	"context"
	"encoding/json"
	"errors"
	"path"
	"regexp"
	"strings"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

const maxExpandedSkillPrompt = 1 << 20

var pinnedSkillFilePattern = regexp.MustCompile(`\{\{skill\.file:([^{}]+)\}\}`)

type PublishedPreset struct {
	SkillID   idgen.ID
	VersionID idgen.ID
	Prompt    string
	ModelID   string
	Defaults  map[string]any
}

type skillPlacementBinding struct {
	Surface    string          `json:"surface"`
	TargetType string          `json:"targetType"`
	Enabled    bool            `json:"enabled"`
	Defaults   json.RawMessage `json:"defaults"`
}

// resolveSkillPlacement implements the placement contract shared by direct
// generation and chat presets. An explicit exact row is authoritative even
// when disabled; only the absence of an exact row permits wildcard fallback.
func resolveSkillPlacement(bindings []skillPlacementBinding, surface, targetType string) *skillPlacementBinding {
	var exact, wildcard *skillPlacementBinding
	for i := range bindings {
		binding := &bindings[i]
		if binding.Surface != surface {
			continue
		}
		if targetType != "*" && binding.TargetType == targetType && exact == nil {
			exact = binding
		}
		if binding.TargetType == "*" && wildcard == nil {
			wildcard = binding
		}
	}
	selected := exact
	if selected == nil {
		selected = wildcard
	}
	if selected == nil || !selected.Enabled {
		return nil
	}
	return selected
}

// ResolvePublishedPreset pins a preset to the current published version and
// validates the same immutable placement snapshot used by generation. It is
// exported for the chat text pipeline, which streams directly instead of
// creating an AiTask.
func ResolvePublishedPreset(ctx context.Context, db *gorm.DB, rawID, surface, targetType, outputType string) (*PublishedPreset, error) {
	skillID, err := idgen.Parse(strings.TrimSpace(rawID))
	if err != nil || skillID == 0 {
		return nil, errors.New("skillId is invalid")
	}
	var skill model.Skill
	if err := db.WithContext(ctx).Where("id = ? AND status = 1", skillID).First(&skill).Error; err != nil || skill.CurrentVersionID == 0 {
		return nil, errors.New("skill is unavailable")
	}
	var version model.SkillVersion
	if err := db.WithContext(ctx).Where("id = ? AND skill_id = ? AND status = ?", skill.CurrentVersionID, skill.ID, model.SkillVersionPublished).First(&version).Error; err != nil {
		return nil, errors.New("published skill version is unavailable")
	}
	if !presetSupportsOutput(&version, outputType) {
		return nil, errors.New("skill is incompatible with this output")
	}
	if !containsString(model.JSONStrings(version.EntryPoints, nil), surface) {
		return nil, errors.New("skill is unavailable on this entry point")
	}
	if targetType == "" {
		targetType = "*"
	}
	bindingDefaults := "{}"
	matched := false
	if strings.TrimSpace(version.BindingsJSON) != "" {
		var bindings []skillPlacementBinding
		if json.Unmarshal([]byte(version.BindingsJSON), &bindings) != nil {
			return nil, errors.New("skill placement configuration is invalid")
		}
		if binding := resolveSkillPlacement(bindings, surface, targetType); binding != nil {
			matched = true
			if len(binding.Defaults) > 0 {
				bindingDefaults = string(binding.Defaults)
			}
		}
	} else {
		var binding model.SkillSurfaceBinding
		err := db.WithContext(ctx).Where("skill_id = ? AND surface = ? AND target_type IN ?", skill.ID, surface, []string{"*", targetType}).
			Order(clause.Expr{SQL: "CASE WHEN target_type = ? THEN 0 ELSE 1 END, sort_order ASC, id ASC", Vars: []any{targetType}, WithoutParentheses: true}).First(&binding).Error
		if err == nil && binding.Enabled {
			matched = true
			bindingDefaults = binding.Defaults
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
	}
	if !matched {
		return nil, errors.New("skill is not enabled for this target type")
	}
	prompt, err := expandPublishedSkillPrompt(ctx, db, &version)
	if err != nil {
		return nil, err
	}
	defaults, err := mergeSkillInput(version.DefaultParams, bindingDefaults, nil)
	if err != nil {
		return nil, err
	}
	configuredModel, err := compatiblePresetModel(ctx, db, version.ModelID, outputType)
	if err != nil {
		return nil, err
	}
	if defaultModel, ok := defaults["modelId"].(string); ok {
		compatibleDefault, resolveErr := compatiblePresetModel(ctx, db, defaultModel, outputType)
		if resolveErr != nil {
			return nil, resolveErr
		}
		if compatibleDefault == "" {
			delete(defaults, "modelId")
		} else {
			defaults["modelId"] = compatibleDefault
		}
	}
	return &PublishedPreset{SkillID: skill.ID, VersionID: version.ID, Prompt: prompt, ModelID: configuredModel, Defaults: defaults}, nil
}

func modelSupportsSkillOutput(modelType, outputType string) bool {
	modelType = strings.ToLower(strings.TrimSpace(modelType))
	outputType = strings.ToLower(strings.TrimSpace(outputType))
	if outputType == "file" {
		outputType = "text"
	}
	return modelType != "" && modelType == outputType
}

// A preset's fixed/default model is only a hint for declared outputs that the
// model can actually generate. Multi-output presets fall back to the caller's
// compatible model for their other modalities.
func compatiblePresetModel(ctx context.Context, db *gorm.DB, raw, outputType string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", nil
	}
	resolved, err := newRepo(db).findModel(ctx, raw)
	if err != nil {
		return "", err
	}
	if resolved == nil || !resolved.Enabled || !modelSupportsSkillOutput(resolved.Type, outputType) {
		return "", nil
	}
	return raw, nil
}

func presetSupportsOutput(version *model.SkillVersion, outputType string) bool {
	if version == nil || version.Kind != model.SkillKindPreset {
		return false
	}
	want := strings.ToLower(strings.TrimSpace(outputType))
	if want == "" {
		return false
	}
	for _, available := range model.JSONStrings(version.OutputTypes, []string{version.PrimaryOutputType}) {
		if strings.ToLower(strings.TrimSpace(available)) == want {
			return true
		}
	}
	return false
}

// expandPublishedSkillPrompt expands only the two server-controlled package
// references supported by the admin validator. Files are pinned to versionID;
// no filesystem or network lookup is performed at execution time.
func expandPublishedSkillPrompt(ctx context.Context, db *gorm.DB, version *model.SkillVersion) (string, error) {
	if version == nil {
		return "", errors.New("skill version is missing")
	}
	var files []model.SkillFile
	if err := db.WithContext(ctx).Where("skill_version_id = ?", version.ID).Find(&files).Error; err != nil {
		return "", err
	}
	contents := make(map[string]string, len(files))
	for i := range files {
		contents[files[i].Path] = files[i].Content
	}
	primary := strings.TrimSpace(version.PrimaryFilePath)
	primaryContent := ""
	if primary != "" {
		var exists bool
		primaryContent, exists = contents[primary]
		if !exists {
			return "", errors.New("primary skill file is missing")
		}
	}
	result := version.PromptTemplate
	if primary != "" {
		result = primaryContent
	}
	if len(result) > maxExpandedSkillPrompt {
		return "", errors.New("expanded skill prompt is too large")
	}
	for depth := 0; depth < 8 && strings.Contains(result, "{{skill."); depth++ {
		changed := false
		if strings.Contains(result, "{{skill.primary}}") {
			result = strings.ReplaceAll(result, "{{skill.primary}}", primaryContent)
			changed = true
		}
		var expansionErr error
		result = pinnedSkillFilePattern.ReplaceAllStringFunc(result, func(token string) string {
			if expansionErr != nil {
				return token
			}
			match := pinnedSkillFilePattern.FindStringSubmatch(token)
			ref, err := resolvePinnedSkillPath(match[1], primary, contents)
			if err != nil {
				expansionErr = err
				return token
			}
			changed = true
			return contents[ref]
		})
		if expansionErr != nil {
			return "", expansionErr
		}
		if len(result) > maxExpandedSkillPrompt {
			return "", errors.New("expanded skill prompt is too large")
		}
		if !changed {
			break
		}
	}
	if strings.Contains(result, "{{skill.") {
		return "", errors.New("skill prompt has an unknown or cyclic reference")
	}
	return result, nil
}

func resolvePinnedSkillPath(raw, primary string, contents map[string]string) (string, error) {
	ref := strings.TrimSpace(strings.ReplaceAll(raw, "\\", "/"))
	if ref == "" || strings.HasPrefix(ref, "/") || path.Clean(ref) != ref || ref == "." || ref == ".." || strings.HasPrefix(ref, "../") {
		return "", errors.New("invalid skill file reference")
	}
	if _, ok := contents[ref]; ok {
		return ref, nil
	}
	if primary != "" {
		relative := path.Clean(path.Join(path.Dir(primary), ref))
		if relative != "." && relative != ".." && !strings.HasPrefix(relative, "../") {
			if _, ok := contents[relative]; ok {
				return relative, nil
			}
		}
	}
	return "", errors.New("skill file reference is missing")
}

func mergeSkillInput(versionDefaults, bindingDefaults string, user map[string]any) (map[string]any, error) {
	merged := map[string]any{}
	for _, raw := range []string{versionDefaults, bindingDefaults} {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			continue
		}
		var values map[string]any
		if json.Unmarshal([]byte(raw), &values) != nil || values == nil {
			return nil, errors.New("invalid skill defaults")
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
