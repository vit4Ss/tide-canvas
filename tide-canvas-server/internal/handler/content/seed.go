package content

import (
	"time"

	"gorm.io/gorm"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

// seed.go inserts demo content (banners, blog categories + articles, and a few
// notifications for the admin user). It is idempotent: each section is skipped
// when rows already exist.

// Seed populates the content domain with demo data. Safe to call repeatedly.
func Seed(db *gorm.DB) error {
	if err := seedBanners(db); err != nil {
		return err
	}
	catID, err := seedBlogCategories(db)
	if err != nil {
		return err
	}
	if err := seedBlogArticles(db, catID); err != nil {
		return err
	}
	if err := seedNotifications(db); err != nil {
		return err
	}
	return nil
}

// seedBanners inserts ~3 home banners when none exist.
func seedBanners(db *gorm.DB) error {
	var count int64
	if err := db.Model(&model.Banner{}).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	banners := []model.Banner{
		{
			BaseModel: model.BaseModel{ID: idgen.Next()},
			Title:     "AI 创意画布，灵感即刻成形",
			ImageURL:  "https://picsum.photos/seed/tide-banner-1/1600/600",
			LinkURL:   "/studio",
			Position:  "home_top",
			SortOrder: 1,
			Status:    1,
		},
		{
			BaseModel: model.BaseModel{ID: idgen.Next()},
			Title:     "探索社区精选作品",
			ImageURL:  "https://picsum.photos/seed/tide-banner-2/1600/600",
			LinkURL:   "/explore",
			Position:  "home_top",
			SortOrder: 2,
			Status:    1,
		},
		{
			BaseModel: model.BaseModel{ID: idgen.Next()},
			Title:     "模型市场限时上新",
			ImageURL:  "https://picsum.photos/seed/tide-banner-3/1600/600",
			LinkURL:   "/models",
			Position:  "home_top",
			SortOrder: 3,
			Status:    1,
		},
	}
	return db.Create(&banners).Error
}

// seedBlogCategories inserts demo categories when none exist and returns the id
// of the primary category to attach articles to. When categories already exist
// it returns the first existing category id.
func seedBlogCategories(db *gorm.DB) (idgen.ID, error) {
	var existing model.BlogCategory
	err := db.Order("sort_order ASC").First(&existing).Error
	if err == nil {
		return existing.ID, nil
	}
	if err != gorm.ErrRecordNotFound {
		return 0, err
	}

	cats := []model.BlogCategory{
		{BaseModel: model.BaseModel{ID: idgen.Next()}, Name: "产品动态", Slug: "product", SortOrder: 1, Status: 1},
		{BaseModel: model.BaseModel{ID: idgen.Next()}, Name: "使用教程", Slug: "tutorial", SortOrder: 2, Status: 1},
		{BaseModel: model.BaseModel{ID: idgen.Next()}, Name: "灵感分享", Slug: "inspiration", SortOrder: 3, Status: 1},
	}
	if err := db.Create(&cats).Error; err != nil {
		return 0, err
	}
	return cats[0].ID, nil
}

// seedBlogArticles inserts ~4 published articles when none exist.
func seedBlogArticles(db *gorm.DB, categoryID idgen.ID) error {
	var count int64
	if err := db.Model(&model.BlogArticle{}).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return nil
	}

	author := adminUserID(db)
	cat := categoryID
	now := time.Now()

	articles := []model.BlogArticle{
		{
			BaseModel:   model.BaseModel{ID: idgen.Next()},
			CategoryID:  &cat,
			AuthorID:    author,
			Title:       "TideCanvas 正式发布：用 AI 重新定义创作",
			Slug:        "tidecanvas-launch",
			Summary:     "我们很高兴地宣布 TideCanvas 正式上线，带来全新的 AI 创意画布体验。",
			Content:     "# TideCanvas 正式发布\n\nTideCanvas 是一款融合 AI 生成能力的创意画布工具，让创作更高效、更自由。",
			CoverURL:    "https://picsum.photos/seed/tide-blog-1/1200/630",
			ViewCount:   1280,
			Status:      1,
			PublishTime: ptrTime(now.Add(-96 * time.Hour)),
		},
		{
			BaseModel:   model.BaseModel{ID: idgen.Next()},
			CategoryID:  &cat,
			AuthorID:    author,
			Title:       "新手入门：5 分钟上手 AI 画布",
			Slug:        "getting-started-5min",
			Summary:     "从创建项目到生成第一张作品，带你快速熟悉 TideCanvas 的核心工作流。",
			Content:     "# 新手入门\n\n1. 创建项目\n2. 选择模型\n3. 输入提示词\n4. 生成并微调\n5. 发布到社区",
			CoverURL:    "https://picsum.photos/seed/tide-blog-2/1200/630",
			ViewCount:   860,
			Status:      1,
			PublishTime: ptrTime(now.Add(-72 * time.Hour)),
		},
		{
			BaseModel:   model.BaseModel{ID: idgen.Next()},
			CategoryID:  &cat,
			AuthorID:    author,
			Title:       "提示词技巧：让生成结果更可控",
			Slug:        "prompt-tips",
			Summary:     "掌握这些提示词写法，让 AI 输出更贴近你的预期。",
			Content:     "# 提示词技巧\n\n- 结构化描述主体、风格、光影\n- 善用负向提示词\n- 迭代式微调",
			CoverURL:    "https://picsum.photos/seed/tide-blog-3/1200/630",
			ViewCount:   642,
			Status:      1,
			PublishTime: ptrTime(now.Add(-48 * time.Hour)),
		},
		{
			BaseModel:   model.BaseModel{ID: idgen.Next()},
			CategoryID:  &cat,
			AuthorID:    author,
			Title:       "社区精选：本周最受欢迎的 10 个作品",
			Slug:        "weekly-top-10",
			Summary:     "看看创作者们本周都用 TideCanvas 做出了哪些惊艳的作品。",
			Content:     "# 本周精选\n\n本周社区涌现了大量优秀作品，以下是编辑精选的 10 个。",
			CoverURL:    "https://picsum.photos/seed/tide-blog-4/1200/630",
			ViewCount:   1530,
			Status:      1,
			PublishTime: ptrTime(now.Add(-24 * time.Hour)),
		},
	}
	return db.Create(&articles).Error
}

// seedNotifications inserts a few demo notifications for the admin user when the
// admin has none yet.
func seedNotifications(db *gorm.DB) error {
	admin := adminUserID(db)
	if admin == 0 {
		return nil // no admin yet (model.Seed not run); nothing to attach to.
	}

	var count int64
	if err := db.Model(&model.Notification{}).Where("user_id = ?", admin).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return nil
	}

	notifs := []model.Notification{
		{
			BaseModel: model.BaseModel{ID: idgen.Next()},
			UserID:    admin,
			Type:      "system",
			Title:     "欢迎使用 TideCanvas",
			Content:   "感谢注册！开始创建你的第一个 AI 画布项目吧。",
			LinkURL:   "/studio",
			IsRead:    0,
		},
		{
			BaseModel: model.BaseModel{ID: idgen.Next()},
			UserID:    admin,
			Type:      "system",
			Title:     "积分赠送到账",
			Content:   "新用户专属积分已发放到你的账户，可用于 AI 生成。",
			LinkURL:   "/pricing",
			IsRead:    0,
		},
		{
			BaseModel: model.BaseModel{ID: idgen.Next()},
			UserID:    admin,
			Type:      "system",
			Title:     "模型市场上新提醒",
			Content:   "本周有多款热门模型上架，快去模型市场看看吧。",
			LinkURL:   "/models",
			IsRead:    1,
			ReadTime:  ptrTime(time.Now().Add(-time.Hour)),
		},
	}
	return db.Create(&notifs).Error
}

// adminUserID returns the first admin (role 9) user id, or 0 when none exists.
func adminUserID(db *gorm.DB) idgen.ID {
	var u model.User
	if err := db.Select("id").Where("role = ?", 9).Order("create_time ASC").First(&u).Error; err != nil {
		return 0
	}
	return u.ID
}

// ptrTime returns a pointer to t.
func ptrTime(t time.Time) *time.Time { return &t }
