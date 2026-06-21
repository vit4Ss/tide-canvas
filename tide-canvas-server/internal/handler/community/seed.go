package community

import (
	"encoding/json"
	"time"

	"gorm.io/gorm"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

// seed.go provides idempotent demo data for the community feed so the frontend
// 作品广场 renders content out of the box. The richer card/detail fields the
// model doesn't persist (type/cat/model + generation params) are encoded into the
// content column as a JSON blob (decoded by vo.go), matching the read path.

// seedPost is the in-memory shape for a seeded post; it is flattened into a
// CommunityPost (with its metadata serialized into Content) at insert time.
type seedPost struct {
	Title string
	Cover string
	Tags  string
	Likes int
	Views int
	Meta  postMeta
}

// Seed inserts ~18 demo community posts authored by an existing user (the seeded
// admin if present, otherwise any user). It is idempotent: if any community_post
// row already exists, or no user exists to author them, it is a no-op.
func Seed(db *gorm.DB) error {
	var count int64
	if err := db.Model(&model.CommunityPost{}).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return nil
	}

	authorID, ok, err := pickAuthor(db)
	if err != nil {
		return err
	}
	if !ok {
		// No users to author posts (DB not seeded yet) — skip gracefully.
		return nil
	}

	seeds := seedPosts()
	now := time.Now()
	rows := make([]model.CommunityPost, 0, len(seeds))
	for i, sp := range seeds {
		meta := sp.Meta
		blob, mErr := json.Marshal(meta)
		if mErr != nil {
			return mErr
		}
		rows = append(rows, model.CommunityPost{
			BaseModel: model.BaseModel{
				ID: idgen.Next(),
				// Stagger create times so the "new" sort yields a stable, varied order.
				CreateTime: now.Add(-time.Duration(i) * time.Hour),
				UpdateTime: now.Add(-time.Duration(i) * time.Hour),
			},
			UserID:       authorID,
			Title:        sp.Title,
			Content:      string(blob),
			CoverURL:     sp.Cover,
			Tags:         sp.Tags,
			LikeCount:    sp.Likes,
			CommentCount: 0,
			ViewCount:    sp.Views,
			Status:       statusPublished,
		})
	}
	return db.Create(&rows).Error
}

// pickAuthor returns an author id, preferring the admin (role 9) and falling back
// to any user. ok is false when no user exists.
func pickAuthor(db *gorm.DB) (idgen.ID, bool, error) {
	var u model.User
	err := db.Select("id").Where("role = ?", 9).First(&u).Error
	if err == nil {
		return u.ID, true, nil
	}
	if err != gorm.ErrRecordNotFound {
		return 0, false, err
	}
	err = db.Select("id").First(&u).Error
	if err == gorm.ErrRecordNotFound {
		return 0, false, nil
	}
	if err != nil {
		return 0, false, err
	}
	return u.ID, true, nil
}

// seedPosts is the curated demo set: varied category/type/model/likes so every
// feed sort (hot/new/like) and the type/cat filters have something to show.
// Covers are left empty so the frontend renders its gradient fallback.
func seedPosts() []seedPost {
	return []seedPost{
		{Title: "赛博朋克都市夜景", Tags: "cyberpunk,city,neon", Likes: 1284, Views: 9800,
			Meta: postMeta{Type: "image", Cat: "插画", Model: "Stable Diffusion XL",
				Desc: "霓虹灯下的未来都市，雨夜与倒影。", Prompt: "cyberpunk city at night, neon lights, rain, reflections, ultra detailed",
				NegPrompt: "blurry, low quality, watermark", Steps: 30, Sampler: "DPM++ 2M Karras", CfgScale: 7.5, Size: "1024x1024", Seed: 284619}},
		{Title: "水墨山水意境", Tags: "ink,landscape,chinese", Likes: 942, Views: 6100,
			Meta: postMeta{Type: "image", Cat: "国风", Model: "MidJourney v6",
				Desc: "传统水墨与现代构图的融合。", Prompt: "chinese ink painting, misty mountains, river, minimalist",
				NegPrompt: "color, photorealistic", Steps: 28, Sampler: "Euler a", CfgScale: 6.0, Size: "1024x768", Seed: 77120}},
		{Title: "未来机甲战士", Tags: "mecha,robot,scifi", Likes: 2103, Views: 15400,
			Meta: postMeta{Type: "image", Cat: "科幻", Model: "Stable Diffusion XL",
				Desc: "高精度机甲设计稿。", Prompt: "futuristic mecha warrior, intricate armor, dramatic lighting",
				NegPrompt: "deformed, extra limbs", Steps: 35, Sampler: "DPM++ SDE Karras", CfgScale: 8.0, Size: "896x1152", Seed: 991022}},
		{Title: "梦幻森林精灵", Tags: "fantasy,elf,forest", Likes: 658, Views: 4200,
			Meta: postMeta{Type: "image", Cat: "幻想", Model: "MidJourney v6",
				Desc: "光影斑驳的精灵之森。", Prompt: "fantasy forest elf, glowing particles, soft light",
				NegPrompt: "ugly, lowres", Steps: 30, Sampler: "Euler a", CfgScale: 7.0, Size: "1024x1024", Seed: 33218}},
		{Title: "海浪延时动态", Tags: "ocean,wave,loop", Likes: 1567, Views: 20300,
			Meta: postMeta{Type: "video", Cat: "自然", Model: "Runway Gen-3",
				Desc: "无缝循环的海浪动画。", Prompt: "ocean waves crashing, slow motion, cinematic",
				Steps: 0, Sampler: "", CfgScale: 0, Size: "1280x720", Seed: 0}},
		{Title: "城市穿梭运镜", Tags: "city,flythrough,drone", Likes: 1190, Views: 17800,
			Meta: postMeta{Type: "video", Cat: "科幻", Model: "Kling 1.5",
				Desc: "无人机视角穿越未来城市。", Prompt: "drone flythrough futuristic city, sunset",
				Size: "1920x1080"}},
		{Title: "可爱猫咪插画", Tags: "cat,cute,illustration", Likes: 845, Views: 7600,
			Meta: postMeta{Type: "image", Cat: "插画", Model: "Stable Diffusion XL",
				Desc: "扁平风格的萌系猫咪。", Prompt: "cute cat illustration, flat style, pastel colors",
				NegPrompt: "realistic", Steps: 25, Sampler: "Euler a", CfgScale: 6.5, Size: "1024x1024", Seed: 50231}},
		{Title: "复古胶片人像", Tags: "portrait,film,vintage", Likes: 1402, Views: 11200,
			Meta: postMeta{Type: "image", Cat: "写实", Model: "Realistic Vision",
				Desc: "暖色调的复古人像。", Prompt: "vintage film portrait, warm tones, 35mm",
				NegPrompt: "cartoon, anime", Steps: 32, Sampler: "DPM++ 2M Karras", CfgScale: 7.0, Size: "832x1216", Seed: 660914}},
		{Title: "宇宙星云漫游", Tags: "space,nebula,galaxy", Likes: 1988, Views: 22100,
			Meta: postMeta{Type: "video", Cat: "科幻", Model: "Runway Gen-3",
				Desc: "穿越绚丽星云。", Prompt: "flying through colorful nebula, stars, cinematic space",
				Size: "1280x720"}},
		{Title: "日系动漫少女", Tags: "anime,girl,japan", Likes: 3201, Views: 28900,
			Meta: postMeta{Type: "image", Cat: "二次元", Model: "Anything v5",
				Desc: "清新日系动漫风。", Prompt: "anime girl, cherry blossom, detailed eyes, soft shading",
				NegPrompt: "bad hands, extra fingers", Steps: 28, Sampler: "Euler a", CfgScale: 7.5, Size: "768x1152", Seed: 120458}},
		{Title: "极简产品渲染", Tags: "product,3d,minimal", Likes: 512, Views: 3900,
			Meta: postMeta{Type: "image", Cat: "设计", Model: "Stable Diffusion XL",
				Desc: "棚拍质感的产品图。", Prompt: "minimal product render, studio lighting, clean background",
				NegPrompt: "clutter", Steps: 30, Sampler: "DPM++ 2M Karras", CfgScale: 6.0, Size: "1024x1024", Seed: 44091}},
		{Title: "蒸汽朋克机械城", Tags: "steampunk,city,gears", Likes: 1077, Views: 8400,
			Meta: postMeta{Type: "image", Cat: "科幻", Model: "MidJourney v6",
				Desc: "齿轮与黄铜构筑的城市。", Prompt: "steampunk mechanical city, brass gears, foggy",
				NegPrompt: "modern, clean", Steps: 33, Sampler: "DPM++ SDE Karras", CfgScale: 7.5, Size: "1216x832", Seed: 730012}},
		{Title: "治愈系田园风光", Tags: "countryside,healing,nature", Likes: 723, Views: 5600,
			Meta: postMeta{Type: "image", Cat: "自然", Model: "Realistic Vision",
				Desc: "阳光下的乡村田野。", Prompt: "peaceful countryside, golden hour, wheat field",
				NegPrompt: "dark, gloomy", Steps: 28, Sampler: "Euler a", CfgScale: 6.5, Size: "1216x832", Seed: 88123}},
		{Title: "暗黑哥特城堡", Tags: "gothic,castle,dark", Likes: 1345, Views: 10500,
			Meta: postMeta{Type: "image", Cat: "幻想", Model: "Stable Diffusion XL",
				Desc: "月夜下的哥特式城堡。", Prompt: "dark gothic castle, full moon, fog, dramatic",
				NegPrompt: "bright, cheerful", Steps: 34, Sampler: "DPM++ 2M Karras", CfgScale: 8.0, Size: "896x1152", Seed: 554320}},
		{Title: "流体艺术抽象", Tags: "abstract,fluid,art", Likes: 489, Views: 3300,
			Meta: postMeta{Type: "image", Cat: "抽象", Model: "MidJourney v6",
				Desc: "色彩流动的抽象艺术。", Prompt: "abstract fluid art, vibrant colors, marble texture",
				Steps: 26, Sampler: "Euler a", CfgScale: 5.5, Size: "1024x1024", Seed: 19234}},
		{Title: "美食特写广告", Tags: "food,ad,closeup", Likes: 934, Views: 7100,
			Meta: postMeta{Type: "image", Cat: "写实", Model: "Realistic Vision",
				Desc: "诱人的美食广告大片。", Prompt: "gourmet food closeup, commercial photography, appetizing",
				NegPrompt: "blurry", Steps: 30, Sampler: "DPM++ 2M Karras", CfgScale: 7.0, Size: "1024x1024", Seed: 401277}},
		{Title: "国潮龙纹设计", Tags: "guochao,dragon,china", Likes: 1620, Views: 12800,
			Meta: postMeta{Type: "image", Cat: "国风", Model: "Stable Diffusion XL",
				Desc: "现代国潮风龙纹。", Prompt: "chinese dragon, guochao style, red and gold, ornate",
				NegPrompt: "western dragon", Steps: 32, Sampler: "DPM++ SDE Karras", CfgScale: 7.5, Size: "1024x1024", Seed: 902341}},
		{Title: "霓虹舞者动态", Tags: "dance,neon,motion", Likes: 1456, Views: 18600,
			Meta: postMeta{Type: "video", Cat: "二次元", Model: "Kling 1.5",
				Desc: "霓虹光影中的舞者。", Prompt: "neon light dancer, flowing motion, cyberpunk stage",
				Size: "1080x1920"}},
	}
}
