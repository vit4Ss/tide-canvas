package model

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestDefaultCanvasNodeFeaturesConfig(t *testing.T) {
	config := DefaultCanvasNodeFeaturesConfig()
	if config.Version != CanvasNodeFeaturesVersion {
		t.Fatalf("version = %d, want %d", config.Version, CanvasNodeFeaturesVersion)
	}
	if len(config.NodeTypes) != len(CanonicalCanvasNodeTypes) {
		t.Fatalf("node type count = %d, want %d", len(config.NodeTypes), len(CanonicalCanvasNodeTypes))
	}

	byKey := canvasNodeConfigByKey(config.NodeTypes)
	if !reflect.DeepEqual(byKey["character"].Features, characterNodeDefaultFeatures) {
		t.Errorf("character features = %#v, want %#v", byKey["character"].Features, characterNodeDefaultFeatures)
	}
	for _, key := range []string{"scene", "image"} {
		if !reflect.DeepEqual(byKey[key].Features, imageNodeDefaultFeatures) {
			t.Errorf("%s features = %#v, want %#v", key, byKey[key].Features, imageNodeDefaultFeatures)
		}
	}
	if !reflect.DeepEqual(byKey["video"].Features, videoNodeDefaultFeatures) {
		t.Errorf("video features = %#v, want %#v", byKey["video"].Features, videoNodeDefaultFeatures)
	}
	for _, key := range []string{"3d", "scene_3d", "text", "audio", "script"} {
		if features := byKey[key].Features; features == nil || len(features) != 0 {
			t.Errorf("%s features = %#v, want explicit empty", key, features)
		}
	}
	for key, item := range byKey {
		if containsString(item.Features, "skill.launcher") {
			t.Errorf("%s defaults still expose retired skill.launcher", key)
		}
	}
	if _, exists := canvasNodeFeatureByKey["skill.launcher"]; exists {
		t.Error("retired skill.launcher is still exposed by the admin feature catalog")
	}

	wantPanoramaSequence := append([]string{"image.panorama"}, panoramaNodeFeatures...)
	for _, key := range []string{"character", "scene", "image"} {
		features := byKey[key].Features
		panoramaIndex := -1
		for index, feature := range features {
			if feature == "image.panorama" {
				panoramaIndex = index
				break
			}
		}
		if panoramaIndex < 0 || panoramaIndex+len(wantPanoramaSequence) > len(features) {
			t.Fatalf("%s defaults missing panorama capability sequence: %#v", key, features)
		}
		if got := features[panoramaIndex : panoramaIndex+len(wantPanoramaSequence)]; !reflect.DeepEqual(got, wantPanoramaSequence) {
			t.Errorf("%s panorama sequence = %#v, want %#v", key, got, wantPanoramaSequence)
		}
	}
}

func TestStoredCanvasNodeFeaturesConfigMigratesV4PanoramaControlsInPlace(t *testing.T) {
	raw := `{"version":4,"nodeTypes":[{"key":"image","enabled":true,"sortOrder":4,"features":["media.preview","image.panorama","media.download"]}]}`

	got := StoredCanvasNodeFeaturesConfig(raw)
	features := canvasNodeConfigByKey(got.NodeTypes)["image"].Features
	want := []string{
		"media.preview",
		"image.panorama",
		"image.panoramaCapture",
		"image.panoramaCaptureGrid",
		"image.panoramaGuide",
		"image.panoramaReset",
		"media.download",
	}
	if !reflect.DeepEqual(features, want) {
		t.Fatalf("migrated V4 panorama features = %#v, want %#v", features, want)
	}
}

func TestStoredCanvasNodeFeaturesConfigPreservesV4PanoramaOptOut(t *testing.T) {
	raw := `{"version":4,"nodeTypes":[{"key":"image","enabled":true,"sortOrder":4,"features":["media.preview","media.download"]},{"key":"scene","enabled":true,"sortOrder":1,"features":[]}]}`

	got := StoredCanvasNodeFeaturesConfig(raw)
	byKey := canvasNodeConfigByKey(got.NodeTypes)
	if want := []string{"media.preview", "media.download"}; !reflect.DeepEqual(byKey["image"].Features, want) {
		t.Fatalf("V4 image panorama opt-out = %#v, want %#v", byKey["image"].Features, want)
	}
	if features := byKey["scene"].Features; features == nil || len(features) != 0 {
		t.Fatalf("V4 explicit empty scene features = %#v, want explicit empty", features)
	}
}

func TestStoredCanvasNodeFeaturesConfigMigratesV9AnnotateInPlace(t *testing.T) {
	raw := `{"version":9,"nodeTypes":[{"key":"image","enabled":true,"sortOrder":5,"features":["media.preview","image.rotate","media.download"]},{"key":"character","enabled":true,"sortOrder":0,"features":["media.preview"]},{"key":"video","enabled":true,"sortOrder":6,"features":["media.preview"]}]}`

	got := StoredCanvasNodeFeaturesConfig(raw)
	if got.Version != CanvasNodeFeaturesVersion {
		t.Fatalf("version = %d, want %d", got.Version, CanvasNodeFeaturesVersion)
	}
	byKey := canvasNodeConfigByKey(got.NodeTypes)
	want := []string{"media.preview", "image.rotate", "image.annotate", "media.download"}
	if !reflect.DeepEqual(byKey["image"].Features, want) {
		t.Fatalf("migrated V9 image features = %#v, want %#v", byKey["image"].Features, want)
	}
	// 锚点(image.rotate)不存在 = 管理员退订了本地栅格编辑组:不插入。
	if want := []string{"media.preview"}; !reflect.DeepEqual(byKey["character"].Features, want) {
		t.Fatalf("V9 character without anchor = %#v, want untouched %#v", byKey["character"].Features, want)
	}
	if want := []string{"media.preview"}; !reflect.DeepEqual(byKey["video"].Features, want) {
		t.Fatalf("V9 video (non-image renderer) = %#v, want untouched %#v", byKey["video"].Features, want)
	}
}

func TestStoredCanvasNodeFeaturesConfigMigratesV8ThroughV9(t *testing.T) {
	// V8 文档必须逐级走完 V8→V9→V10:3D 节点插入之外,image.rotate 锚点后也要
	// 拿到手绘标注(此前 V8 迁移直接跳到最终版本,会绕过后续新增)。
	raw := `{"version":8,"nodeTypes":[{"key":"image","enabled":true,"sortOrder":5,"features":["image.rotate"]},{"key":"scene_3d","enabled":true,"sortOrder":3,"features":[]}]}`

	got := StoredCanvasNodeFeaturesConfig(raw)
	if got.Version != CanvasNodeFeaturesVersion {
		t.Fatalf("version = %d, want %d", got.Version, CanvasNodeFeaturesVersion)
	}
	byKey := canvasNodeConfigByKey(got.NodeTypes)
	if want := []string{"image.rotate", "image.annotate"}; !reflect.DeepEqual(byKey["image"].Features, want) {
		t.Fatalf("V8 chained migration image features = %#v, want %#v", byKey["image"].Features, want)
	}
	if _, ok := byKey["3d"]; !ok {
		t.Fatal("V8 chained migration must still insert the 3d node")
	}
}

func TestNormalizeCanvasNodeFeaturesConfigPreservesGranularPanoramaPolicyOrder(t *testing.T) {
	input := CanvasNodeFeaturesConfig{
		Version: CanvasNodeFeaturesVersion,
		NodeTypes: []CanvasNodeTypeConfig{
			{
				Key:       "image",
				Enabled:   true,
				SortOrder: 4,
				Features: []string{
					"image.panoramaReset",
					"media.download",
					"image.panoramaCapture",
				},
			},
		},
	}

	got, err := NormalizeCanvasNodeFeaturesConfig(input)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"image.panoramaReset", "media.download", "image.panoramaCapture"}
	if features := canvasNodeConfigByKey(got.NodeTypes)["image"].Features; !reflect.DeepEqual(features, want) {
		t.Fatalf("granular panorama policy = %#v, want exact order %#v", features, want)
	}
}

func TestStoredCanvasNodeFeaturesConfigMigratesUntouchedV3DefaultsWithoutRetiredLauncher(t *testing.T) {
	input := CanvasNodeFeaturesConfig{Version: canvasNodeFeaturesV3}
	for _, def := range CanonicalCanvasNodeTypes {
		var features []string
		switch def.Key {
		case "character":
			features = cloneStrings(canvasNodeV3CharacterDefaultFeatures)
		case "scene", "image":
			features = cloneStrings(canvasNodeV3ImageDefaultFeatures)
		case "video":
			features = cloneStrings(canvasNodeV3VideoDefaultFeatures)
		default:
			features = []string{}
		}
		input.NodeTypes = append(input.NodeTypes, CanvasNodeTypeConfig{Key: def.Key, Enabled: def.DefaultEnabled, SortOrder: def.DefaultSortOrder, Features: features})
	}
	raw, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	got := StoredCanvasNodeFeaturesConfig(string(raw))
	for key, item := range canvasNodeConfigByKey(got.NodeTypes) {
		if containsString(item.Features, "skill.launcher") {
			t.Errorf("%s retained retired skill.launcher after V3 migration", key)
		}
	}
}

func TestStoredCanvasNodeFeaturesConfigMigratesV5ByRemovingOnlyRetiredLauncher(t *testing.T) {
	raw := `{"version":5,"nodeTypes":[` +
		`{"key":"image","enabled":false,"sortOrder":41,"features":["media.preview"," skill.launcher ","image.panorama","media.download"]},` +
		`{"key":"text","enabled":true,"sortOrder":3,"features":["skill.launcher"]},` +
		`{"key":"scene","enabled":true,"sortOrder":1,"features":[]}` +
		`]}`

	got := StoredCanvasNodeFeaturesConfig(raw)
	if got.Version != CanvasNodeFeaturesVersion {
		t.Fatalf("version = %d, want %d", got.Version, CanvasNodeFeaturesVersion)
	}
	byKey := canvasNodeConfigByKey(got.NodeTypes)
	image := byKey["image"]
	if image.Enabled || image.SortOrder != 41 {
		t.Fatalf("custom image policy was replaced during V5 migration: %#v", image)
	}
	wantImage := []string{"media.preview", "image.panorama", "media.download"}
	if !reflect.DeepEqual(image.Features, wantImage) {
		t.Fatalf("V5 image features = %#v, want %#v", image.Features, wantImage)
	}
	for _, key := range []string{"text", "scene"} {
		if features := byKey[key].Features; features == nil || len(features) != 0 {
			t.Fatalf("V5 %s features = %#v, want preserved explicit empty", key, features)
		}
	}
}

func TestStoredCanvasNodeFeaturesConfigPreservesCustomizedV3EmptyPolicy(t *testing.T) {
	raw := `{"version":3,"nodeTypes":[{"key":"text","enabled":true,"sortOrder":3,"features":[]}]}`
	got := StoredCanvasNodeFeaturesConfig(raw)
	if features := canvasNodeConfigByKey(got.NodeTypes)["text"].Features; len(features) != 0 {
		t.Fatalf("customized V3 text features = %#v, want explicit empty", features)
	}
}

func TestStoredCanvasNodeFeaturesConfigMigratesV6DefaultVideoWithClipReshoot(t *testing.T) {
	raw := `{"version":6,"nodeTypes":[{"key":"video","enabled":true,"sortOrder":5,"features":["media.replace","media.download","media.preview"]}]}`

	got := StoredCanvasNodeFeaturesConfig(raw)
	features := canvasNodeConfigByKey(got.NodeTypes)["video"].Features
	if !reflect.DeepEqual(features, videoNodeDefaultFeatures) {
		t.Fatalf("migrated V6 video features = %#v, want %#v", features, videoNodeDefaultFeatures)
	}
}

func TestStoredCanvasNodeFeaturesConfigPreservesCustomizedV6VideoPolicy(t *testing.T) {
	raw := `{"version":6,"nodeTypes":[{"key":"video","enabled":true,"sortOrder":5,"features":["media.preview"]}]}`

	got := StoredCanvasNodeFeaturesConfig(raw)
	features := canvasNodeConfigByKey(got.NodeTypes)["video"].Features
	want := []string{"media.preview"}
	if !reflect.DeepEqual(features, want) {
		t.Fatalf("customized V6 video features = %#v, want %#v", features, want)
	}
}

func TestStoredCanvasNodeFeaturesConfigMigratesV7DefaultVideoWithFrameBreakdown(t *testing.T) {
	raw := `{"version":7,"nodeTypes":[{"key":"video","enabled":true,"sortOrder":5,"features":["video.clipReshoot","media.replace","media.download","media.preview"]}]}`

	got := StoredCanvasNodeFeaturesConfig(raw)
	features := canvasNodeConfigByKey(got.NodeTypes)["video"].Features
	if !reflect.DeepEqual(features, videoNodeDefaultFeatures) {
		t.Fatalf("migrated V7 video features = %#v, want %#v", features, videoNodeDefaultFeatures)
	}
}

func TestStoredCanvasNodeFeaturesConfigPreservesCustomizedV7VideoPolicy(t *testing.T) {
	raw := `{"version":7,"nodeTypes":[{"key":"video","enabled":true,"sortOrder":5,"features":["video.clipReshoot","media.preview"]}]}`

	got := StoredCanvasNodeFeaturesConfig(raw)
	features := canvasNodeConfigByKey(got.NodeTypes)["video"].Features
	want := []string{"video.clipReshoot", "media.preview"}
	if !reflect.DeepEqual(features, want) {
		t.Fatalf("customized V7 video features = %#v, want %#v", features, want)
	}
}

func TestStoredCanvasNodeFeaturesConfigMigratesV8ByInserting3DBeforeDirector(t *testing.T) {
	raw := `{"version":8,"nodeTypes":[` +
		`{"key":"character","enabled":true,"sortOrder":0,"features":[]},` +
		`{"key":"scene","enabled":true,"sortOrder":1,"features":[]},` +
		`{"key":"scene_3d","enabled":false,"sortOrder":2,"features":[]},` +
		`{"key":"text","enabled":true,"sortOrder":3,"features":[]},` +
		`{"key":"image","enabled":true,"sortOrder":4,"features":[]},` +
		`{"key":"video","enabled":true,"sortOrder":5,"features":["media.preview"]},` +
		`{"key":"audio","enabled":true,"sortOrder":6,"features":[]},` +
		`{"key":"script","enabled":true,"sortOrder":7,"features":[]}` +
		`]}`

	got := StoredCanvasNodeFeaturesConfig(raw)
	byKey := canvasNodeConfigByKey(got.NodeTypes)
	wantOrder := map[string]int{
		"character": 0, "scene": 1, "3d": 2, "scene_3d": 3,
		"text": 4, "image": 5, "video": 6, "audio": 7, "script": 8,
	}
	for key, want := range wantOrder {
		if byKey[key].SortOrder != want {
			t.Errorf("%s sort order = %d, want %d", key, byKey[key].SortOrder, want)
		}
	}
	if byKey["scene_3d"].Enabled {
		t.Error("V8 Director enabled policy was not preserved")
	}
	if !reflect.DeepEqual(byKey["video"].Features, []string{"media.preview"}) {
		t.Errorf("V8 video policy changed: %#v", byKey["video"].Features)
	}
}

func TestCharacterOnlyReceivesNewImageFeaturesByDefault(t *testing.T) {
	newFeatures := []string{
		"image.subjectTurnaround",
		"image.subjectCloseup",
		"image.expressionGrid",
		"image.makeupAdjust",
		"image.expressionAdjust",
		"image.portraitTexture",
	}
	byKey := canvasNodeConfigByKey(DefaultCanvasNodeFeaturesConfig().NodeTypes)

	for _, feature := range newFeatures {
		definition, exists := canvasNodeFeatureByKey[feature]
		if !exists {
			t.Errorf("feature %q is missing from catalog", feature)
			continue
		}
		if !reflect.DeepEqual(definition.SupportedRenderers, []string{"image"}) {
			t.Errorf("feature %q renderers = %#v, want image", feature, definition.SupportedRenderers)
		}
		if !containsString(byKey["character"].Features, feature) {
			t.Errorf("character defaults missing feature %q", feature)
		}
		for _, key := range []string{"scene", "image"} {
			if containsString(byKey[key].Features, feature) {
				t.Errorf("%s unexpectedly has feature %q by default", key, feature)
			}
		}
	}
}

func TestStoredCanvasNodeFeaturesConfigMigratesV1ToCurrentVersion(t *testing.T) {
	raw := `{"version":1,"nodeTypes":[` +
		`{"key":"scene","enabled":false,"sortOrder":3,"features":["media.preview"]},` +
		`{"key":"character","enabled":false,"sortOrder":8,"features":["media.preview","image.panorama"]},` +
		`{"key":"image","enabled":true,"sortOrder":4,"features":[]}` +
		`]}`

	got := StoredCanvasNodeFeaturesConfig(raw)
	if got.Version != CanvasNodeFeaturesVersion {
		t.Fatalf("version = %d, want %d", got.Version, CanvasNodeFeaturesVersion)
	}
	byKey := canvasNodeConfigByKey(got.NodeTypes)
	character := byKey["character"]
	if character.Enabled {
		t.Error("character enabled = true, want preserved false")
	}
	if character.SortOrder != 8 {
		t.Errorf("character sort order = %d, want preserved 8", character.SortOrder)
	}
	wantCharacterFeatures := append(
		cloneStrings(canvasNodeV2CharacterFeatures),
		"media.preview",
		"image.panorama",
	)
	wantCharacterFeatures = append(wantCharacterFeatures, panoramaNodeFeatures...)
	if !reflect.DeepEqual(character.Features, wantCharacterFeatures) {
		t.Errorf("character features = %#v, want %#v", character.Features, wantCharacterFeatures)
	}

	scene := byKey["scene"]
	if scene.Enabled || scene.SortOrder != 3 || !reflect.DeepEqual(scene.Features, []string{"media.preview"}) {
		t.Errorf("scene policy changed during migration: %#v", scene)
	}
	image := byKey["image"]
	if image.Features == nil || len(image.Features) != 0 {
		t.Errorf("image features = %#v, want preserved explicit empty", image.Features)
	}
}

func TestStoredCanvasNodeFeaturesConfigPreservesV2ExplicitEmptyCharacter(t *testing.T) {
	raw := `{"version":2,"nodeTypes":[{"key":"character","enabled":true,"sortOrder":0,"features":[]}]}`

	got := StoredCanvasNodeFeaturesConfig(raw)
	character := canvasNodeConfigByKey(got.NodeTypes)["character"]
	if character.Features == nil || len(character.Features) != 0 {
		t.Fatalf("character features = %#v, want explicit empty V2 slice", character.Features)
	}
}

func TestStoredCanvasNodeFeaturesConfigMigratesV2DefaultsToV3(t *testing.T) {
	v2CharacterDefaults := append(cloneStrings(canvasNodeV2CharacterFeatures), canvasNodeV2ImageDefaultFeatures...)
	input := CanvasNodeFeaturesConfig{
		Version: canvasNodeFeaturesV2,
		NodeTypes: []CanvasNodeTypeConfig{
			{Key: "character", Enabled: true, SortOrder: 0, Features: v2CharacterDefaults},
			{Key: "scene", Enabled: true, SortOrder: 1, Features: cloneStrings(canvasNodeV2ImageDefaultFeatures)},
			{Key: "image", Enabled: true, SortOrder: 4, Features: cloneStrings(canvasNodeV2ImageDefaultFeatures)},
		},
	}
	rawBytes, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}

	got := StoredCanvasNodeFeaturesConfig(string(rawBytes))
	if got.Version != CanvasNodeFeaturesVersion {
		t.Fatalf("version = %d, want %d", got.Version, CanvasNodeFeaturesVersion)
	}
	byKey := canvasNodeConfigByKey(got.NodeTypes)
	if !reflect.DeepEqual(byKey["character"].Features, characterNodeDefaultFeatures) {
		t.Errorf("character features = %#v, want %#v", byKey["character"].Features, characterNodeDefaultFeatures)
	}
	for _, key := range []string{"scene", "image"} {
		if !reflect.DeepEqual(byKey[key].Features, imageNodeDefaultFeatures) {
			t.Errorf("%s features = %#v, want %#v", key, byKey[key].Features, imageNodeDefaultFeatures)
		}
	}
}

func TestStoredCanvasNodeFeaturesConfigPreservesCustomizedV2Policy(t *testing.T) {
	raw := `{"version":2,"nodeTypes":[{"key":"character","enabled":true,"sortOrder":0,"features":["media.preview","image.subjectCloseup"]}]}`

	got := StoredCanvasNodeFeaturesConfig(raw)
	character := canvasNodeConfigByKey(got.NodeTypes)["character"]
	want := []string{"media.preview", "image.subjectCloseup"}
	if !reflect.DeepEqual(character.Features, want) {
		t.Fatalf("character features = %#v, want customized policy %#v", character.Features, want)
	}
}

func TestNewCharacterFeaturesCanBeAssignedToAnyImageRendererNode(t *testing.T) {
	for _, nodeKey := range []string{"character", "scene", "image"} {
		input := CanvasNodeFeaturesConfig{
			Version: CanvasNodeFeaturesVersion,
			NodeTypes: []CanvasNodeTypeConfig{
				{
					Key:       nodeKey,
					Enabled:   true,
					SortOrder: 0,
					Features:  []string{"image.subjectTurnaround", "image.subjectCloseup", "image.portraitTexture", "image.crop", "image.rotate"},
				},
			},
		}

		normalized, err := NormalizeCanvasNodeFeaturesConfig(input)
		if err != nil {
			t.Fatalf("assigning character features to %s: %v", nodeKey, err)
		}
		got := canvasNodeConfigByKey(normalized.NodeTypes)[nodeKey].Features
		want := []string{"image.subjectTurnaround", "image.subjectCloseup", "image.portraitTexture", "image.crop", "image.rotate"}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("%s features = %#v, want %#v", nodeKey, got, want)
		}
	}
}

func TestNormalizeCanvasNodeFeaturesConfigMergesAndDeduplicates(t *testing.T) {
	input := CanvasNodeFeaturesConfig{
		Version: CanvasNodeFeaturesVersion,
		NodeTypes: []CanvasNodeTypeConfig{
			{
				Key:       " character ",
				Enabled:   false,
				SortOrder: 20,
				Features: []string{
					"media.preview",
					" image.panorama ",
					"media.preview",
				},
			},
		},
	}

	normalized, err := NormalizeCanvasNodeFeaturesConfig(input)
	if err != nil {
		t.Fatalf("NormalizeCanvasNodeFeaturesConfig() error = %v", err)
	}
	if len(normalized.NodeTypes) != len(CanonicalCanvasNodeTypes) {
		t.Fatalf("node type count = %d, want %d", len(normalized.NodeTypes), len(CanonicalCanvasNodeTypes))
	}
	byKey := canvasNodeConfigByKey(normalized.NodeTypes)
	character := byKey["character"]
	if character.Enabled {
		t.Error("character enabled = true, want false")
	}
	if character.SortOrder != 20 {
		t.Errorf("character sort order = %d, want 20", character.SortOrder)
	}
	wantFeatures := []string{"media.preview", "image.panorama"}
	if !reflect.DeepEqual(character.Features, wantFeatures) {
		t.Errorf("character features = %#v, want %#v", character.Features, wantFeatures)
	}
	if _, exists := byKey["scene"]; !exists {
		t.Error("missing canonical scene node merged from defaults")
	}
}

func TestNormalizeCanvasNodeFeaturesConfigPreservesExplicitEmptyFeatures(t *testing.T) {
	input := DefaultCanvasNodeFeaturesConfig()
	for i := range input.NodeTypes {
		if input.NodeTypes[i].Key == "character" {
			input.NodeTypes[i].Features = []string{}
		}
	}

	normalized, err := NormalizeCanvasNodeFeaturesConfig(input)
	if err != nil {
		t.Fatalf("NormalizeCanvasNodeFeaturesConfig() error = %v", err)
	}
	character := canvasNodeConfigByKey(normalized.NodeTypes)["character"]
	if character.Features == nil || len(character.Features) != 0 {
		t.Fatalf("character features = %#v, want explicit empty slice", character.Features)
	}
}

func TestNormalizeCanvasNodeFeaturesConfigRejectsInvalidPolicy(t *testing.T) {
	tests := []struct {
		name   string
		config CanvasNodeFeaturesConfig
	}{
		{
			name:   "version",
			config: CanvasNodeFeaturesConfig{Version: canvasNodeFeaturesV2},
		},
		{
			name: "unknown node",
			config: CanvasNodeFeaturesConfig{Version: CanvasNodeFeaturesVersion, NodeTypes: []CanvasNodeTypeConfig{
				{Key: "custom", Enabled: true},
			}},
		},
		{
			name: "duplicate node",
			config: CanvasNodeFeaturesConfig{Version: CanvasNodeFeaturesVersion, NodeTypes: []CanvasNodeTypeConfig{
				{Key: "image", Enabled: true},
				{Key: "image", Enabled: false},
			}},
		},
		{
			name: "unknown feature",
			config: CanvasNodeFeaturesConfig{Version: CanvasNodeFeaturesVersion, NodeTypes: []CanvasNodeTypeConfig{
				{Key: "image", Enabled: true, Features: []string{"image.not-registered"}},
			}},
		},
		{
			name: "renderer mismatch",
			config: CanvasNodeFeaturesConfig{Version: CanvasNodeFeaturesVersion, NodeTypes: []CanvasNodeTypeConfig{
				{Key: "video", Enabled: true, Features: []string{"image.panorama"}},
			}},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := NormalizeCanvasNodeFeaturesConfig(tt.config); err == nil {
				t.Fatal("NormalizeCanvasNodeFeaturesConfig() error = nil, want validation error")
			}
		})
	}
}

func TestStoredCanvasNodeFeaturesConfigFallsBackOnBadJSON(t *testing.T) {
	want := DefaultCanvasNodeFeaturesConfig()
	badValues := []string{
		"",
		"{",
		`{"version":4,"nodeTypes":[]}`,
		`{"version":2,"nodeTypes":[{"key":"unknown","enabled":true,"sortOrder":0,"features":[]}]}`,
	}
	for _, raw := range badValues {
		got := StoredCanvasNodeFeaturesConfig(raw)
		if !reflect.DeepEqual(got, want) {
			t.Errorf("StoredCanvasNodeFeaturesConfig(%q) = %#v, want defaults %#v", raw, got, want)
		}
	}
}

func TestCanvasNodeTypeVOsIncludeCanonicalMetadata(t *testing.T) {
	vos := CanvasNodeTypeVOs(DefaultCanvasNodeFeaturesConfig())
	if len(vos) != len(CanonicalCanvasNodeTypes) {
		t.Fatalf("VO count = %d, want %d", len(vos), len(CanonicalCanvasNodeTypes))
	}
	if vos[0].Key != "character" || vos[0].Title == "" || vos[0].Renderer != "image" || vos[0].Icon == "" {
		t.Fatalf("first VO missing metadata: %#v", vos[0])
	}
}

func canvasNodeConfigByKey(nodes []CanvasNodeTypeConfig) map[string]CanvasNodeTypeConfig {
	out := make(map[string]CanvasNodeTypeConfig, len(nodes))
	for _, node := range nodes {
		out[node.Key] = node
	}
	return out
}
