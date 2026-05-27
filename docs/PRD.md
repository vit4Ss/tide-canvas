# TideCanvas Web - 产品需求文档 (PRD)

> 版本: v1.0.0  
> 日期: 2026-05-27  
> 项目代号: TideCanvas Web  
> 基于: D:\Tidecanvas (Electron 桌面版) 升级迁移

---

## 一、项目概述

### 1.1 项目背景

TideCanvas 是一款基于无限画布的多模态 AI 创作工作流编排平台。现有版本为 Electron 桌面应用（React + Vite + Electron），支持 13+ AI 供应商、50+ 模型的文生图/图生图/文生视频/图生视频等能力。

本次升级目标：将桌面版迁移为 **Next.js Web 端**，新增用户体系、文件管理、后台管理等功能，使平台可通过浏览器访问，支持多用户使用。

### 1.2 技术栈

| 层级 | 技术选型 |
|------|----------|
| **前端** | Next.js 15 (App Router) + TypeScript + Tailwind CSS 4 + shadcn/ui |
| **后端** | Spring Boot 3.x + MyBatis-Plus + MySQL 8 |
| **缓存** | Redis |
| **存储** | 本地存储 + OSS（预留阿里云/腾讯云/MinIO） |
| **认证** | JWT + Spring Security |
| **API 文档** | Swagger / Knife4j |
| **部署** | Docker + Nginx |

### 1.3 核心目标

1. 将无限画布核心能力迁移至 Web 端
2. 建立完整的用户认证与权限体系
3. 统一 AI 接口调用（用户通过平台接口创作，无需自备 API Key）
4. 提供文件上传/管理能力，预留 OSS 对接
5. 构建后台管理系统 + 数据可视化面板

---

## 二、系统架构

```
┌─────────────────────────────────────────────────────┐
│                   Nginx (反向代理)                     │
├──────────────────────┬──────────────────────────────┤
│   Next.js 前端        │      Spring Boot 后端         │
│   (端口 3000)         │      (端口 8080)              │
│                      │                              │
│  ┌─────────────┐     │   ┌──────────────────┐       │
│  │ 首页/展示    │     │   │ 用户认证模块      │       │
│  │ 画布编辑器   │     │   │ AI 接口代理模块    │       │
│  │ 用户中心     │     │   │ 文件管理模块      │       │
│  │ 后台管理     │     │   │ 项目管理模块      │       │
│  └─────────────┘     │   │ 系统管理模块      │       │
│                      │   │ 数据统计模块      │       │
│                      │   └──────────────────┘       │
│                      │           │                   │
│                      │   ┌───────┴───────┐          │
│                      │   │  MySQL 8      │          │
│                      │   │  Redis        │          │
│                      │   │  OSS (预留)    │          │
│                      │   └───────────────┘          │
└──────────────────────┴──────────────────────────────┘
```

---

## 三、功能模块

### 3.1 前端模块

#### 3.1.1 首页展示 (`/`)

参考 Image #1 (LibTV 风格) + Image #2 (无限画布 Landing Page)

**页面结构：**

```
┌─────────────────────────────────────────────────┐
│  Logo   导航栏(画布/创作/素材/社区)    登录/头像  │
├─────────────────────────────────────────────────┤
│              Banner 轮播区域                      │
│   (平台活动/新功能推荐/精选作品, 3-5 张轮播)       │
├─────────────────────────────────────────────────┤
│  Hero 区域: "无限画布"                            │
│  副标题: 在无限画布中生成、连接和重组               │
│  图片、文字与图形，让创作从单次生成变成连续推演       │
│  [开始创作 →]  [打开画布]                         │
├─────────────────────────────────────────────────┤
│  最近项目 (需登录)                     全部项目 >  │
│  [+ 开始创作]  [项目卡片] [项目卡片] [项目卡片]     │
├─────────────────────────────────────────────────┤
│  精选作品展示                          查看更多 >  │
│  [作品卡片 + 标签 + 描述] 瀑布流/网格布局          │
├─────────────────────────────────────────────────┤
│  功能介绍区域                                     │
│  文生图 / 图生图 / 视频生成 / 3D场景 / 分镜 等     │
├─────────────────────────────────────────────────┤
│  Footer: 关于/文档/社区/联系                       │
└─────────────────────────────────────────────────┘
```

**功能要求：**
- Banner 轮播: 后台可配置，支持图片+链接+标题
- 最近项目: 登录用户展示最近编辑的画布项目 (卡片含缩略图+名称+日期)
- 精选作品: 瀑布流展示社区/平台精选作品，支持标签筛选
- 功能介绍: 展示平台核心 AI 能力，每个功能配示例图
- 响应式设计: 适配桌面端和平板端

#### 3.1.2 用户认证 (`/login`, `/register`)

**登录页面：**
- 账号密码登录 (手机号/邮箱 + 密码)
- 验证码登录 (手机号 + 短信验证码, 预留)
- 第三方登录 (微信/GitHub/Google, 预留)
- 记住我 + 忘记密码

**注册页面：**
- 手机号/邮箱注册
- 密码强度校验
- 同意服务协议

**用户信息：**
- JWT Token 存储 (httpOnly cookie + localStorage)
- 自动刷新 Token
- 登录状态持久化

#### 3.1.3 无限画布编辑器 (`/canvas/[id]`)

**迁移自桌面版核心功能：**

| 功能 | 说明 | 优先级 |
|------|------|--------|
| 画布视口 | 无限画布平移/缩放/网格 | P0 |
| 节点系统 | 11 种节点类型 (文生图/图生图/文生视频/图生视频/首尾帧视频/创意描述/分镜/原图/原视频/全景/3D场景) | P0 |
| 连线系统 | 节点间有向连接，数据流传递 | P0 |
| AI 生成 | 通过后端代理调用 AI 接口生成图片/视频 | P0 |
| 历史记录 | Undo/Redo 操作栈 | P0 |
| 工作区管理 | 多工作区切换/创建/删除/重命名 | P0 |
| 右键菜单 | 节点操作 + 快速添加 | P1 |
| 键盘快捷键 | Ctrl+Z/C/V/Delete 等 | P1 |
| 提示词编辑 | 支持 @-mention 引用上游节点 | P1 |
| 媒体预览 | 图片/视频全屏预览 | P1 |
| 小地图 | 画布缩略图导航 | P2 |
| 视频合成 | 时间线编辑器 + 片段合成 | P2 |
| 蒙版编辑 | Inpainting 蒙版绘制 | P2 |
| 3D 场景 | 人体模型 + 角度控制 | P2 |
| 全景图 | 360度全景预览 + 书签 | P2 |
| 九宫格生成 | 图片变体批量生成 | P2 |
| 分镜系统 | 多镜头故事板编排 | P2 |

**Web 端新增功能：**
- 自动保存至云端 (替代 IndexedDB)
- 实时协作预留 (WebSocket)
- 画布分享 (生成分享链接)
- 导出功能 (JSON 工作流文件 + 图片/视频下载)

#### 3.1.4 用户中心 (`/user`)

- 个人信息编辑 (头像/昵称/简介)
- 我的项目列表 (画布项目管理)
- 我的素材库 (上传的图片/视频/资源)
- 使用统计 (AI 调用次数/存储使用量)
- 账户设置 (密码修改/绑定手机/通知偏好)

#### 3.1.5 素材管理 (`/assets`)

- 素材上传 (拖拽上传/点击上传)
- 素材分类 (图片/视频/模型/其他)
- 素材标签管理
- 素材搜索/筛选
- 素材引用追踪 (哪些画布使用了该素材)

#### 3.1.6 后台管理 (`/admin`)

**仅管理员可访问，独立布局 (侧边栏导航)：**

| 模块 | 功能 |
|------|------|
| **数据面板** | 用户统计/创作统计/API 调用统计/存储使用/活跃趋势图表 |
| **用户管理** | 用户列表/搜索/禁用/角色分配/使用额度管理 |
| **内容管理** | 作品审核/精选推荐/Banner 配置/公告管理 |
| **AI 模型管理** | 模型配置/供应商管理/API Key 管理/模型启停 |
| **系统配置** | 站点设置/注册开关/默认额度/存储配置 |
| **文件管理** | OSS 存储监控/文件清理/存储策略 |
| **操作日志** | 用户行为日志/API 调用日志/异常告警 |

**数据可视化面板：**
```
┌─────────────────────────────────────────────────┐
│  今日数据概览                                     │
│  [用户总数] [今日新增] [活跃用户] [API调用次数]      │
├──────────────────────┬──────────────────────────┤
│  用户增长趋势 (折线图) │  AI 调用分布 (饼图)       │
├──────────────────────┼──────────────────────────┤
│  每日创作量 (柱状图)   │  模型使用排行 (条形图)    │
├──────────────────────┴──────────────────────────┤
│  最近操作日志 (表格)                              │
└─────────────────────────────────────────────────┘
```

---

### 3.2 后端模块 (Spring Boot) — 阿里巴巴 Java 开发规约

#### 3.2.0 整体规范

**分层架构 (严格遵循阿里规约)：**

```
Controller (接收请求，参数校验)
    ↓ 接收 DTO，返回 Result<VO>
Service (业务逻辑接口)
    ↓
ServiceImpl (业务逻辑实现)
    ↓ 操作 DO
Mapper / DAO (数据访问)
    ↓
MySQL
```

**对象分层约定：**

| 对象 | 命名规范 | 用途 | 所在包 |
|------|----------|------|--------|
| DO (Data Object) | `XxxDO` | 与数据库表一一对应，MyBatis-Plus 实体 | `model.entity` |
| DTO (Data Transfer Object) | `XxxDTO` | 接收前端请求参数 (新增/修改) | `model.dto` |
| Query | `XxxQuery` | 分页查询/条件查询入参 | `model.query` |
| VO (View Object) | `XxxVO` | 返回给前端的视图对象，脱敏后的数据 | `model.vo` |
| BO (Business Object) | `XxxBO` | Service 层之间传递的业务对象 | `model.bo` |
| Convert | `XxxConvert` | DO/DTO/VO 之间转换 (MapStruct) | `convert` |

**统一响应体 `Result<T>`：**
```json
{
  "success": true,
  "code": 200,
  "message": "操作成功",
  "data": { },
  "timestamp": 1716796800000
}
```

**统一分页响应体 `PageResult<T>`：**
```json
{
  "success": true,
  "code": 200,
  "message": "操作成功",
  "data": {
    "records": [ ],
    "total": 100,
    "pageNum": 1,
    "pageSize": 20,
    "pages": 5
  },
  "timestamp": 1716796800000
}
```

**错误码枚举 (ResultCode)：**

| code | 含义 |
|------|------|
| 200 | 成功 |
| 400 | 请求参数错误 |
| 401 | 未登录/Token 过期 |
| 403 | 无权限 |
| 404 | 资源不存在 |
| 429 | 请求频率超限 |
| 500 | 系统内部错误 |
| 1001 | 用户名已存在 |
| 1002 | 邮箱已注册 |
| 1003 | 密码不正确 |
| 2001 | AI 额度不足 |
| 2002 | 模型不可用 |
| 2003 | Handler 不存在 |
| 3001 | 文件类型不允许 |
| 3002 | 文件大小超限 |
| 3003 | 存储空间不足 |

**命名规范 (阿里规约)：**
- 类名：UpperCamelCase (`UserServiceImpl`)
- 方法名：lowerCamelCase (`getUserById`)
- 常量：UPPER_SNAKE_CASE (`MAX_PAGE_SIZE`)
- 数据库表字段：lower_snake_case (`create_time`)
- 所有表必须有 `id`, `create_time`, `update_time`
- 布尔字段数据库不用 `is_` 前缀，Java 使用 `isXxx`
- Service / DAO 层方法命名：`get` 单个查询, `list` 列表查询, `count` 统计, `save` 新增, `update` 修改, `remove` 删除

---

#### 3.2.1 用户认证模块

**RESTful 接口：**

| 方法 | 路径 | 说明 | 入参 | 出参 |
|------|------|------|------|------|
| POST | `/api/auth/register` | 用户注册 | `UserRegisterDTO` | `Result<UserVO>` |
| POST | `/api/auth/login` | 用户登录 | `UserLoginDTO` | `Result<LoginVO>` |
| POST | `/api/auth/logout` | 退出登录 | — | `Result<Void>` |
| POST | `/api/auth/refresh` | 刷新 Token | `RefreshTokenDTO` | `Result<LoginVO>` |
| GET | `/api/auth/me` | 当前用户信息 | — | `Result<UserVO>` |
| PUT | `/api/auth/password` | 修改密码 | `UpdatePasswordDTO` | `Result<Void>` |

**DTO 定义：**

```java
/** 用户注册请求 */
public class UserRegisterDTO {
    @NotBlank private String username;
    @NotBlank @Email private String email;
    @NotBlank @Size(min = 6, max = 32) private String password;
    private String nickname;
    private String phone;
}

/** 用户登录请求 */
public class UserLoginDTO {
    @NotBlank private String account;    // 用户名/邮箱/手机号
    @NotBlank private String password;
    private Boolean rememberMe;
}

/** 刷新 Token 请求 */
public class RefreshTokenDTO {
    @NotBlank private String refreshToken;
}

/** 修改密码请求 */
public class UpdatePasswordDTO {
    @NotBlank private String oldPassword;
    @NotBlank @Size(min = 6, max = 32) private String newPassword;
}
```

**VO 定义：**

```java
/** 用户视图对象 (脱敏，不含密码) */
public class UserVO {
    private Long id;
    private String username;
    private String email;
    private String phone;
    private String nickname;
    private String avatar;
    private Integer role;
    private Integer status;
    private Integer apiQuota;
    private Long storageQuota;
    private LocalDateTime createTime;
    private LocalDateTime lastLoginTime;
}

/** 登录响应 */
public class LoginVO {
    private String accessToken;
    private String refreshToken;
    private Long expiresIn;
    private UserVO userInfo;
}
```

**DO (数据表: `sys_user`)：**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | bigint | 主键 (雪花算法) |
| username | varchar(64) | 用户名 (唯一) |
| email | varchar(128) | 邮箱 (唯一) |
| phone | varchar(20) | 手机号 |
| password | varchar(255) | 加密密码 (BCrypt) |
| nickname | varchar(64) | 昵称 |
| avatar | varchar(512) | 头像 URL |
| role | tinyint | 角色 (0:普通用户, 1:VIP, 9:管理员) |
| status | tinyint | 状态 (0:禁用, 1:正常) |
| api_quota | int | AI API 调用额度 |
| storage_quota | bigint | 存储额度 (bytes) |
| last_login_time | datetime | 最后登录时间 |
| create_time | datetime | 创建时间 |
| update_time | datetime | 更新时间 |
| deleted | tinyint | 逻辑删除 (0:未删除, 1:已删除) |

---

#### 3.2.2 项目管理模块

**RESTful 接口：**

| 方法 | 路径 | 说明 | 入参 | 出参 |
|------|------|------|------|------|
| GET | `/api/projects` | 项目列表 (分页) | `ProjectQuery` | `PageResult<ProjectVO>` |
| POST | `/api/projects` | 创建项目 | `ProjectCreateDTO` | `Result<ProjectVO>` |
| GET | `/api/projects/{id}` | 项目详情 | — | `Result<ProjectDetailVO>` |
| PUT | `/api/projects/{id}` | 更新项目信息 | `ProjectUpdateDTO` | `Result<ProjectVO>` |
| DELETE | `/api/projects/{id}` | 删除项目 | — | `Result<Void>` |
| PUT | `/api/projects/{id}/canvas` | 保存画布数据 | `CanvasSaveDTO` | `Result<Void>` |
| GET | `/api/projects/{id}/canvas` | 获取画布数据 | — | `Result<CanvasDataVO>` |
| POST | `/api/projects/{id}/share` | 生成分享链接 | — | `Result<ShareVO>` |

**DTO / Query / VO：**

```java
/** 项目查询参数 */
public class ProjectQuery extends PageQuery {
    private String keyword;              // 搜索关键词
    private Integer status;              // 状态筛选
}

/** 分页查询基类 */
public class PageQuery {
    @Min(1) private Integer pageNum = 1;
    @Min(1) @Max(100) private Integer pageSize = 20;
    private String orderBy;
    private String orderDirection;       // asc / desc
}

/** 创建项目请求 */
public class ProjectCreateDTO {
    @NotBlank @Size(max = 128) private String name;
    private String description;
}

/** 更新项目请求 */
public class ProjectUpdateDTO {
    @Size(max = 128) private String name;
    private String description;
    private Integer status;
    private Boolean isPublic;
}

/** 保存画布数据请求 */
public class CanvasSaveDTO {
    @NotBlank private String canvasData; // JSON 字符串
    private String thumbnail;            // Base64 缩略图
}

/** 项目列表 VO */
public class ProjectVO {
    private Long id;
    private String name;
    private String description;
    private String thumbnail;
    private Integer status;
    private Boolean isPublic;
    private LocalDateTime createTime;
    private LocalDateTime updateTime;
}

/** 项目详情 VO (含画布数据) */
public class ProjectDetailVO extends ProjectVO {
    private String canvasData;
    private String shareToken;
    private UserSimpleVO owner;
}

/** 分享 VO */
public class ShareVO {
    private String shareToken;
    private String shareUrl;
}
```

**DO (数据表: `canvas_project`)：**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | bigint | 主键 |
| user_id | bigint | 所属用户 |
| name | varchar(128) | 项目名称 |
| description | text | 项目描述 |
| thumbnail | varchar(512) | 缩略图 URL |
| canvas_data | longtext | 画布 JSON 数据 |
| is_public | tinyint | 是否公开 (0:否, 1:是) |
| share_token | varchar(64) | 分享 Token |
| status | tinyint | 状态 (0:草稿, 1:已发布) |
| create_time | datetime | 创建时间 |
| update_time | datetime | 更新时间 |
| deleted | tinyint | 逻辑删除 |

---

#### 3.2.3 AI 接口模块 — 统一接口 + Handler

**RESTful 接口：**

| 方法 | 路径 | 说明 | 入参 | 出参 |
|------|------|------|------|------|
| POST | `/api/ai/generate` | 统一生成入口 | `AiGenerateDTO` | `Result<AiTaskVO>` |
| GET | `/api/ai/tasks/{taskId}` | 查询任务状态 | — | `Result<AiTaskVO>` |
| DELETE | `/api/ai/tasks/{taskId}` | 取消任务 | — | `Result<Void>` |
| GET | `/api/ai/tasks` | 我的任务列表 | `AiTaskQuery` | `PageResult<AiTaskVO>` |
| GET | `/api/ai/models` | 可用模型列表 | — | `Result<List<AiModelVO>>` |
| GET | `/api/ai/handlers` | 可用 Handler 列表 | — | `Result<List<AiHandlerVO>>` |

**DTO / VO：**

```java
/** 统一生成请求 */
public class AiGenerateDTO {
    @NotBlank private String handler;    // handler 标识
    @NotBlank private String modelId;    // 模型 ID
    private Long projectId;              // 关联项目 (可选)
    @NotNull private Map<String, Object> input;  // handler 特定输入
}

/** 任务查询参数 */
public class AiTaskQuery extends PageQuery {
    private String handler;
    private Integer status;
    private Long projectId;
}

/** AI 任务 VO */
public class AiTaskVO {
    private Long id;
    private String handler;
    private String modelName;
    private Integer status;              // 0:处理中, 1:成功, 2:失败, 3:已取消
    private Integer progress;
    private String resultUrl;
    private Map<String, Object> resultMeta;
    private String errorMsg;
    private LocalDateTime createTime;
    private LocalDateTime completeTime;
}

/** AI 模型 VO */
public class AiModelVO {
    private Long id;
    private String name;
    private String modelId;
    private String type;                 // image / video / text
    private List<String> supportedHandlers;
    private Map<String, Object> config;
}

/** AI Handler VO */
public class AiHandlerVO {
    private String name;
    private String displayName;
    private String description;
    private Map<String, Object> inputSchema;
    private Boolean isAsync;
    private Long defaultModelId;
}
```

**Handler 架构：**

```
AiController.generate(AiGenerateDTO)
    │
    ├─ @PreAuthorize 权限校验
    ├─ AiGenerateDTO → 参数校验 (JSR 303)
    │
    ▼
AiService.generate(AiGenerateDTO, currentUserId)
    │
    ├─ 校验用户额度
    ├─ AiHandlerRegistry.getHandler(dto.handler)
    ├─ handler.validate(dto.input)      // Handler 自行校验 input
    ├─ AiProviderRouter.route(modelId)  // 路由到供应商
    │
    ├─ 同步 Handler → 直接返回 Result<AiTaskVO>
    └─ 异步 Handler → 创建 AiTaskDO → 提交线程池 → 返回 taskId
            │
            ▼
       AiHandler 接口 (每种生成类型一个实现):
         String getHandlerName()
         void validate(Map<String, Object> input)
         AiTaskResultBO execute(AiGenerateBO bo)
         boolean isAsync()
            │
            ▼
       AiProviderClient 接口 (每种供应商一个实现):
         String getProviderType()
         AiProviderResponseBO callApi(AiProviderRequestBO request)
```

**DO (数据表)：**

`ai_provider`
| 字段 | 类型 | 说明 |
|------|------|------|
| id | bigint | 主键 |
| name | varchar(64) | 供应商名称 |
| provider_type | varchar(32) | 类型 (openai/gemini/doubao/...) |
| api_key | varchar(512) | 加密的 API Key (AES) |
| backup_keys | text | 备用 Key (JSON 数组) |
| base_url | varchar(255) | API 地址 |
| status | tinyint | 状态 (0:禁用, 1:启用) |
| priority | int | 优先级 |
| rate_limit | int | 每分钟请求上限 |
| config | json | 供应商特定配置 |
| create_time | datetime | 创建时间 |
| update_time | datetime | 更新时间 |

`ai_model`
| 字段 | 类型 | 说明 |
|------|------|------|
| id | bigint | 主键 |
| provider_id | bigint | 供应商 ID (外键) |
| name | varchar(64) | 显示名称 |
| model_id | varchar(128) | 模型标识 |
| type | varchar(16) | 类型 (image/video/text) |
| supported_handlers | json | 支持的 handler 列表 |
| config | json | 模型参数配置 |
| cost_per_call | decimal(10,4) | 单次调用成本 |
| status | tinyint | 状态 |
| create_time | datetime | 创建时间 |
| update_time | datetime | 更新时间 |

`ai_handler_config`
| 字段 | 类型 | 说明 |
|------|------|------|
| id | bigint | 主键 |
| handler_name | varchar(64) | handler 标识 (唯一) |
| display_name | varchar(64) | 显示名称 |
| description | varchar(255) | 描述 |
| input_schema | json | 输入参数 JSON Schema |
| default_model_id | bigint | 默认模型 ID |
| async_flag | tinyint | 是否异步 (0:否, 1:是) |
| status | tinyint | 状态 (0:禁用, 1:启用) |
| sort_order | int | 排序 |
| create_time | datetime | 创建时间 |
| update_time | datetime | 更新时间 |

`ai_task`
| 字段 | 类型 | 说明 |
|------|------|------|
| id | bigint | 主键 |
| user_id | bigint | 用户 ID |
| project_id | bigint | 项目 ID |
| handler_name | varchar(64) | 使用的 handler |
| model_id | bigint | 使用的模型 |
| input_params | json | 请求输入快照 |
| result_url | varchar(512) | 结果文件 URL |
| result_meta | json | 结果元数据 |
| status | tinyint | 状态 (0:处理中, 1:成功, 2:失败, 3:已取消) |
| progress | tinyint | 进度 (0-100) |
| error_msg | text | 错误信息 |
| cost | decimal(10,4) | 调用成本 |
| create_time | datetime | 创建时间 |
| complete_time | datetime | 完成时间 |
| update_time | datetime | 更新时间 |

**Handler 注册表：**

| handler_name | 说明 | 同步/异步 |
|--------------|------|----------|
| `text_to_image` | 文生图 | 异步 |
| `image_to_image` | 图生图 | 异步 |
| `text_to_video` | 文生视频 | 异步 |
| `image_to_video` | 图生视频 | 异步 |
| `start_end_to_video` | 首尾帧视频 | 异步 |
| `creative_desc` | 创意描述增强 | 同步 (SSE) |
| `storyboard` | 分镜生成 | 同步 (SSE) |
| `panorama_360` | 全景图生成 | 异步 |
| `nine_grid` | 九宫格变体 | 异步 |
| `split_grid_hd` | 分割高清 | 异步 |
| `upscale` | 图片放大 | 异步 |

---

#### 3.2.4 文件管理模块

**RESTful 接口：**

| 方法 | 路径 | 说明 | 入参 | 出参 |
|------|------|------|------|------|
| POST | `/api/files/upload` | 单文件上传 | `MultipartFile` | `Result<FileVO>` |
| POST | `/api/files/upload/batch` | 批量上传 | `MultipartFile[]` | `Result<List<FileVO>>` |
| GET | `/api/files` | 文件列表 | `FileQuery` | `PageResult<FileVO>` |
| GET | `/api/files/{id}` | 文件详情 | — | `Result<FileVO>` |
| DELETE | `/api/files/{id}` | 删除文件 | — | `Result<Void>` |
| GET | `/api/files/{id}/download` | 下载文件 | — | 文件流 |

**VO：**

```java
/** 文件 VO */
public class FileVO {
    private Long id;
    private String originalName;
    private String fileUrl;
    private Long fileSize;
    private String fileType;             // image / video / other
    private String mimeType;
    private String storageType;          // local / oss
    private LocalDateTime createTime;
}

/** 文件查询参数 */
public class FileQuery extends PageQuery {
    private String fileType;
    private String keyword;
}
```

**DO (数据表: `sys_file`)：**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | bigint | 主键 |
| user_id | bigint | 上传者 |
| original_name | varchar(255) | 原始文件名 |
| stored_name | varchar(255) | 存储文件名 (UUID) |
| file_path | varchar(512) | 存储路径 |
| file_url | varchar(512) | 访问 URL |
| file_size | bigint | 文件大小 (bytes) |
| file_type | varchar(16) | 文件类型 |
| mime_type | varchar(128) | MIME 类型 |
| hash | varchar(64) | SHA-256 哈希 (去重) |
| storage_type | varchar(16) | 存储方式 (local/oss) |
| create_time | datetime | 创建时间 |
| update_time | datetime | 更新时间 |
| deleted | tinyint | 逻辑删除 |

**OSS 策略接口：**
```java
public interface StorageStrategy {
    FileUploadResultBO upload(MultipartFile file, String directory);
    void delete(String filePath);
    String getAccessUrl(String filePath);
}
// 实现: LocalStorageStrategy, AliyunOssStrategy, MinioStrategy
// 通过 @ConditionalOnProperty 按配置激活
```

---

#### 3.2.5 系统管理模块 (Admin)

**RESTful 接口：**

| 方法 | 路径 | 说明 | 入参 | 出参 |
|------|------|------|------|------|
| **Dashboard** |
| GET | `/api/admin/dashboard/overview` | 数据概览 | — | `Result<DashboardOverviewVO>` |
| GET | `/api/admin/dashboard/trend` | 趋势数据 | `TrendQuery` | `Result<DashboardTrendVO>` |
| **用户管理** |
| GET | `/api/admin/users` | 用户列表 | `AdminUserQuery` | `PageResult<AdminUserVO>` |
| GET | `/api/admin/users/{id}` | 用户详情 | — | `Result<AdminUserVO>` |
| PUT | `/api/admin/users/{id}` | 编辑用户 | `AdminUserUpdateDTO` | `Result<Void>` |
| **内容管理** |
| GET | `/api/admin/contents` | 内容列表 | `ContentQuery` | `PageResult<ContentVO>` |
| PUT | `/api/admin/contents/{id}` | 审核内容 | `ContentAuditDTO` | `Result<Void>` |
| **Banner 管理** |
| GET | `/api/admin/banners` | Banner 列表 | — | `Result<List<BannerVO>>` |
| POST | `/api/admin/banners` | 新增 Banner | `BannerCreateDTO` | `Result<BannerVO>` |
| PUT | `/api/admin/banners/{id}` | 更新 Banner | `BannerUpdateDTO` | `Result<Void>` |
| DELETE | `/api/admin/banners/{id}` | 删除 Banner | — | `Result<Void>` |
| **AI 管理** |
| GET | `/api/admin/ai/providers` | 供应商列表 | — | `Result<List<AiProviderVO>>` |
| POST | `/api/admin/ai/providers` | 新增供应商 | `AiProviderCreateDTO` | `Result<AiProviderVO>` |
| PUT | `/api/admin/ai/providers/{id}` | 更新供应商 | `AiProviderUpdateDTO` | `Result<Void>` |
| DELETE | `/api/admin/ai/providers/{id}` | 删除供应商 | — | `Result<Void>` |
| GET | `/api/admin/ai/models` | 模型列表 | — | `Result<List<AiModelVO>>` |
| POST | `/api/admin/ai/models` | 新增模型 | `AiModelCreateDTO` | `Result<AiModelVO>` |
| PUT | `/api/admin/ai/models/{id}` | 更新模型 | `AiModelUpdateDTO` | `Result<Void>` |
| DELETE | `/api/admin/ai/models/{id}` | 删除模型 | — | `Result<Void>` |
| GET | `/api/admin/ai/handlers` | Handler 列表 | — | `Result<List<AiHandlerVO>>` |
| PUT | `/api/admin/ai/handlers/{name}` | 更新 Handler 配置 | `AiHandlerUpdateDTO` | `Result<Void>` |
| **系统配置** |
| GET | `/api/admin/settings` | 获取配置 | — | `Result<Map<String, Object>>` |
| PUT | `/api/admin/settings` | 更新配置 | `Map<String, Object>` | `Result<Void>` |
| **操作日志** |
| GET | `/api/admin/logs` | 日志列表 | `LogQuery` | `PageResult<LogVO>` |

**主要 Admin VO：**

```java
/** Dashboard 概览 */
public class DashboardOverviewVO {
    private Long totalUsers;
    private Long todayNewUsers;
    private Long activeUsers;
    private Long totalApiCalls;
    private Long todayApiCalls;
    private Long totalProjects;
    private Long totalStorageBytes;
}

/** Dashboard 趋势 */
public class DashboardTrendVO {
    private List<TrendItemVO> userTrend;
    private List<TrendItemVO> apiCallTrend;
    private List<TrendItemVO> projectTrend;
    private List<ModelUsageVO> modelUsageRank;
}

/** Admin 用户 VO (含管理信息) */
public class AdminUserVO extends UserVO {
    private Long usedApiQuota;
    private Long usedStorageBytes;
    private Integer projectCount;
}

/** Admin 用户编辑 */
public class AdminUserUpdateDTO {
    private Integer role;
    private Integer status;
    private Integer apiQuota;
    private Long storageQuota;
}

/** 操作日志 VO */
public class LogVO {
    private Long id;
    private Long userId;
    private String username;
    private String action;
    private String target;
    private String detail;
    private String ip;
    private LocalDateTime createTime;
}
```

**DO (数据表)：**

`sys_banner`
| 字段 | 类型 | 说明 |
|------|------|------|
| id | bigint | 主键 |
| title | varchar(128) | 标题 |
| image_url | varchar(512) | 图片 URL |
| link_url | varchar(512) | 跳转链接 |
| sort_order | int | 排序 |
| status | tinyint | 状态 (0:隐藏, 1:显示) |
| create_time | datetime | 创建时间 |
| update_time | datetime | 更新时间 |

`sys_config`
| 字段 | 类型 | 说明 |
|------|------|------|
| id | bigint | 主键 |
| config_key | varchar(128) | 配置键 (唯一) |
| config_value | text | 配置值 |
| description | varchar(255) | 描述 |
| create_time | datetime | 创建时间 |
| update_time | datetime | 更新时间 |

`sys_log`
| 字段 | 类型 | 说明 |
|------|------|------|
| id | bigint | 主键 |
| user_id | bigint | 操作者 |
| username | varchar(64) | 操作者用户名 (冗余) |
| action | varchar(64) | 操作类型 |
| target | varchar(128) | 操作目标 |
| detail | text | 详情 |
| ip | varchar(64) | IP 地址 |
| create_time | datetime | 操作时间 |

---

## 四、页面路由规划

### 4.1 前台页面

| 路由 | 页面 | 认证 |
|------|------|------|
| `/` | 首页 (Landing + 展示) | 否 |
| `/login` | 登录 | 否 |
| `/register` | 注册 | 否 |
| `/canvas/[id]` | 画布编辑器 | 是 |
| `/canvas/new` | 新建画布 | 是 |
| `/user` | 用户中心 | 是 |
| `/user/projects` | 我的项目 | 是 |
| `/user/assets` | 我的素材 | 是 |
| `/user/settings` | 账户设置 | 是 |
| `/explore` | 发现/社区作品 | 否 |
| `/explore/[id]` | 作品详情 | 否 |
| `/share/[token]` | 分享画布 (只读) | 否 |

### 4.2 后台页面

| 路由 | 页面 | 权限 |
|------|------|------|
| `/admin` | 数据面板 (Dashboard) | 管理员 |
| `/admin/users` | 用户管理 | 管理员 |
| `/admin/contents` | 内容管理 | 管理员 |
| `/admin/ai/providers` | AI 供应商管理 | 管理员 |
| `/admin/ai/models` | 模型管理 | 管理员 |
| `/admin/banners` | Banner 管理 | 管理员 |
| `/admin/files` | 文件管理 | 管理员 |
| `/admin/logs` | 操作日志 | 管理员 |
| `/admin/settings` | 系统设置 | 管理员 |

---

## 五、前端目录结构

```
tide-canvas/
├── src/
│   ├── app/                          # Next.js App Router
│   │   ├── (public)/                 # 公开页面组
│   │   │   ├── page.tsx              # 首页
│   │   │   ├── login/page.tsx
│   │   │   ├── register/page.tsx
│   │   │   ├── explore/page.tsx
│   │   │   └── share/[token]/page.tsx
│   │   ├── (auth)/                   # 需登录页面组
│   │   │   ├── canvas/
│   │   │   │   ├── [id]/page.tsx     # 画布编辑器
│   │   │   │   └── new/page.tsx
│   │   │   └── user/
│   │   │       ├── page.tsx
│   │   │       ├── projects/page.tsx
│   │   │       ├── assets/page.tsx
│   │   │       └── settings/page.tsx
│   │   ├── admin/                    # 后台管理
│   │   │   ├── layout.tsx            # 管理后台布局 (侧边栏)
│   │   │   ├── page.tsx              # Dashboard
│   │   │   ├── users/page.tsx
│   │   │   ├── contents/page.tsx
│   │   │   ├── ai/
│   │   │   │   ├── providers/page.tsx
│   │   │   │   └── models/page.tsx
│   │   │   ├── banners/page.tsx
│   │   │   ├── files/page.tsx
│   │   │   ├── logs/page.tsx
│   │   │   └── settings/page.tsx
│   │   ├── api/                      # Next.js API Routes (BFF 层, 可选)
│   │   ├── layout.tsx                # 全局布局
│   │   └── globals.css
│   ├── components/
│   │   ├── ui/                       # shadcn/ui 基础组件
│   │   ├── layout/                   # 布局组件
│   │   │   ├── Header.tsx
│   │   │   ├── Footer.tsx
│   │   │   ├── Sidebar.tsx
│   │   │   └── AdminLayout.tsx
│   │   ├── home/                     # 首页组件
│   │   │   ├── Banner.tsx
│   │   │   ├── HeroSection.tsx
│   │   │   ├── RecentProjects.tsx
│   │   │   ├── FeaturedWorks.tsx
│   │   │   └── FeatureShowcase.tsx
│   │   ├── canvas/                   # 画布核心组件 (迁移自桌面版)
│   │   │   ├── CanvasView.tsx
│   │   │   ├── NodesLayer.tsx
│   │   │   ├── ConnectionsLayer.tsx
│   │   │   ├── ContextMenu.tsx
│   │   │   ├── MiniMap.tsx
│   │   │   ├── Toolbar.tsx
│   │   │   └── nodes/               # 各类节点组件
│   │   │       ├── BaseNode.tsx
│   │   │       ├── TextToImageNode.tsx
│   │   │       ├── ImageToImageNode.tsx
│   │   │       └── ...
│   │   ├── auth/                     # 认证组件
│   │   │   ├── LoginForm.tsx
│   │   │   └── RegisterForm.tsx
│   │   ├── admin/                    # 后台组件
│   │   │   ├── DashboardCards.tsx
│   │   │   ├── Charts.tsx
│   │   │   └── DataTable.tsx
│   │   └── shared/                   # 通用组件
│   │       ├── FileUpload.tsx
│   │       ├── ImagePreview.tsx
│   │       └── LoadingSpinner.tsx
│   ├── hooks/                        # 自定义 Hooks (迁移自桌面版)
│   │   ├── useCanvasTransform.ts
│   │   ├── useCanvasMouse.ts
│   │   ├── useCanvasKeyboard.ts
│   │   ├── useHistory.ts
│   │   ├── useAuth.ts
│   │   └── useFileUpload.ts
│   ├── lib/                          # 工具库
│   │   ├── api.ts                    # API 请求封装 (axios/fetch)
│   │   ├── auth.ts                   # JWT 工具
│   │   ├── storage.ts                # 存储工具
│   │   └── utils.ts
│   ├── stores/                       # 状态管理 (Zustand)
│   │   ├── useAuthStore.ts
│   │   ├── useCanvasStore.ts
│   │   └── useAdminStore.ts
│   └── types/                        # TypeScript 类型定义
│       ├── canvas.ts
│       ├── user.ts
│       ├── ai.ts
│       └── api.ts
├── public/                           # 静态资源
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

---

## 六、后端目录结构 (阿里规约)

```
tide-canvas-server/
├── src/main/java/com/tidecanvas/
│   ├── TideCanvasApplication.java
│   │
│   ├── config/                              # 配置类
│   │   ├── SecurityConfig.java              # Spring Security + JWT
│   │   ├── CorsConfig.java                  # CORS 跨域
│   │   ├── MybatisPlusConfig.java           # MyBatis-Plus (分页插件等)
│   │   ├── RedisConfig.java                 # Redis 序列化
│   │   ├── ThreadPoolConfig.java            # 异步线程池
│   │   ├── StorageConfig.java               # 存储策略
│   │   └── SwaggerConfig.java               # Knife4j API 文档
│   │
│   ├── controller/                          # 控制层 (仅参数校验 + 调用 Service)
│   │   ├── AuthController.java
│   │   ├── ProjectController.java
│   │   ├── AiController.java               # 统一 AI 生成入口
│   │   ├── FileController.java
│   │   ├── UserController.java
│   │   └── admin/                           # 后台管理接口
│   │       ├── AdminDashboardController.java
│   │       ├── AdminUserController.java
│   │       ├── AdminContentController.java
│   │       ├── AdminAiController.java       # 供应商/模型/Handler 管理
│   │       ├── AdminBannerController.java
│   │       ├── AdminFileController.java
│   │       ├── AdminLogController.java
│   │       └── AdminSettingController.java
│   │
│   ├── service/                             # 服务接口层
│   │   ├── AuthService.java
│   │   ├── UserService.java
│   │   ├── ProjectService.java
│   │   ├── AiService.java
│   │   ├── FileService.java
│   │   └── AdminService.java
│   │
│   ├── service/impl/                        # 服务实现层
│   │   ├── AuthServiceImpl.java
│   │   ├── UserServiceImpl.java
│   │   ├── ProjectServiceImpl.java
│   │   ├── AiServiceImpl.java
│   │   ├── FileServiceImpl.java
│   │   └── AdminServiceImpl.java
│   │
│   ├── service/storage/                     # 存储策略 (策略模式)
│   │   ├── StorageStrategy.java             # 策略接口
│   │   ├── LocalStorageStrategy.java
│   │   ├── AliyunOssStrategy.java           # 预留
│   │   └── MinioStrategy.java               # 预留
│   │
│   ├── service/ai/                          # AI Handler 体系
│   │   ├── AiHandler.java                   # Handler 接口
│   │   ├── AiHandlerRegistry.java           # 注册中心 (@Component 自动注册)
│   │   ├── AiProviderRouter.java            # 供应商路由
│   │   ├── handler/                         # Handler 实现
│   │   │   ├── TextToImageHandler.java
│   │   │   ├── ImageToImageHandler.java
│   │   │   ├── TextToVideoHandler.java
│   │   │   ├── ImageToVideoHandler.java
│   │   │   ├── CreativeDescHandler.java
│   │   │   ├── StoryboardHandler.java
│   │   │   └── ...
│   │   └── provider/                        # 供应商客户端
│   │       ├── AiProviderClient.java        # 客户端接口
│   │       ├── GeminiClient.java
│   │       ├── OpenAiClient.java
│   │       ├── DoubaoClient.java
│   │       └── GenericOpenAiClient.java
│   │
│   ├── mapper/                              # 数据访问层 (DAO)
│   │   ├── SysUserMapper.java
│   │   ├── CanvasProjectMapper.java
│   │   ├── AiProviderMapper.java
│   │   ├── AiModelMapper.java
│   │   ├── AiHandlerConfigMapper.java
│   │   ├── AiTaskMapper.java
│   │   ├── SysFileMapper.java
│   │   ├── SysBannerMapper.java
│   │   ├── SysConfigMapper.java
│   │   └── SysLogMapper.java
│   │
│   ├── model/                               # 领域模型 (阿里规约分层)
│   │   ├── entity/                          # DO: 数据库实体 (与表一一对应)
│   │   │   ├── SysUserDO.java
│   │   │   ├── CanvasProjectDO.java
│   │   │   ├── AiProviderDO.java
│   │   │   ├── AiModelDO.java
│   │   │   ├── AiHandlerConfigDO.java
│   │   │   ├── AiTaskDO.java
│   │   │   ├── SysFileDO.java
│   │   │   ├── SysBannerDO.java
│   │   │   ├── SysConfigDO.java
│   │   │   └── SysLogDO.java
│   │   ├── dto/                             # DTO: 前端请求入参
│   │   │   ├── UserRegisterDTO.java
│   │   │   ├── UserLoginDTO.java
│   │   │   ├── RefreshTokenDTO.java
│   │   │   ├── UpdatePasswordDTO.java
│   │   │   ├── ProjectCreateDTO.java
│   │   │   ├── ProjectUpdateDTO.java
│   │   │   ├── CanvasSaveDTO.java
│   │   │   ├── AiGenerateDTO.java
│   │   │   ├── AdminUserUpdateDTO.java
│   │   │   ├── BannerCreateDTO.java
│   │   │   ├── BannerUpdateDTO.java
│   │   │   ├── AiProviderCreateDTO.java
│   │   │   ├── AiProviderUpdateDTO.java
│   │   │   ├── AiModelCreateDTO.java
│   │   │   ├── AiModelUpdateDTO.java
│   │   │   ├── AiHandlerUpdateDTO.java
│   │   │   └── ContentAuditDTO.java
│   │   ├── query/                           # Query: 分页/条件查询入参
│   │   │   ├── PageQuery.java               # 分页基类
│   │   │   ├── ProjectQuery.java
│   │   │   ├── AiTaskQuery.java
│   │   │   ├── FileQuery.java
│   │   │   ├── AdminUserQuery.java
│   │   │   ├── ContentQuery.java
│   │   │   ├── LogQuery.java
│   │   │   └── TrendQuery.java
│   │   ├── vo/                              # VO: 返回给前端的视图对象
│   │   │   ├── UserVO.java
│   │   │   ├── UserSimpleVO.java
│   │   │   ├── LoginVO.java
│   │   │   ├── ProjectVO.java
│   │   │   ├── ProjectDetailVO.java
│   │   │   ├── CanvasDataVO.java
│   │   │   ├── ShareVO.java
│   │   │   ├── AiTaskVO.java
│   │   │   ├── AiModelVO.java
│   │   │   ├── AiHandlerVO.java
│   │   │   ├── AiProviderVO.java
│   │   │   ├── FileVO.java
│   │   │   ├── BannerVO.java
│   │   │   ├── AdminUserVO.java
│   │   │   ├── ContentVO.java
│   │   │   ├── LogVO.java
│   │   │   ├── DashboardOverviewVO.java
│   │   │   └── DashboardTrendVO.java
│   │   └── bo/                              # BO: Service 层内部传递
│   │       ├── AiGenerateBO.java
│   │       ├── AiTaskResultBO.java
│   │       ├── AiProviderRequestBO.java
│   │       ├── AiProviderResponseBO.java
│   │       └── FileUploadResultBO.java
│   │
│   ├── convert/                             # 对象转换 (MapStruct)
│   │   ├── UserConvert.java
│   │   ├── ProjectConvert.java
│   │   ├── AiConvert.java
│   │   ├── FileConvert.java
│   │   └── AdminConvert.java
│   │
│   ├── common/                              # 通用类
│   │   ├── Result.java                      # 统一响应封装
│   │   ├── PageResult.java                  # 分页响应封装
│   │   ├── ResultCode.java                  # 错误码枚举
│   │   └── BaseEntity.java                  # DO 基类 (id, createTime, updateTime)
│   │
│   ├── security/                            # 安全模块
│   │   ├── JwtTokenProvider.java            # Token 生成/解析
│   │   ├── JwtAuthenticationFilter.java     # Token 过滤器
│   │   ├── SecurityUserDetails.java         # UserDetails 实现
│   │   ├── SecurityUserDetailsService.java  # 加载用户
│   │   └── SecurityUtils.java              # 获取当前登录用户工具
│   │
│   ├── exception/                           # 异常处理
│   │   ├── BusinessException.java           # 业务异常 (携带 ResultCode)
│   │   └── GlobalExceptionHandler.java      # 全局异常拦截 (@RestControllerAdvice)
│   │
│   ├── annotation/                          # 自定义注解
│   │   ├── OperateLog.java                  # 操作日志切面注解
│   │   └── RateLimit.java                   # 频率限制注解
│   │
│   ├── aspect/                              # AOP 切面
│   │   ├── OperateLogAspect.java            # 日志记录切面
│   │   └── RateLimitAspect.java             # 频率限制切面
│   │
│   ├── enums/                               # 枚举类
│   │   ├── UserRoleEnum.java
│   │   ├── UserStatusEnum.java
│   │   ├── ProjectStatusEnum.java
│   │   ├── AiTaskStatusEnum.java
│   │   ├── FileTypeEnum.java
│   │   └── StorageTypeEnum.java
│   │
│   └── util/                                # 工具类
│       ├── FileUtil.java
│       ├── HashUtil.java
│       └── IpUtil.java
│
├── src/main/resources/
│   ├── application.yml                      # 公共配置
│   ├── application-dev.yml                  # 开发环境
│   ├── application-prod.yml                 # 生产环境
│   └── mapper/                              # MyBatis XML (复杂查询)
├── sql/
│   └── init.sql                         # 数据库初始化脚本
├── pom.xml
└── Dockerfile
```

---

## 七、非功能性需求

### 7.1 性能要求
- 首页加载 < 2s (LCP)
- 画布编辑器首次加载 < 3s
- 画布操作响应 < 100ms (平移/缩放/拖拽)
- API 响应 < 500ms (常规请求)
- 支持画布节点数 > 100

### 7.2 安全要求
- 所有密码 BCrypt 加密存储
- JWT Token 过期机制 (access: 2h, refresh: 7d)
- API 请求频率限制
- 文件上传类型/大小校验
- XSS/CSRF/SQL 注入防护
- AI API Key 加密存储 (AES-256)

### 7.3 兼容性
- 浏览器: Chrome 90+, Firefox 90+, Safari 15+, Edge 90+
- 分辨率: 1280x720 及以上
- 移动端: 首页响应式适配 (画布编辑器仅桌面端)

---

## 八、开发里程碑

| 阶段 | 内容 | 预估周期 |
|------|------|----------|
| **Phase 1 - 基础框架** | 项目初始化 + 用户认证 + 首页 | 1-2 周 |
| **Phase 2 - 画布核心** | 无限画布迁移 (视口+节点+连线+基础交互) | 2-3 周 |
| **Phase 3 - AI 集成** | AI 接口代理 + 文生图/图生图生成 | 1-2 周 |
| **Phase 4 - 文件系统** | 文件上传 + 存储策略 + 素材管理 | 1 周 |
| **Phase 5 - 后台管理** | Admin 面板 + 数据统计 + 用户/内容管理 | 1-2 周 |
| **Phase 6 - 高级功能** | 视频生成 + 3D场景 + 全景图 + 分镜 | 2-3 周 |
| **Phase 7 - 优化部署** | 性能优化 + Docker 部署 + OSS 对接 | 1 周 |

---

## 九、数据库 ER 关系

```
sys_user (1) ──< (N) canvas_project
sys_user (1) ──< (N) sys_file
sys_user (1) ──< (N) ai_task
sys_user (1) ──< (N) sys_log
ai_provider (1) ──< (N) ai_model
ai_model (1) ──< (N) ai_task
canvas_project (1) ──< (N) ai_task
```

---

## 十、对比: 桌面版 vs Web 版

| 维度 | 桌面版 (Electron) | Web 版 (Next.js) |
|------|-------------------|-------------------|
| 数据存储 | IndexedDB (本地) | MySQL + Redis (云端) |
| AI Key | 用户自备 | 平台统一管理 |
| 用户体系 | 无 | JWT 认证 + 角色权限 |
| 文件存储 | 本地文件系统 | 本地/OSS |
| 后台管理 | 无 | 完整 Admin 面板 |
| 分发方式 | 安装包 (.exe) | 浏览器访问 |
| 协作 | 单机 | 多用户 (预留实时协作) |
| UI 框架 | Arco Design | shadcn/ui + Tailwind |
