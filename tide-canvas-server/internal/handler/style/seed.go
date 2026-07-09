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
var baselineStyles = []seedStyle{
	{"吉卜力", "吉卜力", "插画", "Studio Ghibli anime style, hand-painted, soft warm lighting, lush detailed backgrounds, gentle color palette", 0},
	{"电影质感", "电影感", "写实", "cinematic photography, dramatic lighting, shallow depth of field, subtle film grain, high dynamic range, moody atmosphere", 1},
	{"赛博朋克", "赛博朋克", "科幻", "cyberpunk style, neon lights, rain-soaked streets, futuristic megacity, high contrast, vivid magenta and cyan glow", 0},
	{"水彩", "水彩", "插画", "delicate watercolor painting, soft washes, visible paper texture, gentle gradients, light and airy", 1},
	{"3D 卡通", "3D 卡通", "三维", "cute 3D cartoon render, soft global illumination, smooth clay materials, pastel colors, pixar-like", 1},
	{"国风工笔", "国风", "国风", "traditional Chinese gongbi painting, fine ink linework, elegant composition, silk texture, refined mineral colors", 0},
	{"极简线条", "极简", "设计", "minimalist line art, clean vector lines, flat design, limited palette, generous negative space", 1},
	{"暗黑奇幻", "暗黑奇幻", "科幻", "dark fantasy concept art, dramatic chiaroscuro, epic scale, intricate detail, ominous mood", 0},
}

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
	}
	return nil
}
