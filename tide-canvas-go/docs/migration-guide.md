# Go 迁移规范（模块迁移指南）

从旧 Spring Boot 后端（`../tide-canvas-server`）迁移业务模块到 Go（Gin + GORM）的统一约定。**每个模块迁移必须严格遵守**，以保证全项目一致、可编译。

## 模块结构
- 目录：`internal/module/<name>/`，文件：`dto.go`、`repository.go`、`service.go`、`handler.go`（按需拆分）。
- 模型**已全部定义**在 `internal/model/`，**勿重新定义**。三基类：
  - `PublicModel`：id + public_id + create_time + update_time + deleted（对外业务实体）
  - `SoftDeleteModel`：id + 时间戳 + deleted
  - `BaseModel`：id + 时间戳（日志/中间表）
  - 主键 `ID int64` 雪花（`BeforeCreate` 自动注入）；对外 `PublicID string`（UUID v4）。

## 分层
- repository：`type Repository struct{ db *gorm.DB }`；`func NewRepository(db *gorm.DB) *Repository`。GORM 自动过滤 `deleted`。
- service：业务逻辑，忠实旧 `*ServiceImpl`。业务错误返回 `*ecode.Error`。
- handler：`type Handler struct{...}`；`func (h *Handler) RegisterRoutes(api gin.IRouter, jwtProvider *jwt.Provider)`。

## 统一响应（`pkg/response`）
- 成功：`response.OK(c, data)`
- 分页：`response.OK(c, response.Page(records, total, pageNum, pageSize))`
- 失败：`response.FailErr(c, err)`（自动识别 `*ecode.Error`，否则按 500）
- 参数错误：`response.Fail(c, ecode.BadRequest)`

## 错误码（`pkg/ecode`）
- 复用 `pkg/ecode/ecode.go` 已有码。缺的码追加到该文件，**code 数值沿用旧 `ResultCode`**。
- service 返回 `ecode.XXX` 或 `ecode.XXX.WithMessage("自定义文案")`。

## 鉴权（`internal/middleware`）
- 当前用户：`middleware.MustUserID(c)` → `int64`
- 角色：`middleware.RoleOf(c)`；管理员常量 `middleware.RoleAdmin`（=9）
- 保护路由：`g.Use(middleware.JWTAuth(jwtProvider))`；管理员再加 `middleware.AdminOnly()`

## 对外 ID 规范
- 接口路径参数、响应里的资源 id 一律用 **public_id（string）**，绝不暴露雪花主键。
- 按 public_id 查询：`repo.FindByPublicID(publicID)`。
- 响应 VO 的 `id` 字段 = `model.PublicID`。

## 类型
- 金额：`github.com/shopspring/decimal`
- JSON 列：`gorm.io/datatypes`（`datatypes.JSON`）
- 时间：`time.Time` / `*time.Time`
- 事务：`db.Transaction(func(tx *gorm.DB) error { ... })`

## 跨模块依赖
- **不直接耦合**其他模块的具体实现。在本模块内定义接口（如 `PointsService`、`UserFinder`），用 `// TODO(wire)` 注释标注待注入；由 `router.New` 装配时注入，或先用占位实现。
- 共享 `userRepo`（`internal/module/user`）可由 router 注入。

## 路由前缀
- 对齐旧 `@RequestMapping`（如 `/api/projects`、`/api/ai`、`/api/points`）。
- 在 `router.New` 的 `api := r.Group("/api")` 下注册。

## 样板参考
- `internal/module/auth/`（dto/service/handler：鉴权、VO、错误码、登录日志、双令牌）
- `internal/module/user/repository.go`（FindByID/FindByPublicID/Exists/Create/UpdateColumns）

## 硬约束
- 本机**无 Go 工具链**，无法 `go build`。务必保证语法正确、imports 完整无冗余、包名一致。
- **忠实翻译**旧业务规则（参数校验、状态机、积分扣减、唯一性、分页）。
- 完成后报告：产出文件、暴露路由、定义的跨模块依赖接口（供注入）、不确定点。
