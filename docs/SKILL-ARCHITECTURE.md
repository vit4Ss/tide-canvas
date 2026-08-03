# Skill 架构与接入说明

## 1. 目标

Skill 不是画布节点，也不是一段由前端拼接的提示词。它是一份可版本化的创作能力，
由统一运行时执行，并通过入口绑定接入创作台、对话、画布、资产管理和 API。

旧的单模型提示词技能继续作为 `preset` 工作；新能力使用 `agent` 或 `workflow`。
三种形态共享目录卡片、版本、入口绑定和使用统计，但执行方式不同：

- `preset`：兼容原来的单次生成链路。
- `agent`：以主 Skill 文件作为系统指令，先理解用户输入，再产生一个或多个结果。
- `workflow`：按 Manifest 执行文本、生成、补充输入和人工确认步骤。

## 2. 核心数据模型

```text
Skill（目录元数据）
  └─ SkillVersion（不可变、可发布的执行快照）
       ├─ SkillFile（SKILL.md / 参考 Markdown）
       ├─ Manifest + InputSchema + 默认参数
       └─ SurfaceBindings（入口和目标类型）

SkillRun（一次持久化运行，固定版本）
  ├─ SkillRunStep（步骤与重试 attempt）
  └─ SkillRunArtifact（文本/图片/视频/音频/文件产物）
```

- 编辑目录标题、封面、分类不会改写历史执行。
- 发布新版本只影响之后创建的运行；运行始终固定其启动时的版本。
- MySQL 是运行状态的权威来源。Redis 只承担已有生成链路的实时进度缓存。
- `clientRequestId` 防止创建请求重放产生两次运行；worker lease、revision 和条件更新
  防止服务重启或取消/重试竞态让旧 worker 覆盖新状态。

## 3. Skill 文件怎么导入

后台「Skill 管理」支持两种选择方式：

1. 选择多个独立 `.md` / `.txt`：每个文件创建一个 Skill。
2. 选择目录：目录必须包含 `SKILL.md`，目录中的文本文件共同组成一个版本包。

导入会创建已发布、可追溯的 v1，但目录卡片默认保持下架。管理员检查模型、输出类型、
入口和目标绑定后再上架，避免一导入就暴露未验证能力。

当前项目 `skill` 文件夹里的几个长提示词应优先按「独立文件 → agent」导入：它们本身已经
包含完整身份、输入规则和输出协议，不需要为了使用 Skill 而强行拆成画布工作流。只有需要
确定的多步骤、人工确认或多模型串联时，才改为 `workflow`。

## 4. 输入与产物契约

所有入口统一提交：

```json
{
  "skillId": "...",
  "entryPoint": "studio",
  "targetType": "character",
  "projectId": "...",
  "conversationId": "...",
  "clientRequestId": "...",
  "input": {
    "prompt": "用户的创作要求",
    "assets": [
      { "id": "...", "type": "image", "url": "...", "role": "reference" }
    ],
    "sourceNodeIds": [],
    "parameters": { "tone": "calm" }
  }
}
```

- `prompt`、`assets`、`sourceNodeIds` 是各入口都认识的稳定字段。
- `InputSchema` 只描述 `parameters`，由共享动态表单渲染。
- 带 ID 的素材必须属于当前用户，URL 必须与该文件或历史产物完全匹配；客户端 URL
  不能借一个合法 ID 绕过所有权校验。
- 产物不直接假设 UI。`Artifact` 声明类型、角色和可选 `preferredNodeType`，各入口决定
  如何展示或物化。
- 文本型 `file` 产物会先由服务端归档为安全的 `text/plain` Markdown 文件，只有在拿到
  `fileId` 和持久 URL 后运行才会成功，客户端不负责补写或猜测文件地址。

## 5. Workflow Manifest

运行时只接受服务端注册的步骤和生成 handler，不执行上传文件中的代码、Shell 或任意 URL。

```json
{
  "kind": "workflow",
  "steps": [
    {
      "key": "draft",
      "title": "生成初稿",
      "type": "text",
      "handler": "skill_text_completion",
      "prompt": "{{prompt}}",
      "outputRole": "draft",
      "registerWork": false
    },
    {
      "key": "confirm_draft",
      "title": "确认初稿",
      "type": "approval",
      "promotePrevious": true,
      "message": "确认后完成；需要调整时提交修改意见。"
    }
  ]
}
```

模板可以读取 `{{prompt}}`、`{{input.<参数>}}`、`{{previous}}`、
`{{context.feedback}}` 和补充输入。文本步骤没有显式 system prompt 时使用固定版本的主
Skill 文件；显式 Skill 文件引用只能读取同一版本包内经过校验的相对路径。

审批前的结果必须使用 `draft` / `intermediate` 且 `registerWork=false`。确认步骤再把指定
草稿提升为 final；`revise` 会保留审计记录但不会把旧草稿暴露成最终作品。

## 6. 各产品入口

- 创作台：`preset` 继续原来的生成体验；`agent/workflow` 使用共享运行面板，支持动态输入、
  暂停确认、补充输入、失败重试和多模态结果。
- 对话：一次 SkillRun 对应一张持久化消息卡。消息列表只返回安全摘要，卡片再按所有权读取
  完整步骤和产物；最终文本可进入后续会话上下文。
- 画布：可从底部、节点顶部或选中节点启动。节点功能白名单与 Skill 入口绑定相互独立；
  运行结果按 artifact 显式物化，并记录 provenance 与已消费 artifact ID，刷新、撤销或重试
  不会重复落节点。
- 资产管理：按 `general / character / scene` 作为 `targetType` 过滤，运行完成后刷新对应资产。
- API：复用相同 SkillRun 接口与鉴权，不另建一套执行器。

## 7. 后台配置边界

后台分为两层：

- 节点功能配置：决定某类画布节点顶部有哪些原子功能。
- Skill 版本与入口绑定：决定某个 Skill 能从哪些产品入口、哪些节点或资产分类出现。

两者不能混成一份配置。例如角色节点允许 `skill.launcher`，只代表它具备打开 Skill 的能力；
真正出现哪些 Skill，仍由发布版本的 `canvas/character` 绑定决定。

## 8. 兼容与迁移

- 现有 Skill 行自动补成不可变 `preset v1`，原字段仍保留，因此旧生成入口和历史记录不丢失。
- `recordUse` 旧接口保留为兼容空操作；使用次数在服务端接受执行时原子增加，客户端无法刷数。
- 画布 V1–V4 配置会按保留管理员显式启停与相对顺序的规则迁移到 V5。未知节点、未知功能
  或 renderer 不兼容的功能不会执行；必须先在前后端白名单中注册，再允许后台配置。
- 不直接修改已发布版本。需要调整文件、模型、Schema、Manifest 或入口时，复制为新草稿，
  验证后发布。

## 9. 上线前检查

1. 在测试环境导入 Skill，并保持目录卡片下架。
2. 检查主文件、模型、输出类型、动态输入和入口 target。
3. 分别验证成功、失败、取消、重试、补充输入、确认和 revise。
4. 关闭页面等待运行完成，再打开 Studio / Chat / Canvas，确认状态与产物可恢复。
5. 验证同一个 `clientRequestId` 重放不会重复扣费或生成。
6. 验证用户不能引用其他用户的文件、运行或 artifact。
7. 发布版本并上架目录卡片；旧运行仍应显示原版本结果。
