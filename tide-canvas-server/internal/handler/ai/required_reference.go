package ai

import (
	"encoding/json"
	"strings"
)

// validateRequiredReferenceInput is the server-side backstop for generation
// modes that require reference material. The Studio validates this before submit,
// but stale clients and direct API calls must not be able to create (and charge
// for) a task without the required input.
func validateRequiredReferenceInput(dto *generateDTO) error {
	if dto == nil {
		return nil
	}
	handler := strings.ToLower(strings.TrimSpace(dto.Handler))
	if handler != "image_to_image" && handler != "image_to_video" &&
		handler != "start_end_to_video" && handler != "reference_to_video" {
		return nil
	}

	var input map[string]any
	if len(dto.Input) > 0 {
		_ = json.Unmarshal(dto.Input, &input)
	}
	images := inputImageURLs(input)
	if handler == "image_to_image" && len(images) == 0 {
		return skillPlacementError{message: "图生图必须上传参考图片"}
	}
	if handler == "image_to_video" && len(images) == 0 {
		return skillPlacementError{message: "图生视频必须上传首帧图片"}
	}
	if handler == "reference_to_video" && len(images) == 0 &&
		len(inputStrings(input, "videoReferences", "video_urls")) == 0 &&
		len(inputStrings(input, "audioReferences", "audio_urls")) == 0 {
		return skillPlacementError{message: "全能参考必须上传至少一个参考素材"}
	}
	if handler == "start_end_to_video" {
		first := inputStr(input, "firstFrame", "startImageUrl", "sourceImage")
		last := inputStr(input, "lastFrame", "endImageUrl")
		if first == "" && len(images) > 0 {
			first = images[0]
			// Match provider startEndFrames exactly: its ordered-list fallback is
			// only entered when no discrete first frame exists.
			if len(images) > 1 {
				last = images[1]
			}
		}
		if first == "" {
			return skillPlacementError{message: "首尾帧模式需要上传首帧"}
		}
		// 画布视频节点的既有产品口径允许单首帧，并在客户端将尾帧
		// 回退为首帧；创作台的显式“首尾帧”模式才要求两帧必传。
		canvasSingleFrame := dto.ProjectID != 0 && strings.EqualFold(strings.TrimSpace(dto.EntryPoint), "canvas")
		if last == "" && !canvasSingleFrame {
			return skillPlacementError{message: "首尾帧模式需要上传尾帧"}
		}
	}
	return nil
}
