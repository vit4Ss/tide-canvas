package skill

import (
	"gorm.io/gorm"

	"tidecanvas/internal/model"
)

// seedSkill is a baseline 技能广场 entry (official). key 是种子的稳定标识,
// 永不改动(改了会被当成新技能重新插入)。
type seedSkill struct {
	key, title, description, category, outputType, promptTemplate, defaultParams string
}

// baselineSkills are the built-in official skills, seeded idempotently on boot
// so the 技能广场 is never empty. 模板前置拼接用户描述(mergeSkillPrompt),写的
// 是风格/布光/运镜等可复用前提,不是完整成品提示词。
// category 必须取自前端 SKILL_CATEGORIES(types/skill.ts),否则分类页签过滤不到;
// defaultParams 仅认 aspectRatio/resolution/duration/quality(parseSkillParams)。
var baselineSkills = []seedSkill{
	{"cinema-image", "电影质感大片", "一句大白话生成电影级质感画面,布光、景深、胶片颗粒一步到位", "专业影视", "image",
		"电影级画面质感:自然真实的布光与体积光,浅景深,35mm 胶片颗粒,高动态范围,真实的材质与皮肤质感,构图克制、讲究留白与视线引导,色彩分级参考当代电影调色。",
		`{"aspectRatio":"3:2"}`},
	{"product-white", "产品白底商拍", "电商主图级白底商拍,柔光布光、自然倒影、细节锐利", "商业广告", "image",
		"电商产品商拍:纯白无缝背景,大型柔光箱均匀布光,产品居中约占画面七成,底部轻微自然倒影,边缘干净利落,材质纹理锐利清晰,商业摄影级质感。",
		`{"aspectRatio":"1:1"}`},
	{"cel-anime", "赛璐璐动漫立绘", "干净线稿+高饱和赛璐璐上色的动漫角色立绘", "动漫游戏", "image",
		"日式赛璐璐动漫风格:干净利落的线稿,高饱和明快的配色,两段式阴影,角色立绘构图,背景简洁以突出角色,服装与发丝细节精致。",
		`{"aspectRatio":"2:3"}`},
	{"ink-wash", "国风水墨意境", "水墨晕染与大面积留白,一键东方意境", "通用技能", "image",
		"中国水墨画风格:宣纸质感,墨色浓淡层次自然晕染,大面积留白构图,淡彩点缀,笔触写意而非写实,意境悠远宁静。",
		`{"aspectRatio":"2:3"}`},
	{"blindbox-3d", "3D 盲盒公仔", "C4D 质感盲盒手办,软胶材质圆润可爱", "通用技能", "image",
		"3D 盲盒手办风格:C4D 渲染,软胶磨砂材质,圆润的 Q 版比例,大头小身,纯色柔和渐变背景,棚拍级柔光,产品渲染质感。",
		`{"aspectRatio":"1:1"}`},
	{"wes-anderson", "韦斯·安德森美学", "对称构图、马卡龙色调、平移镜头的韦氏电影短片", "专业影视", "video",
		"韦斯·安德森电影美学:严格对称构图,马卡龙低饱和配色,平稳的水平推移镜头,复古置景与服装,人物正面朝向镜头,节奏工整,带一点冷幽默感。",
		`{"aspectRatio":"16:9"}`},
	{"retro-film-ad", "复古胶片广告", "80-90 年代老电视广告质感,复古又上头", "商业广告", "video",
		"80-90 年代复古胶片广告风:16mm 胶片颗粒与轻微划痕,暖黄偏色,柔光晕影,复古字卡,轻快的剪辑节奏,老电视时代的广告腔调。",
		`{"aspectRatio":"16:9"}`},
	{"city-aerial", "城市航拍大片", "无人机黄金时刻航拍,城市天际线大片感", "专业影视", "video",
		"电影级无人机航拍:黄金时刻低角度阳光,缓慢平稳的前推与环绕运镜,城市天际线与街道纵深,大气通透,轻微雾气层次,广角透视。",
		`{"aspectRatio":"16:9"}`},
	{"lofi-chill", "治愈 Lo-fi 纯音乐", "温暖钢琴+雨声氛围的 Lo-fi 纯音乐,学习工作背景音", "音乐MV", "audio",
		"Lo-fi hip-hop 纯音乐:温暖的电钢琴主旋律,慵懒的鼓点,黑胶底噪与轻微雨声氛围,无人声,舒缓治愈,适合学习与工作时循环播放。",
		""},
	{"anime-op", "热血动漫主题曲", "激昂副歌+燃向编曲,一键热血番主题曲", "音乐MV", "audio",
		"热血动漫主题曲风格:日系摇滚编曲,失真电吉他与弦乐齐奏,节奏紧凑推进,副歌高亢激昂充满力量感,情绪层层递进,燃向氛围。",
		""},
}

// ensureBaselineSkills inserts the official skills when missing, matched by
// seed_key(稳定标识,后台改标题/下架/删除都不影响判存,绝不复活或覆盖)。
// 判存走 Unscoped:软删行也算存在——管理员删除即永久,种子不重建。
// 早期按 标题+官方作者 落库的存量行没有 seed_key,先幂等回填再判存。
func ensureBaselineSkills(db *gorm.DB) error {
	for i := range baselineSkills {
		s := baselineSkills[i]
		// 回填:仅补历史无 key 的官方同名行(只动 seed_key,内容零覆盖)。
		// 注意 AutoMigrate 对存量行新增列可能落 NULL,判空必须兼容。
		if err := db.Model(&model.Skill{}).
			Where("(seed_key = '' OR seed_key IS NULL) AND title = ? AND author_name = ?", s.title, "官方").
			Update("seed_key", s.key).Error; err != nil {
			return err
		}
		var n int64
		if err := db.Unscoped().Model(&model.Skill{}).
			Where("seed_key = ?", s.key).Count(&n).Error; err != nil {
			return err
		}
		if n > 0 {
			continue
		}
		row := &model.Skill{
			Title:          s.title,
			Description:    s.description,
			Category:       s.category,
			OutputType:     s.outputType,
			PromptTemplate: s.promptTemplate,
			DefaultParams:  s.defaultParams,
			AuthorName:     "官方",
			SeedKey:        s.key,
			Status:         1,
			SortOrder:      i,
		}
		if err := db.Create(row).Error; err != nil {
			return err
		}
	}
	return nil
}
