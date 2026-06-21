package ai

import (
	"time"

	"gorm.io/gorm"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

// SeedCatalog inserts the default AI handler capabilities (and is a hook for
// default models) if the handler table is empty. It is idempotent and safe to
// call after AutoMigrate. The wiring layer (Phase F) calls this; it is NOT
// auto-invoked by db.Migrate, mirroring model.Seed.
//
// Handlers seeded here mirror the built-in GenHandler registry so /api/ai/handlers
// returns the same capabilities the engine can execute. No AiModel rows are
// seeded by default because models are upstream-specific and configured by an
// admin; without models the catalog is simply empty (the frontend tolerates an
// empty model list and a generation attempt fails with CodeModelUnavailable).
func SeedCatalog(db *gorm.DB) error {
	var count int64
	if err := db.Model(&model.AiHandler{}).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return nil
	}

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
			HandlerName: "creative_desc", Name: "creative_desc", DisplayName: "创意描述",
			Description: "Produce a creative textual description from inputs.",
			InputSchema: `{"prompt":{"type":"string","required":true}}`,
			IsAsync:     false, SortOrder: 6,
		},
	}

	for i := range seeds {
		seeds[i].ID = idgen.Next()
		seeds[i].Enabled = true
		seeds[i].CreateTime = now
		seeds[i].UpdateTime = now
	}
	return db.Create(&seeds).Error
}
