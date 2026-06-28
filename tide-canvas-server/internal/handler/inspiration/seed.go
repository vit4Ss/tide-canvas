package inspiration

import (
	"fmt"
	"time"

	"gorm.io/gorm"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

// seed.go provides idempotent demo data for the public 灵感 page: a prompt library
// (PromptLib) and a few curated theme collections (Collection). Tags columns are
// MySQL json, so they are stored as valid JSON array strings.

type seedPrompt struct {
	Text      string
	Tags      string // JSON array, e.g. `["科幻","赛博朋克"]`
	Adoptions int
}

type seedCollection struct {
	Title string
	Cover string
	Tags  string
	Desc  string
}

// Seed inserts demo prompts + collections when each table is empty. Idempotent.
func Seed(db *gorm.DB) error {
	if err := seedPrompts(db); err != nil {
		return err
	}
	return seedCollections(db)
}

func seedPrompts(db *gorm.DB) error {
	var count int64
	if err := db.Model(&model.PromptLib{}).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return nil
	}

	prompts := demoPrompts()
	now := time.Now()
	rows := make([]model.PromptLib, 0, len(prompts))
	for i, p := range prompts {
		rows = append(rows, model.PromptLib{
			BaseModel: model.BaseModel{
				ID:         idgen.Next(),
				CreateTime: now.Add(-time.Duration(i) * time.Hour),
				UpdateTime: now.Add(-time.Duration(i) * time.Hour),
			},
			Text:      p.Text,
			Tags:      p.Tags,
			Adoptions: p.Adoptions,
			CoverURL:  fmt.Sprintf("https://picsum.photos/seed/flp%d/640/800", i+1),
		})
	}
	return db.Create(&rows).Error
}

func seedCollections(db *gorm.DB) error {
	var count int64
	if err := db.Model(&model.Collection{}).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return nil
	}

	cols := demoCollections()
	now := time.Now()
	rows := make([]model.Collection, 0, len(cols))
	for i, c := range cols {
		rows = append(rows, model.Collection{
			BaseModel: model.BaseModel{
				ID:         idgen.Next(),
				CreateTime: now.Add(-time.Duration(i) * time.Hour),
				UpdateTime: now.Add(-time.Duration(i) * time.Hour),
			},
			Title:       c.Title,
			Type:        "主题",
			CoverURL:    c.Cover,
			SortOrder:   i,
			Visible:     true,
			Tags:        c.Tags,
			Description: c.Desc,
		})
	}
	return db.Create(&rows).Error
}

// demoPrompts is a hand-written set of reusable creation prompts (no scraped
// content) spanning common AI-art styles.
func demoPrompts() []seedPrompt {
	return []seedPrompt{
		{"赛博朋克城市夜景，霓虹灯倒影在湿润街道，电影级布光，体积光，8K 超写实", `["科幻","赛博朋克","城市"]`, 3280},
		{"青绿山水工笔，石青石绿设色，宋代院体，留白意境，绢本质感", `["国风","山水","工笔"]`, 2910},
		{"液态金属机器人，纯白工作室布光，C4D 渲染，硬表面细节，反射高光", `["科幻","机械","渲染"]`, 2540},
		{"黄昏侧颜人像，85mm f/1.4 浅景深，柯达胶片颗粒，暖色调，逆光发丝", `["人像","写实","胶片"]`, 2330},
		{"深海发光水母，慢镜头，4K 微距，蓝紫光束，颗粒悬浮，梦幻氛围", `["自然","微距","梦幻"]`, 2105},
		{"日系动漫少女，樱花飘落，柔和打光，精致眼睛，清新厚涂", `["二次元","动漫","人物"]`, 4012},
		{"敦煌飞天壁画重绘，金箔与石青，飘带流动，矿物颜料质感", `["国风","壁画","传统"]`, 1980},
		{"扁平插画风城市生活，撞色几何，孟菲斯元素，活泼明快", `["插画","扁平","设计"]`, 1620},
		{"未来概念跑车，流线气动造型，棚拍渲染，湿地面反射，冷色调", `["设计","汽车","渲染"]`, 1475},
		{"北欧极简室内，原木与暖光，柔和阴影，杂志摄影感", `["写实","室内","摄影"]`, 1340},
		{"蒸汽朋克机械昆虫，黄铜齿轮，精密发条，微距特写", `["科幻","蒸汽朋克","机械"]`, 1288},
		{"国潮龙纹海报，红金配色，繁复纹样，对称构图，烫金质感", `["国风","国潮","海报"]`, 1910},
		{"治愈系田园黄昏，金色麦田，强风掠过，电影调色，航拍视角", `["自然","风光","治愈"]`, 1156},
		{"暗黑哥特城堡，满月薄雾，戏剧化光影，超广角，史诗氛围", `["幻想","哥特","场景"]`, 1402},
		{"美食广告特写，热气腾腾，商业布光，浅景深，诱人质感", `["写实","美食","商业"]`, 980},
		{"水墨侠客立绘，白衣飘逸，泼墨背景，动势张力，留白", `["国风","武侠","立绘"]`, 1733},
		{"霓虹雨夜便利店，暖光透窗，湿地倒影，赛博日常，电影感", `["二次元","场景","氛围"]`, 2670},
		{"抽象流体艺术，大理石纹理，鲜艳撞色，丝绸流动质感", `["抽象","流体","艺术"]`, 760},
		{"宇宙星云漫游，绚丽气体云，星点闪烁，深空电影感，超清", `["科幻","太空","壮观"]`, 1844},
		{"宫崎骏风格小镇黄昏，温暖云霞，温馨房屋，细腻笔触", `["二次元","治愈","场景"]`, 2980},
		{"机甲战士全身设定稿，硬表面装甲，戏剧打光，三视图", `["科幻","机甲","设定"]`, 1520},
		{"莫奈印象派花园，松散笔触，睡莲，柔光，色彩斑斓", `["抽象","印象派","风景"]`, 1090},
		{"萌宠柯基写真，草地奔跑，金色时刻，浅景深，治愈摄影", `["写实","宠物","摄影"]`, 1955},
		{"浮世绘融合赛博霓虹，巨浪与发光描边，和风混搭未来感", `["国风","浮世绘","混搭"]`, 1466},
	}
}

func demoCollections() []seedCollection {
	pic := func(s string) string { return "https://picsum.photos/seed/" + s + "/600/400" }
	return []seedCollection{
		{"赛博未来", pic("flc1"), `["科幻","赛博朋克"]`, "霓虹、机械与未来都市的灵感合集"},
		{"国风新潮", pic("flc2"), `["国风","国潮"]`, "水墨、工笔与国潮新视觉"},
		{"治愈日常", pic("flc3"), `["治愈","二次元"]`, "温暖光影下的日常小确幸"},
		{"写实人像", pic("flc4"), `["人像","写实"]`, "胶片质感与自然光人像"},
		{"奇幻世界", pic("flc5"), `["幻想","场景"]`, "魔法、城堡与异世界场景"},
		{"产品视觉", pic("flc6"), `["设计","渲染"]`, "棚拍质感的产品与概念设计"},
	}
}
