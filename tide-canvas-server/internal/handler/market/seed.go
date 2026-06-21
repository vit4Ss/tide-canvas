package market

import (
	"github.com/shopspring/decimal"
	"gorm.io/gorm"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

// seed.go provides idempotent default data for the marketplace: a handful of
// categories (全部/SDXL/Flux/可灵 Kling/ComfyUI) and ~12 market models. It is
// safe to call repeatedly — it skips when rows already exist. The wiring layer
// (main/Phase F) calls Seed after AutoMigrate, mirroring model.Seed / ai.SeedCatalog.
//
// Presentation fields not backed by columns (base/type/ver/badge and the
// Chinese/English name split) are encoded into existing columns so the VO can
// derive them: Name is stored "中文名|EnglishName" and the extra metadata is
// stored as "key:value" pseudo-tags inside the tags column alongside plain tags.

// seedCategory is a category template; the slug doubles as the base-family key.
type seedCategory struct {
	name string
	slug string
	icon string
}

// seedModel is a market-model template. base/typ/ver/badge are encoded into the
// tags column as pseudo-tags; plainTags become the visible tags[].
type seedModel struct {
	nameCn    string
	nameEn    string
	base      string
	typ       string
	ver       string
	badge     string
	plainTags []string
	desc      string
	cover     string
	runs      int
	likes     int
}

// Seed inserts default categories and market models if none exist yet. It is
// idempotent: if any market_model row is present it returns early. Categories
// are seeded independently (skipped when the table already has rows).
func Seed(db *gorm.DB) error {
	if err := seedCategories(db); err != nil {
		return err
	}
	return seedModels(db)
}

func seedCategories(db *gorm.DB) error {
	var count int64
	if err := db.Model(&model.ModelCategory{}).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return nil
	}

	cats := []seedCategory{
		{name: "全部", slug: "all", icon: ""},
		{name: "SDXL", slug: "sdxl", icon: ""},
		{name: "Flux", slug: "flux", icon: ""},
		{name: "可灵 Kling", slug: "kling", icon: ""},
		{name: "ComfyUI", slug: "comfyui", icon: ""},
	}

	rows := make([]model.ModelCategory, 0, len(cats))
	for i, c := range cats {
		row := model.ModelCategory{Name: c.name, Slug: c.slug, Icon: c.icon, SortOrder: i, Status: 1}
		row.ID = idgen.Next()
		rows = append(rows, row)
	}
	return db.Create(&rows).Error
}

func seedModels(db *gorm.DB) error {
	var count int64
	if err := db.Model(&model.MarketModel{}).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return nil
	}

	// Resolve the author: prefer the seeded admin (role 9), else any user. If no
	// user exists yet, author_id stays 0 (the VO renders an empty author name).
	authorID := resolveAuthorID(db)

	// Resolve category ids by slug so each model links to its base family. When a
	// slug is missing (categories not seeded) the link is left nil and the VO
	// falls back to the base pseudo-tag.
	catBySlug := map[string]idgen.ID{}
	{
		var cats []model.ModelCategory
		if err := db.Select("id", "slug").Find(&cats).Error; err != nil {
			return err
		}
		for i := range cats {
			catBySlug[cats[i].Slug] = cats[i].ID
		}
	}
	slugForBase := map[string]string{
		"SDXL":    "sdxl",
		"Flux":    "flux",
		"Kling":   "kling",
		"ComfyUI": "comfyui",
	}

	seeds := []seedModel{
		{nameCn: "梦境逐影 XL", nameEn: "DreamShaper XL", base: "SDXL", typ: "文生图", ver: "v2.1", badge: "Hot",
			plainTags: []string{"写实", "电影感"}, desc: "高质量写实风格的 SDXL 微调模型，擅长人像与场景。",
			cover: "https://picsum.photos/seed/dreamshaper/640/400", runs: 128400, likes: 9320},
		{nameCn: "霓虹赛博", nameEn: "Neon Cyber", base: "SDXL", typ: "文生图", ver: "v1.5", badge: "",
			plainTags: []string{"赛博朋克", "霓虹"}, desc: "赛博朋克霓虹风格，强烈光效与城市夜景。",
			cover: "https://picsum.photos/seed/neoncyber/640/400", runs: 64210, likes: 4180},
		{nameCn: "水墨丹青", nameEn: "InkWash Master", base: "SDXL", typ: "文生图", ver: "v1.0", badge: "",
			plainTags: []string{"国风", "水墨"}, desc: "中国传统水墨画风格，留白与笔触自然。",
			cover: "https://picsum.photos/seed/inkwash/640/400", runs: 38900, likes: 3110},
		{nameCn: "极速通量", nameEn: "Flux Schnell", base: "Flux", typ: "文生图", ver: "v1.0", badge: "Fast",
			plainTags: []string{"快速", "高效"}, desc: "Flux 系列极速出图模型，几步即可生成高质量图像。",
			cover: "https://picsum.photos/seed/fluxschnell/640/400", runs: 201500, likes: 15600},
		{nameCn: "通量臻品", nameEn: "Flux Dev", base: "Flux", typ: "文生图", ver: "v1.0", badge: "New",
			plainTags: []string{"高保真", "细节"}, desc: "Flux 开发版，细节与提示词遵循度俱佳。",
			cover: "https://picsum.photos/seed/fluxdev/640/400", runs: 156300, likes: 12010},
		{nameCn: "通量写真", nameEn: "Flux Portrait", base: "Flux", typ: "图生图", ver: "v1.2", badge: "",
			plainTags: []string{"人像", "写真"}, desc: "面向人像写真优化的 Flux 微调模型。",
			cover: "https://picsum.photos/seed/fluxportrait/640/400", runs: 88700, likes: 7240},
		{nameCn: "可灵视界", nameEn: "Kling Vision", base: "Kling", typ: "文生视频", ver: "v1.6", badge: "Hot",
			plainTags: []string{"视频", "电影感"}, desc: "可灵文生视频模型，长镜头与运动连贯。",
			cover: "https://picsum.photos/seed/klingvision/640/400", runs: 95400, likes: 8830},
		{nameCn: "可灵动画", nameEn: "Kling Motion", base: "Kling", typ: "图生视频", ver: "v1.5", badge: "",
			plainTags: []string{"视频", "动效"}, desc: "可灵图生视频模型，将静态图像转为流畅动画。",
			cover: "https://picsum.photos/seed/klingmotion/640/400", runs: 72300, likes: 6190},
		{nameCn: "可灵首尾", nameEn: "Kling KeyFrame", base: "Kling", typ: "首尾帧视频", ver: "v1.0", badge: "New",
			plainTags: []string{"视频", "插帧"}, desc: "首尾帧插值生成视频，自然过渡。",
			cover: "https://picsum.photos/seed/klingkeyframe/640/400", runs: 41200, likes: 3520},
		{nameCn: "万能工作流", nameEn: "Comfy AllInOne", base: "ComfyUI", typ: "工作流", ver: "v3.0", badge: "Pro",
			plainTags: []string{"工作流", "节点"}, desc: "开箱即用的 ComfyUI 综合工作流，覆盖多数常见场景。",
			cover: "https://picsum.photos/seed/comfyall/640/400", runs: 53600, likes: 5040},
		{nameCn: "高清放大流", nameEn: "Comfy Upscaler", base: "ComfyUI", typ: "工作流", ver: "v2.2", badge: "",
			plainTags: []string{"放大", "高清"}, desc: "ComfyUI 高清放大工作流，细节增强不糊。",
			cover: "https://picsum.photos/seed/comfyupscale/640/400", runs: 47800, likes: 4360},
		{nameCn: "换脸合成流", nameEn: "Comfy FaceSwap", base: "ComfyUI", typ: "工作流", ver: "v1.4", badge: "",
			plainTags: []string{"换脸", "合成"}, desc: "ComfyUI 换脸与合成工作流，效果自然。",
			cover: "https://picsum.photos/seed/comfyfaceswap/640/400", runs: 35100, likes: 2980},
	}

	rows := make([]model.MarketModel, 0, len(seeds))
	for _, s := range seeds {
		var catID *idgen.ID
		if slug, ok := slugForBase[s.base]; ok {
			if id, ok := catBySlug[slug]; ok {
				cid := id
				catID = &cid
			}
		}

		row := model.MarketModel{
			CategoryID:  catID,
			AuthorID:    authorID,
			Name:        s.nameCn + "|" + s.nameEn,
			Description: s.desc,
			CoverURL:    s.cover,
			Tags:        encodeTags(s),
			Price:       decimal.NewFromInt(0),
			UseCount:    s.runs,
			LikeCount:   s.likes,
			Status:      statusListed,
		}
		row.ID = idgen.Next()
		rows = append(rows, row)
	}
	return db.Create(&rows).Error
}

// encodeTags packs the base/type/ver/badge metadata as pseudo-tags ahead of the
// plain display tags, comma-separated, matching what parseTags decodes.
func encodeTags(s seedModel) string {
	parts := []string{
		"base:" + s.base,
		"type:" + s.typ,
		"ver:" + s.ver,
	}
	if s.badge != "" {
		parts = append(parts, "badge:"+s.badge)
	}
	parts = append(parts, s.plainTags...)

	out := ""
	for i, p := range parts {
		if i > 0 {
			out += ","
		}
		out += p
	}
	return out
}

// resolveAuthorID returns the seeded admin's id, else any user's id, else 0.
func resolveAuthorID(db *gorm.DB) idgen.ID {
	var u model.User
	if err := db.Select("id").Where("role = ?", 9).Order("id ASC").First(&u).Error; err == nil && u.ID != 0 {
		return u.ID
	}
	if err := db.Select("id").Order("id ASC").First(&u).Error; err == nil {
		return u.ID
	}
	return 0
}
