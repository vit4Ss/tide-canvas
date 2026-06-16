// Package router 注册 HTTP 路由并装配各业务模块。
package router

import (
	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/sirupsen/logrus"
	"github.com/spf13/viper"
	"gorm.io/gorm"

	"github.com/redis/go-redis/v9"

	"github.com/tidecanvas/tide-canvas-go/internal/middleware"
	"github.com/tidecanvas/tide-canvas-go/internal/module/admin"
	"github.com/tidecanvas/tide-canvas-go/internal/module/ai"
	"github.com/tidecanvas/tide-canvas-go/internal/module/auth"
	"github.com/tidecanvas/tide-canvas-go/internal/module/banner"
	"github.com/tidecanvas/tide-canvas-go/internal/module/blog"
	"github.com/tidecanvas/tide-canvas-go/internal/module/canvas"
	"github.com/tidecanvas/tide-canvas-go/internal/module/community"
	"github.com/tidecanvas/tide-canvas-go/internal/module/content"
	"github.com/tidecanvas/tide-canvas-go/internal/module/email"
	"github.com/tidecanvas/tide-canvas-go/internal/module/file"
	"github.com/tidecanvas/tide-canvas-go/internal/module/im"
	logmod "github.com/tidecanvas/tide-canvas-go/internal/module/log"
	"github.com/tidecanvas/tide-canvas-go/internal/module/monitor"
	"github.com/tidecanvas/tide-canvas-go/internal/module/oauth"
	"github.com/tidecanvas/tide-canvas-go/internal/module/points"
	"github.com/tidecanvas/tide-canvas-go/internal/module/recharge"
	"github.com/tidecanvas/tide-canvas-go/internal/module/redeem"
	"github.com/tidecanvas/tide-canvas-go/internal/module/security"
	"github.com/tidecanvas/tide-canvas-go/internal/module/setting"
	"github.com/tidecanvas/tide-canvas-go/internal/module/team"
	"github.com/tidecanvas/tide-canvas-go/internal/module/user"
	appjwt "github.com/tidecanvas/tide-canvas-go/pkg/jwt"
)

// New 构造 Gin 引擎，装配中间件与业务模块路由。
func New(db *gorm.DB, conf *viper.Viper, logger *logrus.Logger, rdb *redis.Client) *gin.Engine {
	r := gin.New()
	r.Use(gin.Logger(), middleware.Recovery(logger), corsMiddleware(conf), middleware.AccessLog(db, logger))

	// 健康检查
	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	// JWT 提供者（密钥与有效期来自配置）
	jwtProvider := appjwt.NewProvider(
		conf.GetString("jwt.secret"),
		conf.GetInt64("jwt.access_ttl"),
		conf.GetInt64("jwt.refresh_ttl"),
	)

	// 共享 repository
	userRepo := user.NewRepository(db)

	// 限流后端：Redis 可用 → 分布式 RedisLimiter（多副本共享封禁）；否则单机 MemoryLimiter。
	// 显式构造后既设为限流中间件的包级默认（SetDefaultLimiter），又注入 security 管理端模块，
	// 使「自动封禁(限流违规)」与「管理端手动封禁/解封」操作同一份封禁数据。
	var limiter middleware.Limiter
	if rdb != nil {
		limiter = middleware.NewRedisLimiter(rdb).WithLogger(logger)
	} else {
		limiter = middleware.NewMemoryLimiter()
	}
	middleware.SetDefaultLimiter(limiter)

	// Redis 可用时启用分布式验证码/直传票据（多副本必需）；rdb 为 nil 时回退单机内存实现。
	var codeStore email.CodeStore
	ticketStore := file.TicketStore(file.NewMemoryTicketStore())
	if rdb != nil {
		codeStore = email.NewRedisCodeStore(rdb).WithLogger(logger)
		ticketStore = file.NewRedisTicketStore(rdb).WithLogger(logger)
	}

	// ---- /api 业务路由 ----
	api := r.Group("/api")

	// team 模块（创建/加入/退出/解散/移除成员/我的团队）。
	// teamSvc 同时实现 auth.TeamPriceProvider，对外提供 AI 计费加价系数 GetPriceFactor，注入 auth 等模块复用。
	teamSvc := team.NewService(team.NewRepository(db), logger)
	team.NewHandler(teamSvc, jwtProvider).RegisterRoutes(api, jwtProvider)

	// auth 模块（注册/登录/刷新/改密/当前用户）。加价系数依赖注入真实 team 服务。
	// 验证码服务由 email 模块提供（SMTP + 模板渲染 + 验证码存储；mail.enabled=false 时走开发模式打日志）。
	authSvc := auth.NewService(userRepo, jwtProvider, email.NewService(db, conf, logger, codeStore), teamSvc)
	auth.NewHandler(authSvc, jwtProvider).RegisterRoutes(api)

	// points 模块（积分余额/流水分页 + 每日签到/状态/日历）。
	// pointsSvc 同时作为兑换码/博客/AI/充值/管理端的积分能力依赖，可注入复用其 AddPoints/DeductPoints。
	pointsSvc := points.NewService(points.NewRepository(db), logger)
	points.NewHandler(pointsSvc, jwtProvider).RegisterRoutes(api, jwtProvider)

	// canvas 模块（项目 CRUD / 画布数据存取 / 分享链接）。
	// 团队共享可见性注入真实 team 服务；归属用户 public_id 映射用 DBUserFinder 直读 sys_user 投影。
	canvasSvc := canvas.NewService(canvas.NewRepository(db), teamSvc, canvas.NewDBUserFinder(db))
	canvas.NewHandler(canvasSvc).RegisterRoutes(api, jwtProvider)

	// file 模块（本地上传 / OSS 直传预签名+登记 / 列表 / 删除 / 代理下载 / 从URL保存）。
	// 存储后端按 storage.kind 选择 local/oss；团队共享与归属映射复用 teamSvc + DBUserFinder。
	// 直传票据用进程内 MemoryTicketStore（多实例须换 Redis 实现）；操作日志暂打日志，待 ai 模块迁移落库。
	fileStorage := newFileStorage(conf, logger)
	fileSvc := file.NewService(
		file.NewRepository(db),
		fileStorage,
		file.NewDBUserFinder(db),
		teamSvc,
		file.LogOperationLogger{Logger: logger},
		ticketStore,
		file.Config{
			MaxSize:      conf.GetInt64("storage.max_size"),
			AllowedTypes: conf.GetStringSlice("storage.allowed_types"),
		},
	)
	file.NewHandler(fileSvc, jwtProvider).RegisterRoutes(api, jwtProvider)

	// banner 模块（公开轮播图列表 + 管理端 CRUD）
	banner.NewHandler(banner.NewService(banner.NewRepository(db)), jwtProvider).RegisterRoutes(api, jwtProvider)

	// redeem 兑换码（用户兑换 + 管理端生成/列表/停用），注入积分服务
	redeem.NewHandler(redeem.NewService(redeem.NewRepository(db), pointsSvc, logger), jwtProvider).RegisterRoutes(api, jwtProvider)

	// blog 博客（发布/付费阅读/打赏/点赞），注入积分服务与作者信息查询
	blogSvc := blog.NewService(blog.NewRepository(db), blog.NewDBUserFinder(db), pointsSvc, logger)
	blog.NewHandler(blogSvc).RegisterRoutes(api, jwtProvider)

	// RBAC 按钮级权限加载器：读 sys_user+sys_role 解析权限串，admin / ai / log / recharge 管理端路由由 RequiresPermission 复用。
	permLoader := middleware.NewDBPermissionLoader(db)

	// recharge 充值订单 + 易支付（notify 回调公开 / 管理端订单 /api/admin/orders 挂 RBAC），注入积分服务
	recharge.NewHandler(recharge.NewService(recharge.NewRepository(db), pointsSvc, logger), jwtProvider).RegisterRoutes(api, jwtProvider, permLoader)

	// admin 后台管理（用户/角色/作者/邮件模板/积分/数据面板），全程 JWTAuth + AdminOnly + RBAC 按钮级权限。
	admin.NewHandler(admin.NewRepository(db), pointsSvc, admin.NoopMailSender{Logger: logger}, jwtProvider, logger).RegisterRoutes(api, jwtProvider, permLoader)

	// content 内容审核（管理端：公开作品分页 + 审核改状态），权限码 content:view / content:audit。
	content.NewHandler(db, logger).RegisterRoutes(api, jwtProvider, permLoader)

	// setting 系统设置（管理端：sys_config 读取 + 批量保存），权限码 setting:view / setting:edit。
	setting.NewHandler(db).RegisterRoutes(api, jwtProvider, permLoader)

	// ai 模块（平台最核心）：统一生成入口 / 任务轮询 / 取消 / 历史 / 宫格切分 + 管理端 provider/model/handler CRUD。
	//   - 扣/退积分注入 pointsSvc；团队共享口径 + 加价系数注入 teamSvc（同时满足 TeamMemberProvider/TeamPriceProvider）。
	//   - 画布归属用 DBProjectFinder；上游(中转站/Runware)轮询/重试/超时取 config 的 ai.relay.* / ai.runware.*。
	//   - 结果转存 FileSaver 暂传 nil（直接存上游原 URL，见模块说明）；宫格切片上传复用 file 存储后端。
	aiRepo := ai.NewRepository(db)
	aiSvc := ai.NewService(
		aiRepo,
		newAIClientConfig(conf),
		pointsSvc,
		teamSvc, // TeamMemberProvider（GetTeamMemberIDs）
		teamSvc, // TeamPriceProvider（GetPriceFactor）
		ai.NewDBProjectFinder(db),
		file.NewURLSaver(fileStorage, 0, logger), // FileSaver：把 AI 上游临时 URL 转存到自有 OSS（默认 100MB 上限）
		logger,
	)
	aiAdminSvc := ai.NewAdminService(aiRepo, aiSvc.Gateway(), ai.NewDBUserFinder(db), logger)
	ai.NewHandler(aiSvc, aiAdminSvc, fileGridStorage{store: fileStorage}).RegisterRoutes(api, jwtProvider, permLoader)
	// 任务收尾：进程就绪后收一次孤儿任务，并每 5 分钟扫描超时任务（兜底上游卡死/goroutine 泄漏）。
	aiSvc.RecoverOnStartup()
	ai.StartRecoveryScheduler(aiSvc, conf.GetInt64("ai.task.timeout-scan-ms"), logger)

	// oauth 第三方登录（GitHub/Google/微信，均为公开路由）
	oauth.NewHandler(oauth.NewService(userRepo, jwtProvider, conf, logger)).RegisterRoutes(api)

	// log 日志查询（管理端：访问/登录/操作日志分页 + PV/UV 统计），JWTAuth + AdminOnly + RBAC 按钮级权限。
	logmod.NewHandler(logmod.NewService(logmod.NewRepository(db), logger)).RegisterRoutes(api, jwtProvider, permLoader)

	// monitor 监控总览（管理端：系统指标/Redis 状态/在线会话），权限码 monitor:view。
	//   系统指标用 gopsutil 采集（CPU/内存/磁盘/网卡），JVM 堆以 Go runtime 近似；rdb 为 nil 时 redis 接口回退未连接。
	monitor.NewHandler(db, rdb, logger).RegisterRoutes(api, jwtProvider, permLoader)

	// security 安全封禁（管理端：查看/手动封禁/解封），权限码 security:view / security:manage。
	//   注入与限流中间件同一 limiter 实例，使自动封禁与管理端手动封禁/解封共用一份数据。
	security.NewHandler(limiter).RegisterRoutes(api, jwtProvider, permLoader)

	// 社区模块（自研：帖子/评论/点赞）挂载到 /api/community/
	community.Mount(db, api.Group("/community"), conf, logger)

	// IM 即时通讯（私信/客服/后台三类会话 + WebSocket 实时推送 + 在线状态）。
	//   hub↔service 循环依赖经 SetHub 解开；WS 握手自鉴权(query token)，REST 走 JWTAuth。
	//   在线=有 WS 连接(单实例内存)；多实例需将 Hub/在线状态换 Redis（见 im/hub.go TODO）。
	imSvc := im.NewService(im.NewRepository(db), im.NewDBUserFinder(db), logger)
	imHub := im.NewHub(logger, imSvc.OnUserOnline, imSvc.OnUserOffline, rdb)
	imSvc.SetHub(imHub)
	imWS := im.NewWSHandler(imHub, imSvc, jwtProvider, logger, conf.GetStringSlice("cors.allowed_origins"))
	im.NewHandler(imSvc, imWS).RegisterRoutes(api, jwtProvider)

	return r
}

// newAIClientConfig 从配置读取上游(中转站/Runware)轮询、重试、超时参数；缺省回退默认值（对齐旧 ai.relay.* / ai.runware.*）。
func newAIClientConfig(conf *viper.Viper) ai.ClientConfig {
	c := ai.DefaultClientConfig()
	overrideInt64(conf, "ai.relay.poll-interval-ms", &c.RelayPollIntervalMs)
	overrideInt64(conf, "ai.relay.poll-timeout-ms", &c.RelayPollTimeoutMs)
	overrideInt(conf, "ai.relay.max-retries", &c.RelayMaxRetries)
	overrideInt64(conf, "ai.relay.retry-delay-ms", &c.RelayRetryDelayMs)
	overrideInt(conf, "ai.relay.connect-timeout-ms", &c.RelayConnectTimeoutMs)
	overrideInt(conf, "ai.relay.read-timeout-ms", &c.RelayReadTimeoutMs)
	overrideInt64(conf, "ai.runware.poll-interval-ms", &c.RunwarePollIntervalMs)
	overrideInt64(conf, "ai.runware.poll-timeout-ms", &c.RunwarePollTimeoutMs)
	overrideInt(conf, "ai.runware.connect-timeout-ms", &c.RunwareConnectTimeoutMs)
	overrideInt(conf, "ai.runware.read-timeout-ms", &c.RunwareReadTimeoutMs)
	return c
}

// overrideInt64 配置存在该键时覆盖目标值。
func overrideInt64(conf *viper.Viper, key string, target *int64) {
	if conf.IsSet(key) {
		*target = conf.GetInt64(key)
	}
}

// overrideInt 配置存在该键时覆盖目标值。
func overrideInt(conf *viper.Viper, key string, target *int) {
	if conf.IsSet(key) {
		*target = conf.GetInt(key)
	}
}

// fileGridStorage 把 file.Storage 适配为 ai.GridStorage（宫格切片上传），避免 ai 模块直接耦合 file 模块。
type fileGridStorage struct{ store file.Storage }

// UploadBytes 上传切片字节并返回公网访问地址（对齐旧 StorageStrategy.uploadBytes + getAccessUrl）。
func (g fileGridStorage) UploadBytes(data []byte, fileName, contentType, directory string) (string, error) {
	key, err := g.store.Upload(data, fileName, contentType, directory)
	if err != nil {
		return "", err
	}
	return g.store.PublicURL(key), nil
}

// newFileStorage 按 storage.kind 构造文件存储后端（local / oss，缺省 local）。
func newFileStorage(conf *viper.Viper, logger *logrus.Logger) file.Storage {
	if conf.GetString("storage.kind") == "oss" {
		return file.NewOSSStorage(
			conf.GetString("storage.oss.endpoint"),
			conf.GetString("storage.oss.access_key_id"),
			conf.GetString("storage.oss.access_key_secret"),
			conf.GetString("storage.oss.bucket"),
			conf.GetString("storage.oss.prefix"),
			conf.GetString("storage.oss.cdn_domain"),
		)
	}
	localDir := conf.GetString("storage.local_dir")
	if localDir == "" {
		localDir = "./uploads"
	}
	if logger != nil {
		logger.Infof("[file] 使用本地存储: %s（不支持前端直传，OSS 需配置 storage.kind=oss）", localDir)
	}
	return file.NewLocalStorage(localDir)
}

// corsMiddleware 基于配置构造 CORS 中间件。
func corsMiddleware(conf *viper.Viper) gin.HandlerFunc {
	origins := conf.GetStringSlice("cors.allowed_origins")
	if len(origins) == 0 {
		origins = []string{"http://localhost:3000"}
	}
	return cors.New(cors.Config{
		AllowOrigins:     origins,
		AllowMethods:     []string{"GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization"},
		AllowCredentials: conf.GetBool("cors.allow_credentials"),
		MaxAge:           300,
	})
}
