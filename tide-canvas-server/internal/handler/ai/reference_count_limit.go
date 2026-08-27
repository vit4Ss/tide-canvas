package ai

import (
	"encoding/json"
	"fmt"
	"strings"

	"tidecanvas/internal/model"
)

// modelOmniReferenceCountLimit reads the 全能参考 reference-count caps configured in
// 模型管理. The key layout mirrors the web side (lib/reference-count.ts) so both ends
// agree: refLimits["omniRef.{image,video,audio}Count"]. 0 / missing = 不限制.
func modelOmniReferenceCountLimit(m *model.AiModel, kind string) int {
	if m == nil || strings.TrimSpace(m.Config) == "" {
		return 0
	}
	var cfg struct {
		RefLimits map[string]any `json:"refLimits"`
	}
	if json.Unmarshal([]byte(m.Config), &cfg) != nil || cfg.RefLimits == nil {
		return 0
	}
	if limit := inputInt(cfg.RefLimits, "omniRef."+kind+"Count"); limit > 0 {
		return limit
	}
	return 0
}

type referenceCountCheck struct {
	kind  string
	label string
	count int
}

// validateReferenceCountInput is the authoritative cap on how many 全能参考 assets
// one generation may carry. The cap used to live only in the Studio upload slots, so
// every other surface (canvas video nodes, skill runs, stale clients, direct API
// calls) could submit an over-limit batch: the task was created, points were charged,
// and the relay rejected it with HTTP 400 before a refund.
//
// Scope is deliberately limited to reference_to_video:
//   - image_to_video keeps the first URL and start_end_to_video keeps two, so extra
//     entries never reach the provider and must not fail an existing request.
//   - image_to_image is NOT gated on maxRefImages here. That field is the 图生图
//     参考图 cap, but chat attachments (maxFileCount) and 智能工具 (asset maxItems)
//     legitimately submit image_to_image with more images than it allows, and the
//     relay accepts 1–16 for edits. Enforcing it server-side would reject working
//     chats. i2i stays capped client-side (create-studio slots + image-node).
func validateReferenceCountInput(dto *generateDTO, m *model.AiModel) error {
	if dto == nil || m == nil {
		return nil
	}
	if !strings.EqualFold(strings.TrimSpace(dto.Handler), "reference_to_video") {
		return nil
	}
	input := decodeInput(dto.Input)
	checks := []referenceCountCheck{
		{kind: "image", label: "参考图片", count: len(inputImageURLs(input))},
		{kind: "video", label: "参考视频", count: len(inputStrings(input, "videoReferences", "video_urls"))},
		{kind: "audio", label: "参考音频", count: len(inputStrings(input, "audioReferences", "audio_urls"))},
	}
	for _, check := range checks {
		limit := modelOmniReferenceCountLimit(m, check.kind)
		if limit > 0 && check.count > limit {
			return skillPlacementError{message: fmt.Sprintf(
				"所选模型最多支持 %d 个%s，当前为 %d 个，请移除多余素材后重试", limit, check.label, check.count)}
		}
	}
	return nil
}
