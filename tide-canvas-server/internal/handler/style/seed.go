package style

import (
	"gorm.io/gorm"

	"tidecanvas/internal/model"
)

// seedStyle is a baseline gallery preset (official, public).
type seedStyle struct {
	name, shortName, category, prompt string
	commercial                        int
}

// baselineStyles are the built-in 风格广场 presets, seeded idempotently on boot so
// the canvas 风格 picker is never empty. English engineered prompts feed the model;
// admins/users can add more via POST /api/styles.
// category 必须取自前端选择器的分类页签(image-style-picker CATEGORY_OPTIONS)，
// 否则按分类精确过滤时永远查不到。「推荐」页签在 list 中不过滤、展示全部。
var baselineStyles = []seedStyle{
	{"吉卜力", "吉卜力", "动漫游戏", "Studio Ghibli anime style, hand-painted, soft warm lighting, lush detailed backgrounds, gentle color palette", 0},
	{"电影质感", "电影感", "摄影写真", "cinematic photography, dramatic lighting, shallow depth of field, subtle film grain, high dynamic range, moody atmosphere", 1},
	{"赛博朋克", "赛博朋克", "动漫游戏", "cyberpunk style, neon lights, rain-soaked streets, futuristic megacity, high contrast, vivid magenta and cyan glow", 0},
	{"水彩", "水彩", "风格插画", "delicate watercolor painting, soft washes, visible paper texture, gentle gradients, light and airy", 1},
	{"3D 卡通", "3D 卡通", "风格插画", "cute 3D cartoon render, soft global illumination, smooth clay materials, pastel colors, pixar-like", 1},
	{"国风工笔", "国风", "风格插画", "traditional Chinese gongbi painting, fine ink linework, elegant composition, silk texture, refined mineral colors", 0},
	{"极简线条", "极简", "平面设计", "minimalist line art, clean vector lines, flat design, limited palette, generous negative space", 1},
	{"暗黑奇幻", "暗黑奇幻", "动漫游戏", "dark fantasy concept art, dramatic chiaroscuro, epic scale, intricate detail, ominous mood", 0},
}

// legacySeedCategories are the pre-alignment seed categories; rows still carrying
// one of these get migrated to the seed's current category (idempotent, only
// touches system-owned rows so admin edits to other values are preserved).
var legacySeedCategories = []string{"插画", "写实", "科幻", "三维", "国风", "设计"}

// ensureBaselineStyles inserts the official gallery presets when missing (matched
// by name + system owner). Existing rows are never overwritten.
func ensureBaselineStyles(db *gorm.DB) error {
	for i := range baselineStyles {
		s := baselineStyles[i]
		var row model.StylePreset
		res := db.Where(&model.StylePreset{Name: s.name, OwnerType: "system"}).
			Attrs(&model.StylePreset{
				ShortName:  s.shortName,
				Category:   s.category,
				Prompt:     s.prompt,
				AuthorName: "官方",
				ModelType:  "image",
				Commercial: s.commercial,
				PublicFlag: 1,
				Official:   1,
				Status:     1,
				SortOrder:  i,
			}).FirstOrCreate(&row)
		if res.Error != nil {
			return res.Error
		}
		// 已存在但仍是旧分类 → 迁移到当前 seed 分类(与前端页签对齐)
		if row.ID != 0 && row.Category != s.category {
			for _, legacy := range legacySeedCategories {
				if row.Category == legacy {
					if err := db.Model(&model.StylePreset{}).Where("id = ?", row.ID).
						Update("category", s.category).Error; err != nil {
						return err
					}
					break
				}
			}
		}
	}
	return nil
}
