# tide-canvas-go

TideCanvas 后端的 **Go 重构版**（Gin + GORM + MySQL 8），全量替代原 Spring Boot 后端（`../tide-canvas-server`）。社区为**自研**模块（非 bbs-go），无 GPL 约束。

## 技术栈

| 维度 | 选型 |
|------|------|
| Web 框架 | [Gin](https://github.com/gin-gonic/gin) |
| ORM | [GORM](https://gorm.io) + MySQL |
| 配置 | [Viper](https://github.com/spf13/viper) |
| 日志 | [Logrus](https://github.com/sirupsen/logrus) + lumberjack(切割) |
| 主键 | 雪花ID（`bwmarrin/snowflake`） |
| 对外ID | UUID v4（`google/uuid`） |
| 认证 | JWT（`golang-jwt/jwt`） |
| 参数校验 | `validator/v10` |
| 富文本清洗 | `bluemonday`（XSS） |
| HTTP 客户端 | `resty`（AI 中转站调用） |
| 软删除 | `gorm soft_delete`（deleted 0/1） |

## 目录结构

```
tide-canvas-go/
├── cmd/server/main.go          # 入口（viper + logrus + gorm 装配）
├── internal/
│   ├── model/                  # GORM 实体（集中，跨模块共享）+ base.go 基类
│   ├── module/                 # 业务模块（按域分包，高内聚）
│   │   ├── community/          # 自研社区（帖子/评论/点赞）
│   │   └── (auth/user/canvas/ai/...) # 迁移中
│   ├── middleware/             # 横切中间件（JWT/CORS/限流/访问日志）
│   ├── router/                 # 路由装配
│   └── config/                 # 配置（向后兼容 .env，新代码用 viper）
├── pkg/
│   ├── snowflake/              # 雪花ID 生成器
│   └── (response/ecode/...)  # 通用工具（迁移中）
├── configs/config.example.yaml # 配置模板
├── sql/schema.sql              # 完整 DDL（26 表）
├── docs/db-optimization.md     # 数据库优化说明
└── go.mod
```

## 快速开始

前置：**Go 1.23+**、**MySQL 8.0+**、（可选）Redis。

```bash
# 1. 初始化数据库（建库 + 26 表 + 种子）
mysql -u root -p < sql/schema.sql

# 2. 配置
cp configs/config.example.yaml configs/config.yaml   # 按需编辑

# 3. 依赖并运行
go mod tidy
go run ./cmd/server

# 4. 验证
curl http://localhost:8080/health        # {"status":"ok"}
curl http://localhost:8080/community/ping
```

## 架构约定

- **分层**：`handler`（HTTP）→ `service`（业务）→ `repository`（GORM 数据访问），按业务模块分包。
- **主键/对外ID**：主键 `id` 为雪花ID（应用层生成）；对外接口只暴露 `public_id`（UUID v4，JSON 字段名 `id`），隐藏雪花主键，防枚举。
- **统一响应**：对齐阿里 RESTful 规范（`code`/`message`/`data`），见 `pkg/response`。
- **时间/软删**：所有表统一 `create_time`/`update_time`；业务表含 `deleted`（0/1 逻辑删除）。

## 迁移进度

- [x] DDL 定稿（26 表：雪花ID + public_id + 统一时间戳 + 复合索引，阿里保守精修）
- [x] 项目骨架 / 基础模型（`internal/model/base.go`）/ 雪花ID
- [ ] 基础设施层（统一响应 / 错误码 / JWT / 中间件）
- [ ] GORM 全量模型（26 表）
- [ ] 业务模块迁移：auth/user → canvas/ai/file/points/community/blog/recharge/team/admin

源后端 `../tide-canvas-server`（Spring Boot）在迁移期作为权威参照保留。

## 备注

- 本机暂无 Go 工具链，骨架代码未本地 `go build`；安装 Go 后 `go mod tidy && go build ./...` 即可。
