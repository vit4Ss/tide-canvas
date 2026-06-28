package model

import (
	"time"

	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

// SeedAdminData inserts a handful of demo rows for the admin-only sections. It is
// idempotent per table: each table is skipped when it already contains rows, so
// calling it repeatedly is safe. Call after AutoMigrate.
func SeedAdminData(db *gorm.DB) error {
	now := time.Now()

	// Collections (灵感合集).
	if err := seedIfEmpty(db, &Collection{}, []Collection{
		{Title: "国潮插画精选", Type: "合集", CoverURL: "https://cdn.tidecanvas.local/cover/guochao.jpg", LinkedWorks: 24, SortOrder: 1, Visible: true, Tags: `["插画","国潮"]`, Description: "本周精选国潮风格插画作品"},
		{Title: "赛博朋克城市", Type: "主题", CoverURL: "https://cdn.tidecanvas.local/cover/cyberpunk.jpg", LinkedWorks: 18, SortOrder: 2, Visible: true, Tags: `["科幻","城市"]`, Description: "霓虹与雨夜的未来都市"},
		{Title: "高质量人像提示词", Type: "提示词", CoverURL: "https://cdn.tidecanvas.local/cover/portrait.jpg", LinkedWorks: 12, SortOrder: 3, Visible: true, Tags: `["人像","提示词"]`, Description: "可直接复用的人像生成提示词集合"},
	}); err != nil {
		return err
	}

	// Prompt library (提示词库).
	if err := seedIfEmpty(db, &PromptLib{}, []PromptLib{
		{Text: "电影级光照下的赛博朋克城市夜景，霓虹反光，8k 超清细节", Tags: `["赛博朋克","城市"]`, Adoptions: 342, CoverURL: "https://cdn.tidecanvas.local/prompt/cyber.jpg"},
		{Text: "水彩风格的森林清晨，柔和光线，薄雾，细腻笔触", Tags: `["水彩","风景"]`, Adoptions: 215, CoverURL: "https://cdn.tidecanvas.local/prompt/forest.jpg"},
		{Text: "极简产品摄影，纯色背景，柔光，居中构图", Tags: `["产品","摄影"]`, Adoptions: 188, CoverURL: "https://cdn.tidecanvas.local/prompt/product.jpg"},
	}); err != nil {
		return err
	}

	// Home floors (首页楼层).
	if err := seedIfEmpty(db, &HomeFloor{}, []HomeFloor{
		{Name: "顶部轮播", Subtitle: "运营 banner 轮播位", Type: "banner", ContentSource: "manual", Count: 5, SortOrder: 1, Enabled: true, Layout: "carousel", Platforms: `["web","app"]`},
		{Name: "热门作品", Subtitle: "近 7 天热度排行", Type: "works", ContentSource: "auto", Count: 12, SortOrder: 2, Enabled: true, Layout: "grid", Platforms: `["web","app","mini"]`},
		{Name: "精选合集", Subtitle: "编辑精选灵感合集", Type: "collections", ContentSource: "manual", Count: 6, SortOrder: 3, Enabled: true, Layout: "list", Platforms: `["web"]`},
	}); err != nil {
		return err
	}

	// Pay channels (支付渠道).
	if err := seedIfEmpty(db, &PayChannel{}, []PayChannel{
		{Name: "支付宝", Type: "alipay", Rate: decimal.RequireFromString("0.0060"), TodayAmount: decimal.RequireFromString("12840.50"), Callback: "https://api.tidecanvas.local/pay/alipay/callback", Enabled: true, SortOrder: 1},
		{Name: "微信支付", Type: "wechat", Rate: decimal.RequireFromString("0.0060"), TodayAmount: decimal.RequireFromString("9620.00"), Callback: "https://api.tidecanvas.local/pay/wechat/callback", Enabled: true, SortOrder: 2},
		{Name: "Stripe", Type: "stripe", Rate: decimal.RequireFromString("0.0290"), TodayAmount: decimal.RequireFromString("1530.20"), Callback: "https://api.tidecanvas.local/pay/stripe/callback", Enabled: false, SortOrder: 3},
	}); err != nil {
		return err
	}

	// Point rules (积分规则).
	if err := seedIfEmpty(db, &PointRule{}, []PointRule{
		{Name: "每日签到", Scene: "checkin", Amount: 10, Trigger: "daily", Enabled: true},
		{Name: "邀请好友", Scene: "invite", Amount: 100, Trigger: "per_action", Enabled: true},
		{Name: "首次充值奖励", Scene: "first_recharge", Amount: 200, Trigger: "once", Enabled: true},
	}); err != nil {
		return err
	}

	// Campaigns (营销活动).
	if err := seedIfEmpty(db, &Campaign{}, []Campaign{
		{Name: "新用户 8 折", Type: "discount", Strength: "8折", StartTime: now.AddDate(0, 0, -3), EndTime: now.AddDate(0, 0, 27), Used: 156, Limit: 1000, Status: "active", Audience: "新用户", Channels: "网页,APP"},
		{Name: "满 100 减 20", Type: "fullreduce", Strength: "满100减20", StartTime: now.AddDate(0, 0, -1), EndTime: now.AddDate(0, 0, 6), Used: 89, Limit: 500, Status: "active", Audience: "全部", Channels: "网页"},
		{Name: "双十一闪购", Type: "flashsale", Strength: "限时5折", StartTime: now.AddDate(0, 1, 0), EndTime: now.AddDate(0, 1, 1), Used: 0, Limit: 2000, Status: "draft", Audience: "VIP 用户", Channels: "网页,APP,小程序"},
	}); err != nil {
		return err
	}

	// Coupons (优惠券).
	if err := seedIfEmpty(db, &Coupon{}, []Coupon{
		{Code: "WELCOME20", Type: "amount", Value: decimal.RequireFromString("20.00"), StartTime: now.AddDate(0, 0, -5), EndTime: now.AddDate(0, 1, 0), Used: 230, Limit: 1000, Status: "active"},
		{Code: "SAVE15PCT", Type: "percent", Value: decimal.RequireFromString("15.00"), StartTime: now.AddDate(0, 0, -2), EndTime: now.AddDate(0, 0, 28), Used: 47, Limit: 300, Status: "active"},
		{Code: "EXPIRED50", Type: "amount", Value: decimal.RequireFromString("50.00"), StartTime: now.AddDate(0, -2, 0), EndTime: now.AddDate(0, -1, 0), Used: 500, Limit: 500, Status: "expired"},
	}); err != nil {
		return err
	}

	// Admin resources (资源管理).
	if err := seedIfEmpty(db, &AdminResource{}, []AdminResource{
		{Name: "oss-assets-prod", Type: "bucket", Size: 824633720832, Refs: 12840, Status: "active", UpdateTime: now},
		{Name: "cdn-global", Type: "cdn", Size: 0, Refs: 12840, Status: "active", UpdateTime: now},
		{Name: "SourceHanSans", Type: "font", Size: 16777216, Refs: 320, Status: "active", UpdateTime: now},
		{Name: "redis-cache", Type: "cache", Size: 268435456, Refs: 1, Status: "idle", UpdateTime: now},
	}); err != nil {
		return err
	}

	// System logs (系统日志).
	if err := seedIfEmpty(db, &SysLog{}, []SysLog{
		{Level: "info", Module: "auth", Message: "管理员登录成功", IP: "10.0.0.1", Operator: "admin"},
		{Level: "warn", Module: "billing", Message: "支付回调签名校验耗时偏高", IP: "10.0.0.2", Operator: "system"},
		{Level: "error", Module: "ai", Message: "上游模型请求超时", IP: "10.0.0.3", Operator: "system"},
	}); err != nil {
		return err
	}

	// System config (系统配置).
	if err := seedIfEmpty(db, &SysConfig{}, []SysConfig{
		{ConfigKey: "site.name", ConfigValue: "潮汐画布", Group: "site", Description: "站点名称"},
		{ConfigKey: "site.icp", ConfigValue: "京ICP备00000000号", Group: "site", Description: "ICP 备案号"},
		{ConfigKey: "ai.default_points", ConfigValue: "100", Group: "ai", Description: "新用户默认赠送积分"},
		{ConfigKey: "mail.from", ConfigValue: "no-reply@tidecanvas.local", Group: "mail", Description: "系统邮件发件人"},
	}); err != nil {
		return err
	}

	// Email templates (邮件模板).
	if err := seedIfEmpty(db, &EmailTemplate{}, []EmailTemplate{
		{Name: "注册欢迎", Type: "html", Scene: "register", Variables: "nickname, code", Subject: "欢迎加入潮汐画布", Body: "<p>你好 {{nickname}}，欢迎注册！</p>", Enabled: true},
		{Name: "找回密码", Type: "html", Scene: "reset_password", Variables: "code", Subject: "重置你的密码", Body: "<p>你的验证码是 {{code}}，10 分钟内有效。</p>", Enabled: true},
		{Name: "订单支付成功", Type: "html", Scene: "order_paid", Variables: "orderNo, amount", Subject: "订单支付成功通知", Body: "<p>订单 {{orderNo}} 已支付 {{amount}} 元。</p>", Enabled: true},
	}); err != nil {
		return err
	}

	// API keys (API 密钥).
	if err := seedIfEmpty(db, &ApiKey{}, []ApiKey{
		{Name: "默认服务端密钥", Scope: "全部", KeyValue: "sk-live-demo-0001", DailyLimit: 100000, Expiry: now.AddDate(1, 0, 0), Enabled: true},
		{Name: "只读统计密钥", Scope: "只读", KeyValue: "sk-live-demo-0002", DailyLimit: 10000, Expiry: now.AddDate(0, 6, 0), Enabled: true},
		{Name: "已停用密钥", Scope: "只读", KeyValue: "sk-live-demo-0003", DailyLimit: 0, Expiry: now.AddDate(0, -1, 0), Enabled: false},
	}); err != nil {
		return err
	}

	return nil
}

// seedIfEmpty inserts rows only when the model's table has no existing records.
// It centralizes the count-then-insert idempotency pattern used per table.
func seedIfEmpty[T any](db *gorm.DB, model any, rows []T) error {
	var count int64
	if err := db.Model(model).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	if len(rows) == 0 {
		return nil
	}
	return db.Create(&rows).Error
}
