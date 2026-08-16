package ai

import (
	"encoding/json"
	"strings"

	"tidecanvas/internal/model"
)

type omniReferenceSupport struct {
	image bool
	video bool
	audio bool
}

func modelOmniReferenceSupport(m *model.AiModel) omniReferenceSupport {
	support := omniReferenceSupport{image: true, video: true, audio: true}
	if m == nil || strings.TrimSpace(m.Config) == "" {
		return support
	}
	var cfg map[string]any
	if json.Unmarshal([]byte(m.Config), &cfg) != nil {
		return support
	}
	read := func(key string) bool {
		value, configured := cfg[key].(bool)
		return !configured || value
	}
	support.image = read("omniRefImageEnabled")
	support.video = read("omniRefVideoEnabled")
	support.audio = read("omniRefAudioEnabled")
	return support
}

// validateOmniReferenceInput is the authoritative capability gate. UI filtering
// is not enough because stale clients and direct API calls can still submit a
// disabled reference kind.
func validateOmniReferenceInput(dto *generateDTO, m *model.AiModel) error {
	if dto == nil || m == nil || m.Type != "video" ||
		!strings.EqualFold(strings.TrimSpace(dto.Handler), "reference_to_video") {
		return nil
	}
	var input map[string]any
	if len(dto.Input) == 0 || json.Unmarshal(dto.Input, &input) != nil || input == nil {
		return nil
	}
	support := modelOmniReferenceSupport(m)
	if !support.image && len(inputImageURLs(input)) > 0 {
		return skillPlacementError{message: "所选模型不支持参考图片，请移除后重试"}
	}
	if !support.video && len(inputStrings(input, "videoReferences", "video_urls")) > 0 {
		return skillPlacementError{message: "所选模型不支持参考视频，请移除后重试"}
	}
	if !support.audio && len(inputStrings(input, "audioReferences", "audio_urls")) > 0 {
		return skillPlacementError{message: "所选模型不支持参考音频，请移除后重试"}
	}
	return nil
}
