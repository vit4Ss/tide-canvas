package ai

import (
	"time"

	"gorm.io/gorm"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

// SeedCatalog inserts the default AI handler capabilities (and is a hook for
// default models). It is idempotent and safe to call after AutoMigrate. The
// wiring layer (Phase F) calls this; it is NOT auto-invoked by db.Migrate,
// mirroring model.Seed.
//
// Handlers seeded here mirror the built-in GenHandler registry so /api/ai/handlers
// returns the same capabilities the engine can execute. 按 handler_name 逐行补缺:
// 只插入缺失的能力行,已存在的行绝不覆盖(管理员可能改过启用状态/文案)——
// 原先「表非空即整体跳过」会让存量部署永远拿不到后加的能力(如 video_upscale)。
// No AiModel rows are seeded by default because models are upstream-specific and
// configured by an admin; without models the catalog is simply empty (the
// frontend tolerates an empty model list and a generation attempt fails with
// CodeModelUnavailable).
func SeedCatalog(db *gorm.DB) error {
	now := time.Now()
	seeds := []model.AiHandler{
		{
			HandlerName: "text_to_image", Name: "text_to_image", DisplayName: "文生图",
			Description: "Generate an image from a text prompt.",
			InputSchema: `{"prompt":{"type":"string","required":true},"aspectRatio":{"type":"string"}}`,
			IsAsync:     true, SortOrder: 1,
		},
		{
			HandlerName: "image_to_image", Name: "image_to_image", DisplayName: "图生图",
			Description: "Transform an input image guided by a prompt.",
			InputSchema: `{"prompt":{"type":"string","required":true},"imageUrl":{"type":"string","required":true}}`,
			IsAsync:     true, SortOrder: 2,
		},
		{
			HandlerName: "text_to_video", Name: "text_to_video", DisplayName: "文生视频",
			Description: "Generate a video from a text prompt.",
			InputSchema: `{"prompt":{"type":"string","required":true}}`,
			IsAsync:     true, SortOrder: 3,
		},
		{
			HandlerName: "image_to_video", Name: "image_to_video", DisplayName: "图生视频",
			Description: "Animate an input image into a video.",
			InputSchema: `{"prompt":{"type":"string"},"imageUrl":{"type":"string","required":true}}`,
			IsAsync:     true, SortOrder: 4,
		},
		{
			HandlerName: "start_end_to_video", Name: "start_end_to_video", DisplayName: "首尾帧视频",
			Description: "Generate a video that interpolates between a start and end frame.",
			InputSchema: `{"prompt":{"type":"string"},"startImageUrl":{"type":"string","required":true},"endImageUrl":{"type":"string","required":true}}`,
			IsAsync:     true, SortOrder: 5,
		},
		{
			HandlerName: "reference_to_video", Name: "reference_to_video", DisplayName: "参考生视频",
			Description: "Generate a video from one or more reference images/videos (multi-ref).",
			InputSchema: `{"prompt":{"type":"string","required":true},"references":{"type":"array"},"videoReferences":{"type":"array"}}`,
			IsAsync:     true, SortOrder: 6,
		},
		{
			HandlerName: "generate_3d", Name: "generate_3d", DisplayName: "3D 模型生成",
			Description: "Generate a 3D asset from text, one image, or multi-view images.",
			InputSchema: `{"prompt":{"type":"string"},"imageUrl":{"type":"string"},"multiViewImages":{"type":"array"}}`,
			IsAsync:     true, SortOrder: 7,
		},
		{
			HandlerName: "video_upscale", Name: "video_upscale", DisplayName: "视频超分",
			Description: "Upscale a video from a public URL (no prompt).",
			InputSchema: `{"videoUrl":{"type":"string","required":true},"targetResolution":{"type":"string"}}`,
			IsAsync:     true, SortOrder: 8,
		},
	}

	var existing []string
	if err := db.Model(&model.AiHandler{}).Pluck("handler_name", &existing).Error; err != nil {
		return err
	}
	has := make(map[string]bool, len(existing))
	for _, name := range existing {
		has[name] = true
	}

	missing := make([]model.AiHandler, 0, len(seeds))
	for i := range seeds {
		if has[seeds[i].HandlerName] {
			continue
		}
		seeds[i].ID = idgen.Next()
		seeds[i].Enabled = true
		seeds[i].CreateTime = now
		seeds[i].UpdateTime = now
		missing = append(missing, seeds[i])
	}
	if len(missing) == 0 {
		return nil
	}
	return db.Create(&missing).Error
}
