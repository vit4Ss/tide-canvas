package model

import (
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// ConfigKeyCanvasNodeFeatures stores the complete canvas node capability policy
// in one sys_config row. Node renderers and executable features remain
// code-registered; the persisted JSON only decides visibility, order and which
// registered features are enabled for each registered node type.
const ConfigKeyCanvasNodeFeatures = "canvas.nodeFeatures.v1"

const CanvasNodeFeaturesVersion = 9

const canvasNodeFeaturesV1 = 1

const canvasNodeFeaturesV2 = 2

const canvasNodeFeaturesV3 = 3

const canvasNodeFeaturesV4 = 4

const canvasNodeFeaturesV5 = 5

const canvasNodeFeaturesV6 = 6

const canvasNodeFeaturesV7 = 7

const canvasNodeFeaturesV8 = 8

const canvasNodeFeaturesDescription = "Canvas node type and toolbar feature policy (versioned JSON)"

// CanvasNodeTypeConfig is the persisted, administrator-editable part of one
// canonical node type.
type CanvasNodeTypeConfig struct {
	Key       string   `json:"key"`
	Enabled   bool     `json:"enabled"`
	SortOrder int      `json:"sortOrder"`
	Features  []string `json:"features"`
}

// CanvasNodeFeaturesConfig is the versioned payload stored in sys_config and
// accepted by the admin update endpoint.
type CanvasNodeFeaturesConfig struct {
	Version   int                    `json:"version"`
	NodeTypes []CanvasNodeTypeConfig `json:"nodeTypes"`
}

// CanvasNodeTypeDefinition is a code-registered node renderer. The default
// fields are server policy and are intentionally not serialized.
type CanvasNodeTypeDefinition struct {
	Key         string `json:"key"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Renderer    string `json:"renderer"`
	Icon        string `json:"icon"`

	DefaultEnabled   bool     `json:"-"`
	DefaultSortOrder int      `json:"-"`
	DefaultFeatures  []string `json:"-"`
}

// CanvasNodeFeatureDefinition is a finite, code-registered toolbar feature.
// supportedRenderers is also the validation boundary for admin updates.
type CanvasNodeFeatureDefinition struct {
	Key                string   `json:"key"`
	Title              string   `json:"title"`
	Description        string   `json:"description"`
	Group              string   `json:"group"`
	SupportedRenderers []string `json:"supportedRenderers"`
}

// CanvasNodeTypeVO combines immutable renderer metadata with its normalized
// administrator policy.
type CanvasNodeTypeVO struct {
	Key         string   `json:"key"`
	Title       string   `json:"title"`
	Description string   `json:"description"`
	Renderer    string   `json:"renderer"`
	Icon        string   `json:"icon"`
	Enabled     bool     `json:"enabled"`
	SortOrder   int      `json:"sortOrder"`
	Features    []string `json:"features"`
}

var canvasNodeV2ImageDefaultFeatures = []string{
	"image.panorama",
	"image.multiAngle",
	"image.relightPanel",
	"image.gridGenerate",
	"tool.upscale",
	"image.gridSplit",
	"media.replace",
	"image.mirror",
	"media.download",
	"media.preview",
}

var canvasNodeV3ImageDefaultFeatures = []string{
	"tool.upscale",
	"image.crop",
	"image.rotate",
	"image.panorama",
	"image.multiAngle",
	"image.relightPanel",
	"image.gridGenerate",
	"image.gridSplit",
	"image.mirror",
	"media.replace",
	"media.download",
	"media.preview",
}

var panoramaNodeFeatures = []string{
	"image.panoramaCapture",
	"image.panoramaCaptureGrid",
	"image.panoramaGuide",
	"image.panoramaReset",
}

var canvasNodeV4ImageDefaultFeatures = append(cloneStrings(canvasNodeV3ImageDefaultFeatures), "skill.launcher")

var imageNodeDefaultFeatures = insertFeaturesAfter(
	canvasNodeV3ImageDefaultFeatures,
	"image.panorama",
	panoramaNodeFeatures,
)

var canvasNodeV2CharacterFeatures = []string{
	"image.subjectCloseup",
	"image.expressionGrid",
	"image.makeupAdjust",
	"image.expressionAdjust",
	"image.portraitTexture",
}

var canvasNodeV3CharacterDefaultFeatures = []string{
	"image.subjectTurnaround",
	"image.subjectCloseup",
	"image.expressionGrid",
	"image.makeupAdjust",
	"image.expressionAdjust",
	"image.portraitTexture",
	"tool.upscale",
	"image.crop",
	"image.rotate",
	"image.panorama",
	"image.multiAngle",
	"image.relightPanel",
	"image.gridGenerate",
	"image.gridSplit",
	"image.mirror",
	"media.replace",
	"media.download",
	"media.preview",
}

var canvasNodeV4CharacterDefaultFeatures = append(cloneStrings(canvasNodeV3CharacterDefaultFeatures), "skill.launcher")

var characterNodeDefaultFeatures = insertFeaturesAfter(
	canvasNodeV3CharacterDefaultFeatures,
	"image.panorama",
	panoramaNodeFeatures,
)

var canvasNodeV3VideoDefaultFeatures = []string{
	"media.replace",
	"media.download",
	"media.preview",
}

var canvasNodeV4VideoDefaultFeatures = append(cloneStrings(canvasNodeV3VideoDefaultFeatures), "skill.launcher")

var canvasNodeV7VideoDefaultFeatures = append([]string{"video.clipReshoot"}, canvasNodeV3VideoDefaultFeatures...)

var videoNodeDefaultFeatures = append([]string{"video.clipReshoot", "video.frameBreakdown"}, canvasNodeV3VideoDefaultFeatures...)

var canvasNodeV4SkillLauncherOnlyDefaultFeatures = []string{"skill.launcher"}

var emptyNodeDefaultFeatures = []string{}

// CanonicalCanvasNodeTypes is the complete set of node renderers implemented by
// the canvas application. Admin configuration cannot add another key because a
// key without a renderer would create an unusable node.
var CanonicalCanvasNodeTypes = []CanvasNodeTypeDefinition{
	{
		Key: "character", Title: "角色", Description: "外貌、服装与姿态设定",
		Renderer: "image", Icon: "user-round", DefaultEnabled: true, DefaultSortOrder: 0,
		DefaultFeatures: characterNodeDefaultFeatures,
	},
	{
		Key: "scene", Title: "场景", Description: "环境、光线与氛围设定",
		Renderer: "image", Icon: "mountain", DefaultEnabled: true, DefaultSortOrder: 1,
		DefaultFeatures: imageNodeDefaultFeatures,
	},
	{
		Key: "3d", Title: "3D", Description: "3D 模型生成与预览",
		Renderer: "3d", Icon: "box", DefaultEnabled: true, DefaultSortOrder: 2,
		DefaultFeatures: emptyNodeDefaultFeatures,
	},
	{
		Key: "scene_3d", Title: "3D 导演台", Description: "角色动作与空间编排",
		Renderer: "scene_3d", Icon: "layers", DefaultEnabled: true, DefaultSortOrder: 3,
		DefaultFeatures: emptyNodeDefaultFeatures,
	},
	{
		Key: "text", Title: "文本", Description: "提示词、脚本说明",
		Renderer: "text", Icon: "align-left", DefaultEnabled: true, DefaultSortOrder: 4,
		DefaultFeatures: emptyNodeDefaultFeatures,
	},
	{
		Key: "image", Title: "图片", Description: "图像生成、参考图编辑",
		Renderer: "image", Icon: "image", DefaultEnabled: true, DefaultSortOrder: 5,
		DefaultFeatures: imageNodeDefaultFeatures,
	},
	{
		Key: "video", Title: "视频", Description: "视频生成、镜头创作",
		Renderer: "video", Icon: "video", DefaultEnabled: true, DefaultSortOrder: 6,
		DefaultFeatures: videoNodeDefaultFeatures,
	},
	{
		Key: "audio", Title: "音频", Description: "音色、配乐与旁白",
		Renderer: "audio", Icon: "audio-lines", DefaultEnabled: true, DefaultSortOrder: 7,
		DefaultFeatures: emptyNodeDefaultFeatures,
	},
	{
		Key: "script", Title: "脚本", Description: "分镜和内容结构",
		Renderer: "script", Icon: "clapperboard", DefaultEnabled: true, DefaultSortOrder: 8,
		DefaultFeatures: emptyNodeDefaultFeatures,
	},
}

// CanvasNodeFeatureCatalog is the finite capability registry exposed to the
// admin editor. A feature may only be assigned to one of its supported
// renderers.
var CanvasNodeFeatureCatalog = []CanvasNodeFeatureDefinition{
	{
		Key: "image.subjectTurnaround", Title: "主体三视图", Description: "基于当前图片生成主体正面、侧面与背面三视图",
		Group: "image", SupportedRenderers: []string{"image"},
	},
	{
		Key: "image.subjectCloseup", Title: "主体特写图", Description: "基于当前图片生成人物、产品等主体的构图与细节特写",
		Group: "image", SupportedRenderers: []string{"image"},
	},
	{
		Key: "image.expressionGrid", Title: "表情九宫格", Description: "生成同一角色的多种表情九宫格",
		Group: "image", SupportedRenderers: []string{"image"},
	},
	{
		Key: "image.makeupAdjust", Title: "妆容调节", Description: "调节角色的妆容风格与细节",
		Group: "image", SupportedRenderers: []string{"image"},
	},
	{
		Key: "image.expressionAdjust", Title: "表情调节", Description: "调节角色的面部表情与情绪",
		Group: "image", SupportedRenderers: []string{"image"},
	},
	{
		Key: "image.portraitTexture", Title: "人像质感", Description: "增强人像皮肤、光影与画面质感",
		Group: "image", SupportedRenderers: []string{"image"},
	},
	{
		Key: "image.panorama", Title: "720° 全景", Description: "打开全景视图并控制观察角度",
		Group: "image", SupportedRenderers: []string{"image"},
	},
	{
		Key: "image.panoramaCapture", Title: "全景当前视角截图", Description: "将 360° 全景当前视角截取为新的图片节点",
		Group: "image", SupportedRenderers: []string{"image"},
	},
	{
		Key: "image.panoramaCaptureGrid", Title: "全景四视角截图", Description: "从 360° 全景截取四个水平主视角并生成图片节点",
		Group: "image", SupportedRenderers: []string{"image"},
	},
	{
		Key: "image.panoramaGuide", Title: "全景构图参考线", Description: "在 360° 全景节点中显示或隐藏构图参考线",
		Group: "image", SupportedRenderers: []string{"image"},
	},
	{
		Key: "image.panoramaReset", Title: "全景复位视角", Description: "将 360° 全景的旋转和缩放复位到初始状态",
		Group: "image", SupportedRenderers: []string{"image"},
	},
	{
		Key: "image.multiAngle", Title: "多角度生成", Description: "基于当前图片生成多角度视图",
		Group: "image", SupportedRenderers: []string{"image"},
	},
	{
		Key: "image.relightPanel", Title: "智能打光", Description: "打开光照方向与强度调节面板",
		Group: "image", SupportedRenderers: []string{"image"},
	},
	{
		Key: "image.gridGenerate", Title: "九宫格生成", Description: "按预设生成分镜宫格",
		Group: "image", SupportedRenderers: []string{"image"},
	},
	{
		Key: "tool.upscale", Title: "超分", Description: "使用超分工具放大到 2K 或 4K",
		Group: "tool", SupportedRenderers: []string{"image"},
	},
	{
		Key: "image.crop", Title: "裁剪", Description: "按指定画幅比例裁剪当前图片并生成派生素材",
		Group: "image", SupportedRenderers: []string{"image"},
	},
	{
		Key: "image.rotate", Title: "旋转", Description: "将当前图片向左、向右或旋转 180 度",
		Group: "image", SupportedRenderers: []string{"image"},
	},
	{
		Key: "image.gridSplit", Title: "宫格切分", Description: "把宫格图片切分为独立素材",
		Group: "image", SupportedRenderers: []string{"image"},
	},
	{
		Key: "video.clipReshoot", Title: "片段重拍", Description: "基于当前视频创建可按时间段描述修改内容的参考视频节点",
		Group: "video", SupportedRenderers: []string{"video"},
	},
	{
		Key: "video.frameBreakdown", Title: "逐帧拉片", Description: "提取视频代表帧并按时间顺序生成分镜组",
		Group: "video", SupportedRenderers: []string{"video"},
	},
	{
		Key: "media.replace", Title: "重新上传", Description: "替换节点当前的媒体文件",
		Group: "media", SupportedRenderers: []string{"image", "video"},
	},
	{
		Key: "image.mirror", Title: "镜像", Description: "水平翻转当前图片",
		Group: "image", SupportedRenderers: []string{"image"},
	},
	{
		Key: "media.download", Title: "下载", Description: "下载节点当前的媒体文件",
		Group: "media", SupportedRenderers: []string{"image", "video"},
	},
	{
		Key: "media.preview", Title: "预览", Description: "全屏预览节点当前的媒体文件",
		Group: "media", SupportedRenderers: []string{"image", "video"},
	},
}

var canonicalCanvasNodeTypeByKey = buildCanvasNodeTypeMap()
var canvasNodeFeatureByKey = buildCanvasNodeFeatureMap()

func buildCanvasNodeTypeMap() map[string]CanvasNodeTypeDefinition {
	out := make(map[string]CanvasNodeTypeDefinition, len(CanonicalCanvasNodeTypes))
	for _, item := range CanonicalCanvasNodeTypes {
		out[item.Key] = item
	}
	return out
}

func buildCanvasNodeFeatureMap() map[string]CanvasNodeFeatureDefinition {
	out := make(map[string]CanvasNodeFeatureDefinition, len(CanvasNodeFeatureCatalog))
	for _, item := range CanvasNodeFeatureCatalog {
		out[item.Key] = item
	}
	return out
}

// DefaultCanvasNodeFeaturesConfig returns a deep copy of the built-in policy.
func DefaultCanvasNodeFeaturesConfig() CanvasNodeFeaturesConfig {
	nodes := make([]CanvasNodeTypeConfig, 0, len(CanonicalCanvasNodeTypes))
	for _, def := range CanonicalCanvasNodeTypes {
		nodes = append(nodes, CanvasNodeTypeConfig{
			Key:       def.Key,
			Enabled:   def.DefaultEnabled,
			SortOrder: def.DefaultSortOrder,
			Features:  cloneStrings(def.DefaultFeatures),
		})
	}
	return CanvasNodeFeaturesConfig{Version: CanvasNodeFeaturesVersion, NodeTypes: nodes}
}

// DefaultCanvasNodeFeaturesJSON serializes the built-in policy for first-boot
// seeding. It cannot fail because the payload contains only primitive values.
func DefaultCanvasNodeFeaturesJSON() string {
	b, _ := json.Marshal(DefaultCanvasNodeFeaturesConfig())
	return string(b)
}

// NormalizeCanvasNodeFeaturesConfig validates an administrator payload against
// the node/feature registries, removes duplicate features, and fills any missing
// canonical node with its default policy. Unknown node or feature keys and
// renderer-incompatible features are rejected.
func NormalizeCanvasNodeFeaturesConfig(input CanvasNodeFeaturesConfig) (CanvasNodeFeaturesConfig, error) {
	if input.Version != CanvasNodeFeaturesVersion {
		return CanvasNodeFeaturesConfig{}, fmt.Errorf("unsupported version %d", input.Version)
	}

	configured := make(map[string]CanvasNodeTypeConfig, len(input.NodeTypes))
	for _, item := range input.NodeTypes {
		key := strings.TrimSpace(item.Key)
		def, ok := canonicalCanvasNodeTypeByKey[key]
		if !ok {
			return CanvasNodeFeaturesConfig{}, fmt.Errorf("unknown node type %q", key)
		}
		if _, duplicate := configured[key]; duplicate {
			return CanvasNodeFeaturesConfig{}, fmt.Errorf("duplicate node type %q", key)
		}

		features := make([]string, 0, len(item.Features))
		seenFeatures := make(map[string]struct{}, len(item.Features))
		for _, rawFeature := range item.Features {
			featureKey := strings.TrimSpace(rawFeature)
			feature, exists := canvasNodeFeatureByKey[featureKey]
			if !exists {
				return CanvasNodeFeaturesConfig{}, fmt.Errorf("unknown feature %q for node type %q", featureKey, key)
			}
			if !containsString(feature.SupportedRenderers, def.Renderer) {
				return CanvasNodeFeaturesConfig{}, fmt.Errorf(
					"feature %q does not support renderer %q for node type %q",
					featureKey, def.Renderer, key,
				)
			}
			if _, duplicate := seenFeatures[featureKey]; duplicate {
				continue
			}
			seenFeatures[featureKey] = struct{}{}
			features = append(features, featureKey)
		}

		configured[key] = CanvasNodeTypeConfig{
			Key:       key,
			Enabled:   item.Enabled,
			SortOrder: item.SortOrder,
			Features:  features,
		}
	}

	canonicalOrder := make(map[string]int, len(CanonicalCanvasNodeTypes))
	normalized := make([]CanvasNodeTypeConfig, 0, len(CanonicalCanvasNodeTypes))
	for index, def := range CanonicalCanvasNodeTypes {
		canonicalOrder[def.Key] = index
		if item, ok := configured[def.Key]; ok {
			normalized = append(normalized, item)
			continue
		}
		normalized = append(normalized, CanvasNodeTypeConfig{
			Key:       def.Key,
			Enabled:   def.DefaultEnabled,
			SortOrder: def.DefaultSortOrder,
			Features:  cloneStrings(def.DefaultFeatures),
		})
	}
	sort.SliceStable(normalized, func(i, j int) bool {
		if normalized[i].SortOrder == normalized[j].SortOrder {
			return canonicalOrder[normalized[i].Key] < canonicalOrder[normalized[j].Key]
		}
		return normalized[i].SortOrder < normalized[j].SortOrder
	})

	return CanvasNodeFeaturesConfig{Version: CanvasNodeFeaturesVersion, NodeTypes: normalized}, nil
}

// StoredCanvasNodeFeaturesConfig parses persisted JSON. Any malformed, unknown
// or renderer-incompatible policy is treated as a bad configuration and falls
// back to the full built-in default, keeping the canvas usable.
func StoredCanvasNodeFeaturesConfig(raw string) CanvasNodeFeaturesConfig {
	var parsed CanvasNodeFeaturesConfig
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		return DefaultCanvasNodeFeaturesConfig()
	}
	if parsed.Version == canvasNodeFeaturesV1 {
		parsed = migrateCanvasNodeFeaturesV1(parsed)
	}
	if parsed.Version == canvasNodeFeaturesV2 {
		parsed = migrateCanvasNodeFeaturesV2(parsed)
	}
	if parsed.Version == canvasNodeFeaturesV3 {
		parsed = migrateCanvasNodeFeaturesV3(parsed)
	}
	if parsed.Version == canvasNodeFeaturesV4 {
		parsed = migrateCanvasNodeFeaturesV4(parsed)
	}
	if parsed.Version == canvasNodeFeaturesV5 {
		parsed = migrateCanvasNodeFeaturesV5(parsed)
	}
	if parsed.Version == canvasNodeFeaturesV6 {
		parsed = migrateCanvasNodeFeaturesV6(parsed)
	}
	if parsed.Version == canvasNodeFeaturesV7 {
		parsed = migrateCanvasNodeFeaturesV7(parsed)
	}
	if parsed.Version == canvasNodeFeaturesV8 {
		parsed = migrateCanvasNodeFeaturesV8(parsed)
	}
	normalized, err := NormalizeCanvasNodeFeaturesConfig(parsed)
	if err != nil {
		return DefaultCanvasNodeFeaturesConfig()
	}
	return normalized
}

// migrateCanvasNodeFeaturesV1 upgrades the read model without mutating the
// persisted sys_config row. V1 predates the character-specific image features,
// so those features are prepended to character while every prior feature keeps
// its relative order. Other node policies are left untouched. A subsequent
// admin save writes the normalized current-version document through the regular save path.
func migrateCanvasNodeFeaturesV1(input CanvasNodeFeaturesConfig) CanvasNodeFeaturesConfig {
	input.Version = canvasNodeFeaturesV2
	for i := range input.NodeTypes {
		if strings.TrimSpace(input.NodeTypes[i].Key) != "character" {
			continue
		}

		features := cloneStrings(canvasNodeV2CharacterFeatures)
		for _, feature := range input.NodeTypes[i].Features {
			trimmed := strings.TrimSpace(feature)
			if containsString(canvasNodeV2CharacterFeatures, trimmed) {
				continue
			}
			features = append(features, feature)
		}
		input.NodeTypes[i].Features = features
		break
	}
	return input
}

// migrateCanvasNodeFeaturesV2 upgrades untouched V2 defaults to the V3 toolbar
// layout. Explicitly empty or customized feature policies stay untouched so an
// administrator's opt-outs and ordering are never silently overridden. Newly
// registered features remain available in the catalog for manual assignment.
func migrateCanvasNodeFeaturesV2(input CanvasNodeFeaturesConfig) CanvasNodeFeaturesConfig {
	input.Version = canvasNodeFeaturesV3
	oldCharacterDefaults := append(cloneStrings(canvasNodeV2CharacterFeatures), canvasNodeV2ImageDefaultFeatures...)
	for i := range input.NodeTypes {
		switch strings.TrimSpace(input.NodeTypes[i].Key) {
		case "character":
			if sameTrimmedStrings(input.NodeTypes[i].Features, oldCharacterDefaults) {
				input.NodeTypes[i].Features = cloneStrings(canvasNodeV3CharacterDefaultFeatures)
			}
		case "scene", "image":
			if sameTrimmedStrings(input.NodeTypes[i].Features, canvasNodeV2ImageDefaultFeatures) {
				input.NodeTypes[i].Features = cloneStrings(canvasNodeV3ImageDefaultFeatures)
			}
		}
	}
	return input
}

// migrateCanvasNodeFeaturesV3 adds the launcher only to untouched V3 defaults.
// Explicitly empty and customized lists remain unchanged.
func migrateCanvasNodeFeaturesV3(input CanvasNodeFeaturesConfig) CanvasNodeFeaturesConfig {
	wholeDocumentIsDefault := isDefaultCanvasNodeFeaturesV3(input)
	input.Version = canvasNodeFeaturesV4
	for i := range input.NodeTypes {
		switch strings.TrimSpace(input.NodeTypes[i].Key) {
		case "character":
			if sameTrimmedStrings(input.NodeTypes[i].Features, canvasNodeV3CharacterDefaultFeatures) {
				input.NodeTypes[i].Features = cloneStrings(canvasNodeV4CharacterDefaultFeatures)
			}
		case "scene", "image":
			if sameTrimmedStrings(input.NodeTypes[i].Features, canvasNodeV3ImageDefaultFeatures) {
				input.NodeTypes[i].Features = cloneStrings(canvasNodeV4ImageDefaultFeatures)
			}
		case "video":
			if sameTrimmedStrings(input.NodeTypes[i].Features, canvasNodeV3VideoDefaultFeatures) {
				input.NodeTypes[i].Features = cloneStrings(canvasNodeV4VideoDefaultFeatures)
			}
		case "scene_3d", "text", "audio", "script":
			if wholeDocumentIsDefault {
				input.NodeTypes[i].Features = cloneStrings(canvasNodeV4SkillLauncherOnlyDefaultFeatures)
			}
		}
	}
	return input
}

// migrateCanvasNodeFeaturesV4 makes the controls that used to be hard-coded
// on 360° image nodes explicit. V4 could only enable or disable the parent
// panorama capability, so a policy containing image.panorama receives the four
// previously implicit controls immediately after it. Policies that opted out
// of panorama (including an explicitly empty list) remain untouched.
func migrateCanvasNodeFeaturesV4(input CanvasNodeFeaturesConfig) CanvasNodeFeaturesConfig {
	input.Version = canvasNodeFeaturesV5
	for i := range input.NodeTypes {
		def, ok := canonicalCanvasNodeTypeByKey[strings.TrimSpace(input.NodeTypes[i].Key)]
		if !ok || def.Renderer != "image" {
			continue
		}
		input.NodeTypes[i].Features = insertFeaturesAfter(
			input.NodeTypes[i].Features,
			"image.panorama",
			panoramaNodeFeatures,
		)
	}
	return input
}

// migrateCanvasNodeFeaturesV5 retires the node-level Skill launcher without
// disturbing any administrator-authored capability order or opt-out. This must
// run before normalization because skill.launcher is no longer in the public
// feature catalog; otherwise a valid V5 document would be rejected wholesale
// and replaced with defaults.
func migrateCanvasNodeFeaturesV5(input CanvasNodeFeaturesConfig) CanvasNodeFeaturesConfig {
	input.Version = canvasNodeFeaturesV6
	for i := range input.NodeTypes {
		features := make([]string, 0, len(input.NodeTypes[i].Features))
		for _, feature := range input.NodeTypes[i].Features {
			if strings.TrimSpace(feature) == "skill.launcher" {
				continue
			}
			features = append(features, feature)
		}
		input.NodeTypes[i].Features = features
	}
	return input
}

// migrateCanvasNodeFeaturesV6 enables clip reshoot for an untouched video
// toolbar. Customized orders and explicit opt-outs stay unchanged; the new
// feature remains available in the admin catalog for manual assignment.
func migrateCanvasNodeFeaturesV6(input CanvasNodeFeaturesConfig) CanvasNodeFeaturesConfig {
	input.Version = canvasNodeFeaturesV7
	for i := range input.NodeTypes {
		if strings.TrimSpace(input.NodeTypes[i].Key) != "video" {
			continue
		}
		if sameTrimmedStrings(input.NodeTypes[i].Features, canvasNodeV3VideoDefaultFeatures) {
			input.NodeTypes[i].Features = cloneStrings(canvasNodeV7VideoDefaultFeatures)
		}
		break
	}
	return input
}

// migrateCanvasNodeFeaturesV7 adds frame breakdown to an untouched V7 video
// toolbar while preserving custom ordering and explicit opt-outs.
func migrateCanvasNodeFeaturesV7(input CanvasNodeFeaturesConfig) CanvasNodeFeaturesConfig {
	input.Version = canvasNodeFeaturesV8
	for i := range input.NodeTypes {
		if strings.TrimSpace(input.NodeTypes[i].Key) != "video" {
			continue
		}
		if sameTrimmedStrings(input.NodeTypes[i].Features, canvasNodeV7VideoDefaultFeatures) {
			input.NodeTypes[i].Features = cloneStrings(videoNodeDefaultFeatures)
		}
		break
	}
	return input
}

// migrateCanvasNodeFeaturesV8 inserts the generated 3D node immediately before
// the Director while preserving every existing node's relative order and policy.
// Moving the Director and later rows by one avoids a duplicate sortOrder in
// persisted V8 documents, which did not know about the new node type.
func migrateCanvasNodeFeaturesV8(input CanvasNodeFeaturesConfig) CanvasNodeFeaturesConfig {
	input.Version = CanvasNodeFeaturesVersion
	for _, item := range input.NodeTypes {
		if strings.TrimSpace(item.Key) == "3d" {
			return input
		}
	}

	insertOrder := 2
	foundDirector := false
	for _, item := range input.NodeTypes {
		if strings.TrimSpace(item.Key) == "scene_3d" {
			insertOrder = item.SortOrder
			foundDirector = true
			break
		}
	}
	if foundDirector {
		for i := range input.NodeTypes {
			if input.NodeTypes[i].SortOrder >= insertOrder {
				input.NodeTypes[i].SortOrder++
			}
		}
	}
	input.NodeTypes = append(input.NodeTypes, CanvasNodeTypeConfig{
		Key: "3d", Enabled: true, SortOrder: insertOrder, Features: []string{},
	})
	return input
}

func isDefaultCanvasNodeFeaturesV3(input CanvasNodeFeaturesConfig) bool {
	if len(input.NodeTypes) != len(CanonicalCanvasNodeTypes) {
		return false
	}
	byKey := make(map[string]CanvasNodeTypeConfig, len(input.NodeTypes))
	for _, item := range input.NodeTypes {
		byKey[strings.TrimSpace(item.Key)] = item
	}
	for _, def := range CanonicalCanvasNodeTypes {
		item, ok := byKey[def.Key]
		if !ok || item.Enabled != def.DefaultEnabled || item.SortOrder != def.DefaultSortOrder {
			return false
		}
		var expected []string
		switch def.Key {
		case "character":
			expected = canvasNodeV3CharacterDefaultFeatures
		case "scene", "image":
			expected = canvasNodeV3ImageDefaultFeatures
		case "video":
			expected = canvasNodeV3VideoDefaultFeatures
		default:
			expected = []string{}
		}
		if !sameTrimmedStrings(item.Features, expected) {
			return false
		}
	}
	return true
}

// CanvasNodeTypeVOs joins immutable renderer metadata onto normalized policy.
func CanvasNodeTypeVOs(config CanvasNodeFeaturesConfig) []CanvasNodeTypeVO {
	vos := make([]CanvasNodeTypeVO, 0, len(config.NodeTypes))
	for _, item := range config.NodeTypes {
		def, ok := canonicalCanvasNodeTypeByKey[item.Key]
		if !ok {
			continue
		}
		vos = append(vos, CanvasNodeTypeVO{
			Key:         item.Key,
			Title:       def.Title,
			Description: def.Description,
			Renderer:    def.Renderer,
			Icon:        def.Icon,
			Enabled:     item.Enabled,
			SortOrder:   item.SortOrder,
			Features:    cloneStrings(item.Features),
		})
	}
	return vos
}

// CanvasNodeFeatureCatalogCopy returns a deep copy safe for response encoding.
func CanvasNodeFeatureCatalogCopy() []CanvasNodeFeatureDefinition {
	out := make([]CanvasNodeFeatureDefinition, 0, len(CanvasNodeFeatureCatalog))
	for _, item := range CanvasNodeFeatureCatalog {
		item.SupportedRenderers = cloneStrings(item.SupportedRenderers)
		out = append(out, item)
	}
	return out
}

// LoadCanvasNodeFeaturesConfig reads the single policy row. A missing row or a
// bad stored value falls back to defaults; only a datastore error is returned.
func LoadCanvasNodeFeaturesConfig(db *gorm.DB) (CanvasNodeFeaturesConfig, error) {
	var row SysConfig
	err := db.Where("config_key = ?", ConfigKeyCanvasNodeFeatures).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return DefaultCanvasNodeFeaturesConfig(), nil
	}
	if err != nil {
		return CanvasNodeFeaturesConfig{}, err
	}
	return StoredCanvasNodeFeaturesConfig(row.ConfigValue), nil
}

// SaveCanvasNodeFeaturesConfig validates, normalizes and atomically upserts the
// single sys_config policy row.
func SaveCanvasNodeFeaturesConfig(db *gorm.DB, input CanvasNodeFeaturesConfig) (CanvasNodeFeaturesConfig, error) {
	normalized, err := NormalizeCanvasNodeFeaturesConfig(input)
	if err != nil {
		return CanvasNodeFeaturesConfig{}, err
	}
	value, err := json.Marshal(normalized)
	if err != nil {
		return CanvasNodeFeaturesConfig{}, err
	}
	row := SysConfig{
		ConfigKey:   ConfigKeyCanvasNodeFeatures,
		ConfigValue: string(value),
		Group:       "canvas",
		Description: canvasNodeFeaturesDescription,
	}
	if err := db.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "config_key"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"config_value", "config_group", "description", "update_time", "deleted",
		}),
	}).Create(&row).Error; err != nil {
		return CanvasNodeFeaturesConfig{}, err
	}
	return normalized, nil
}

func containsString(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

func sameTrimmedStrings(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if strings.TrimSpace(left[index]) != right[index] {
			return false
		}
	}
	return true
}

func cloneStrings(values []string) []string {
	if len(values) == 0 {
		return []string{}
	}
	return append([]string(nil), values...)
}

// insertFeaturesAfter preserves the administrator-authored relative order and
// inserts only missing values. If the anchor is absent, the input is copied
// unchanged so explicit opt-outs remain meaningful.
func insertFeaturesAfter(values []string, anchor string, additions []string) []string {
	existing := make(map[string]struct{}, len(values)+len(additions))
	anchorPresent := false
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		existing[trimmed] = struct{}{}
		if trimmed == anchor {
			anchorPresent = true
		}
	}
	if !anchorPresent {
		return cloneStrings(values)
	}

	missing := make([]string, 0, len(additions))
	for _, addition := range additions {
		if _, ok := existing[addition]; ok {
			continue
		}
		missing = append(missing, addition)
	}
	if len(missing) == 0 {
		return cloneStrings(values)
	}

	out := make([]string, 0, len(values)+len(missing))
	for _, value := range values {
		out = append(out, value)
		if strings.TrimSpace(value) == anchor {
			out = append(out, missing...)
		}
	}
	return out
}
