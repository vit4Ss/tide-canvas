package ai

import "testing"

// 后台「工具管理」的上下线开关只能挡住 handler 专属于某个工具的能力。
// 视频超分直接跑基础 handler(video_upscale),但那个 handler 只有它一个入口,
// 必须同样受约束——否则「已下线」的工具仍能被直接调用并扣费。
func TestIsToolExclusiveHandler(t *testing.T) {
	for _, handler := range []string{"outpaint", "remove_bg", "upscale", "remove_object", "relight", "video_upscale"} {
		if !isToolExclusiveHandler(handler) {
			t.Errorf("handler %q should be tool-exclusive (下线该工具时必须挡住生成)", handler)
		}
	}
	// 局部重绘复用创作台的通用图生图:下线这个工具绝不能连带废掉图生图。
	if isToolExclusiveHandler("image_to_image") {
		t.Error("image_to_image is shared with 创作台, must not be gated by the tool switch")
	}
	// 与任何工具无关的基础能力同样不受工具开关影响。
	for _, handler := range []string{"text_to_image", "text_to_video", "generate_3d", "text_to_audio"} {
		if isToolExclusiveHandler(handler) {
			t.Errorf("handler %q is not a tool handler, must not be gated", handler)
		}
	}
}
