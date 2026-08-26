package ai

import (
	"encoding/json"
	"fmt"
	"strings"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/relaymedia"
)

type threeDReferenceView struct {
	viewType    string
	imageURL    string
	imageBase64 string
}

func configured3DMultiViewLimit(raw string) int {
	const relayMaximum = relaymedia.MaxThreeDMultiViewImages
	var cfg struct {
		MaxMultiViewImages int `json:"max3DMultiViewImages"`
	}
	if json.Unmarshal([]byte(raw), &cfg) != nil || cfg.MaxMultiViewImages < 1 {
		return relayMaximum
	}
	if cfg.MaxMultiViewImages > relayMaximum {
		return relayMaximum
	}
	return cfg.MaxMultiViewImages
}

// validate3DReferenceInput rejects invalid 3D inputs before task creation and
// point charging. Provider and relay validation remain as defense in depth.
func validate3DReferenceInput(dto *generateDTO, m *model.AiModel) error {
	if dto == nil || !strings.EqualFold(strings.TrimSpace(dto.Handler), "generate_3d") {
		return nil
	}
	input := decodeInput(dto.Input)
	prompt := inputStr(input, "prompt")
	imageURL := inputStr(input, "imageUrl", "image_url", "sourceImage")
	views, malformed := parseThreeDReferenceViews(input)
	if malformed {
		return skillPlacementError{message: "3D 多视图参数格式无效，请重新上传视角图片"}
	}

	sourceModes := 0
	if imageURL != "" {
		sourceModes++
	}
	if len(views) > 0 {
		sourceModes++
	}
	if sourceModes == 0 && prompt == "" {
		return skillPlacementError{message: "3D 生成需要填写提示词，或上传单张参考图、多视图图片"}
	}
	if sourceModes > 1 {
		return skillPlacementError{message: "3D 生成一次只能使用提示词、单张参考图或多视图图片中的一种"}
	}
	// Marble accepts an optional text_prompt alongside image and multi-image
	// input. Existing object generators keep their mutually-exclusive contract.
	isWorld := m != nil && isWorldLabsModelConfig(m.ModelID, m.Config)
	if !isWorld && prompt != "" && sourceModes > 0 {
		return skillPlacementError{message: "3D 生成一次只能使用提示词、单张参考图或多视图图片中的一种"}
	}

	limit := relaymedia.MaxThreeDMultiViewImages
	if m != nil {
		limit = configured3DMultiViewLimit(m.Config)
	}
	if len(views) > limit {
		return skillPlacementError{message: fmt.Sprintf("3D 多视图最多支持上传 %d 张图片，请移除多余图片后重试", limit)}
	}

	allowed := map[string]bool{
		"front": true, "left": true, "right": true, "back": true,
		"top": true, "bottom": true, "left_front": true, "right_front": true,
	}
	seen := make(map[string]bool, len(views))
	for _, view := range views {
		viewType := strings.ToLower(strings.TrimSpace(view.viewType))
		if !allowed[viewType] {
			return skillPlacementError{message: "3D 多视图包含无效视角，请重新选择视角后重试"}
		}
		if seen[viewType] {
			return skillPlacementError{message: fmt.Sprintf("3D 多视图中的 %s 视角重复，请移除重复图片", viewType)}
		}
		seen[viewType] = true
		sources := 0
		if strings.TrimSpace(view.imageURL) != "" {
			sources++
		}
		if strings.TrimSpace(view.imageBase64) != "" {
			sources++
		}
		if isWorld && strings.TrimSpace(view.imageBase64) != "" {
			return skillPlacementError{message: "World Labs 多视图图片需要先完成上传，请勿直接提交 Base64 图片"}
		}
		if sources != 1 {
			return skillPlacementError{message: fmt.Sprintf("3D 多视图中的 %s 视角必须且只能包含一张图片", viewType)}
		}
	}
	return nil
}

func parseThreeDReferenceViews(input map[string]any) ([]threeDReferenceView, bool) {
	for _, key := range []string{"multiViewImages", "multi_view_images"} {
		value, exists := input[key]
		if !exists {
			continue
		}
		raw, ok := value.([]any)
		if !ok {
			return nil, true
		}
		views := make([]threeDReferenceView, 0, len(raw))
		for _, item := range raw {
			row, ok := item.(map[string]any)
			if !ok {
				return nil, true
			}
			views = append(views, threeDReferenceView{
				viewType:    inputStr(row, "viewType", "view_type"),
				imageURL:    inputStr(row, "viewImageUrl", "view_image_url"),
				imageBase64: inputStr(row, "viewImageBase64", "view_image_base64"),
			})
		}
		return views, false
	}
	return nil, false
}
