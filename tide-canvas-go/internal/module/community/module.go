// Package community 自研社区模块（帖子 / 评论 / 点赞）。
//
// 基于 Gin + GORM 实现，与 TideCanvas 共享用户体系（sys_user）、统一响应与鉴权中间件。
// 数据表：community_post / community_comment / community_like（见 sql/schema.sql）。
//
// 对齐旧后端 CommunityController / CommunityServiceImpl：
//   - 帖子：发布 / 编辑 / 删除 / 列表（分页，按分类/作者过滤）/ 详情（浏览量+1）
//   - 评论：发表（楼中楼 parentId）/ 列表（树形）/ 删除
//   - 点赞：帖子点赞 / 取消（community_like 唯一约束，like_count 计数维护）
//
// 对外 ID 一律 public_id；正文富文本经 bluemonday 清洗防 XSS。
package community

import (
	"github.com/gin-gonic/gin"
	"github.com/sirupsen/logrus"
	"github.com/spf13/viper"
	"gorm.io/gorm"

	appjwt "github.com/tidecanvas/tide-canvas-go/pkg/jwt"
)

// Module 社区模块依赖容器。
type Module struct {
	DB     *gorm.DB
	Conf   *viper.Viper
	Logger *logrus.Logger
}

// Mount 将社区模块路由挂载到父路由组（router 传入 r.Group("/community")）。
//
// Mount 内部自构造 repository / service / handler 并注册真实路由：
//   - 因签名未携带 jwtProvider，按约定用 conf 构造（与 router.New 一致）。
func Mount(db *gorm.DB, parent gin.IRouter, conf *viper.Viper, logger *logrus.Logger) {
	mod := &Module{DB: db, Conf: conf, Logger: logger}

	// JWT 提供者（密钥与有效期来自配置，与 router.New 装配口径一致）。
	jwtProvider := appjwt.NewProvider(
		conf.GetString("jwt.secret"),
		conf.GetInt64("jwt.access_ttl"),
		conf.GetInt64("jwt.refresh_ttl"),
	)

	// 分层装配：repository → service → handler。
	repo := NewRepository(mod.DB)
	svc := NewService(repo)
	NewHandler(svc).RegisterRoutes(parent, jwtProvider)
}
