package community

import (
	"encoding/json"
	"fmt"
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

	adminID, ok, err := pickAuthor(db)
	if err != nil {
		return err
	}
	if !ok {
		// No users to author posts (DB not seeded yet) — skip gracefully.
		return nil
	}

	// Spread the demo posts across a few demo creators (+ the admin) so the feed
	// shows varied author names and the 作者主页 has multiple profiles to browse.
	authors, err := ensureDemoAuthors(db, adminID)
	if err != nil {
		return err
	}

	seeds := seedPosts()
	now := time.Now()
	rows := make([]model.CommunityPost, 0, len(seeds))
	for i, sp := range seeds {
		meta := sp.Meta
		cover := sp.Cover
		if cover == "" {
			cover = picsumCover(i, meta.Type)
		}
		// video posts get a real, publicly-playable sample source; the cover above
		// doubles as the poster frame. Set BEFORE marshalling so it lands in the blob.
		if meta.Type == "video" && meta.VideoURL == "" {
			meta.VideoURL = sampleVideo(i)
		}
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
			UserID:       authors[i%len(authors)],
			Title:        sp.Title,
			Content:      string(blob),
			CoverURL:     cover,
			Tags:         sp.Tags,
			LikeCount:    sp.Likes,
			CommentCount: 0,
			ViewCount:    sp.Views,
			Status:       statusPublished,
		})
	}
	return db.Create(&rows).Error
}

// picsumCover returns a deterministic placeholder cover from the Lorem Picsum
// service (real photos, designed for dev placeholders, no attribution needed).
// The seed is stable per index so each post keeps the same image across reloads.
func picsumCover(i int, typ string) string {
	h := 1000
	if typ == "video" {
		h = 560 // wider poster for video cards
	}
	return fmt.Sprintf("https://picsum.photos/seed/fl%d/800/%d", i+1, h)
}

// sampleVideos are public, freely-playable sample clips hosted on Google's CDN
// (open-movie / demo assets used widely for player testing). Used as demo video
// sources so the 作品广场 video posts actually play.
var sampleVideos = []string{
	"https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
	"https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4",
	"https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
	"https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4",
	"https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerMeltdowns.mp4",
	"https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4",
}

// sampleVideo picks a deterministic sample clip for a post index.
func sampleVideo(i int) string { return sampleVideos[i%len(sampleVideos)] }

// demoAuthor is a lightweight seeded creator (display-only; not a login account).
type demoAuthor struct {
	Username string
	Nickname string
}

func demoAuthors() []demoAuthor {
	return []demoAuthor{
		{"demo_artist_01", "光影诗人"},
		{"demo_artist_02", "墨白MOBAI"},
		{"demo_artist_03", "赛博绘师"},
		{"demo_artist_04", "山水之间"},
		{"demo_artist_05", "像素工坊"},
		{"demo_artist_06", "星河绘梦"},
		{"demo_artist_07", "暖阳工作室"},
		{"demo_artist_08", "未来构想"},
	}
}

// ensureDemoAuthors find-or-creates the demo creators and returns the full author
// pool (admin first, then the demo creators). Idempotent: existing users are
// reused by username, missing ones are inserted. Demo users are display-only
// (no password / not meant to log in).
func ensureDemoAuthors(db *gorm.DB, adminID idgen.ID) ([]idgen.ID, error) {
	ids := []idgen.ID{adminID}
	now := time.Now()
	for i, a := range demoAuthors() {
		var u model.User
		err := db.Select("id").Where("username = ?", a.Username).First(&u).Error
		if err == nil {
			ids = append(ids, u.ID)
			continue
		}
		if err != gorm.ErrRecordNotFound {
			return nil, err
		}
		u = model.User{
			ID:         idgen.Next(),
			Username:   a.Username,
			Nickname:   a.Nickname,
			Email:      fmt.Sprintf("%s@demo.flowinglight.local", a.Username),
			Role:       0,
			Status:     1,
			IsAuthor:   1,
			CreateTime: now.Add(-time.Duration(i*24) * time.Hour),
			UpdateTime: now,
		}
		if err := db.Create(&u).Error; err != nil {
			return nil, err
		}
		ids = append(ids, u.ID)
	}
	return ids, nil
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
// Covers left empty are auto-filled with a deterministic Picsum placeholder.
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
		{Title: "雪山下的旅人", Tags: "mountain,snow,journey", Likes: 1733, Views: 13900,
			Meta: postMeta{Type: "image", Cat: "写实", Model: "Realistic Vision",
				Desc: "雪山脚下孤独的背影。", Prompt: "lone traveler under snowy mountains, epic scale, golden light",
				NegPrompt: "blurry, lowres", Steps: 32, Sampler: "DPM++ 2M Karras", CfgScale: 7.0, Size: "1216x832", Seed: 771203}},
		{Title: "故障艺术海报", Tags: "glitch,poster,retro", Likes: 604, Views: 4500,
			Meta: postMeta{Type: "image", Cat: "设计", Model: "Stable Diffusion XL",
				Desc: "复古故障风视觉海报。", Prompt: "glitch art poster, RGB split, retro typography, vaporwave",
				NegPrompt: "clean, plain", Steps: 28, Sampler: "Euler a", CfgScale: 6.5, Size: "1024x1280", Seed: 210934}},
		{Title: "敦煌飞天重绘", Tags: "dunhuang,china,mural", Likes: 2456, Views: 24800,
			Meta: postMeta{Type: "image", Cat: "国风", Model: "MidJourney v6",
				Desc: "敦煌壁画飞天的现代重绘。", Prompt: "dunhuang flying apsaras, mural style, gold and azurite, flowing ribbons",
				NegPrompt: "western style", Steps: 34, Sampler: "DPM++ SDE Karras", CfgScale: 7.5, Size: "896x1152", Seed: 880471}},
		{Title: "极光下的木屋", Tags: "aurora,cabin,night", Likes: 1899, Views: 16700,
			Meta: postMeta{Type: "image", Cat: "自然", Model: "Realistic Vision",
				Desc: "北极光下的静谧木屋。", Prompt: "wooden cabin under aurora borealis, starry sky, reflection on lake",
				NegPrompt: "people, daytime", Steps: 30, Sampler: "DPM++ 2M Karras", CfgScale: 7.0, Size: "1216x832", Seed: 559012}},
		{Title: "未来座驾概念", Tags: "car,concept,future", Likes: 1320, Views: 11800,
			Meta: postMeta{Type: "image", Cat: "设计", Model: "Stable Diffusion XL",
				Desc: "流线型未来概念汽车。", Prompt: "futuristic concept car, aerodynamic, studio render, glossy paint",
				NegPrompt: "old, rusty", Steps: 33, Sampler: "DPM++ SDE Karras", CfgScale: 7.5, Size: "1280x720", Seed: 304882}},
		{Title: "微距露珠世界", Tags: "macro,dew,nature", Likes: 712, Views: 5200,
			Meta: postMeta{Type: "image", Cat: "写实", Model: "Realistic Vision",
				Desc: "清晨叶尖的露珠微距。", Prompt: "macro photography of dew drop on leaf, morning light, bokeh",
				NegPrompt: "blurry subject", Steps: 30, Sampler: "DPM++ 2M Karras", CfgScale: 6.5, Size: "1024x1024", Seed: 145522}},
		{Title: "蒸汽小镇黄昏", Tags: "town,sunset,anime", Likes: 2780, Views: 26400,
			Meta: postMeta{Type: "image", Cat: "二次元", Model: "Anything v5",
				Desc: "宫崎骏风格的黄昏小镇。", Prompt: "ghibli style town at sunset, warm clouds, cozy houses, detailed",
				NegPrompt: "bad hands", Steps: 28, Sampler: "Euler a", CfgScale: 7.5, Size: "1152x768", Seed: 667301}},
		{Title: "金属液态雕塑", Tags: "metal,liquid,abstract", Likes: 533, Views: 3700,
			Meta: postMeta{Type: "image", Cat: "抽象", Model: "MidJourney v6",
				Desc: "流动的液态金属雕塑。", Prompt: "liquid metal sculpture, chrome, reflective, abstract form, studio",
				Steps: 26, Sampler: "Euler a", CfgScale: 5.5, Size: "1024x1024", Seed: 901233}},
		{Title: "古风侠客立绘", Tags: "wuxia,character,china", Likes: 2210, Views: 19900,
			Meta: postMeta{Type: "image", Cat: "国风", Model: "Stable Diffusion XL",
				Desc: "白衣侠客的全身立绘。", Prompt: "wuxia swordsman, white robe, ink wash background, dynamic pose",
				NegPrompt: "modern clothes", Steps: 32, Sampler: "DPM++ 2M Karras", CfgScale: 7.5, Size: "832x1216", Seed: 410876}},
		{Title: "雨夜便利店", Tags: "city,rain,night,anime", Likes: 3088, Views: 31200,
			Meta: postMeta{Type: "image", Cat: "二次元", Model: "Anything v5",
				Desc: "雨夜里温暖的便利店灯光。", Prompt: "anime convenience store at rainy night, warm light, wet street reflection",
				NegPrompt: "bad anatomy", Steps: 28, Sampler: "Euler a", CfgScale: 7.5, Size: "1152x768", Seed: 778120}},
		{Title: "孟菲斯风格插画", Tags: "memphis,flat,design", Likes: 446, Views: 3100,
			Meta: postMeta{Type: "image", Cat: "插画", Model: "Stable Diffusion XL",
				Desc: "撞色孟菲斯几何插画。", Prompt: "memphis style illustration, bold geometric shapes, bright colors, playful",
				NegPrompt: "realistic, muted", Steps: 25, Sampler: "Euler a", CfgScale: 6.0, Size: "1024x1024", Seed: 122390}},
		{Title: "深海发光生物", Tags: "deepsea,bioluminescence", Likes: 1644, Views: 14300,
			Meta: postMeta{Type: "video", Cat: "自然", Model: "Runway Gen-3",
				Desc: "深海中发光的水母群。", Prompt: "bioluminescent jellyfish in deep sea, glowing, slow drifting, dark water",
				Size: "1280x720"}},
		{Title: "城市天际线延时", Tags: "skyline,timelapse,city", Likes: 1278, Views: 16100,
			Meta: postMeta{Type: "video", Cat: "写实", Model: "Kling 1.5",
				Desc: "黄昏到夜晚的城市延时。", Prompt: "city skyline timelapse, dusk to night, moving clouds, lights turning on",
				Size: "1920x1080"}},
		{Title: "机械朋克昆虫", Tags: "mechanical,insect,steampunk", Likes: 987, Views: 7900,
			Meta: postMeta{Type: "image", Cat: "科幻", Model: "Stable Diffusion XL",
				Desc: "黄铜齿轮构成的机械昆虫。", Prompt: "mechanical insect, brass gears, intricate clockwork, macro, steampunk",
				NegPrompt: "organic, soft", Steps: 34, Sampler: "DPM++ SDE Karras", CfgScale: 8.0, Size: "1024x1024", Seed: 553201}},
		{Title: "莫奈花园印象", Tags: "impressionism,garden,monet", Likes: 1502, Views: 12300,
			Meta: postMeta{Type: "image", Cat: "抽象", Model: "MidJourney v6",
				Desc: "印象派笔触的花园。", Prompt: "impressionist garden, monet style, loose brush strokes, water lilies",
				NegPrompt: "sharp, photographic", Steps: 28, Sampler: "Euler a", CfgScale: 6.0, Size: "1216x832", Seed: 330918}},
		{Title: "未来城市俯瞰", Tags: "city,aerial,scifi", Likes: 2670, Views: 27600,
			Meta: postMeta{Type: "image", Cat: "科幻", Model: "MidJourney v6",
				Desc: "高空俯瞰的未来巨型都市。", Prompt: "aerial view of futuristic megacity, towering skyscrapers, flying vehicles, dusk",
				NegPrompt: "village, lowres", Steps: 35, Sampler: "DPM++ SDE Karras", CfgScale: 8.0, Size: "1280x720", Seed: 884412}},
		{Title: "萌宠柯基写真", Tags: "corgi,pet,cute", Likes: 1955, Views: 18200,
			Meta: postMeta{Type: "image", Cat: "写实", Model: "Realistic Vision",
				Desc: "草地上奔跑的柯基。", Prompt: "happy corgi running on grass, golden hour, shallow depth of field, photo",
				NegPrompt: "deformed, blurry", Steps: 30, Sampler: "DPM++ 2M Karras", CfgScale: 6.5, Size: "1216x832", Seed: 207745}},
		{Title: "霓虹和风浮世绘", Tags: "ukiyoe,neon,japan", Likes: 2344, Views: 21500,
			Meta: postMeta{Type: "image", Cat: "国风", Model: "Stable Diffusion XL",
				Desc: "浮世绘与赛博霓虹的混搭。", Prompt: "ukiyo-e wave with neon cyberpunk twist, great wave, glowing accents",
				NegPrompt: "plain", Steps: 32, Sampler: "DPM++ 2M Karras", CfgScale: 7.5, Size: "1216x832", Seed: 661230}},
	}
}
