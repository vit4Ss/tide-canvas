# 核心画布架构

本文约束 `/canvas/*` 的前端实现。目标是在不改变接口、业务语义和存量
`canvasData` 的前提下，使画布代码具备清晰边界、故障恢复能力和可替换的基础设施。

## 目录职责

```text
features/canvas/
├── domain/          # 纯领域模型、Zod 持久化边界；不得依赖 React、API 或 Zustand
├── application/     # 用例、策略和协调 Hook；组织业务流程，不直接渲染页面
├── infrastructure/  # React Flow、序列化、监控等外部能力适配器
└── presentation/    # 画布编排、节点壳、错误态和局部交互组件
```

现有 `components/canvas` 与 `hooks/canvas` 暂时作为兼容层保留。新增逻辑优先放入
`features/canvas`；兼容层只负责旧节点 UI、既有生成流程或对外导出，不能继续堆积跨层策略。

依赖方向固定为：

```text
presentation → application → domain
       │             │
       └──────→ infrastructure
```

`domain` 不得反向依赖其它层。React Flow 的 `Node`、`Edge`、`Viewport` 类型不得进入领域模型或
持久化 JSON。

## 状态所有权

| 状态 | 唯一来源 | 说明 |
| --- | --- | --- |
| 节点、连接、分组、选择、撤销栈 | `useCanvasStore` | 领域状态；React Flow 只是受控渲染器 |
| 平移与缩放 | React Flow | 通过 `onMove` 同步到旧 `useCanvasViewStore`，仅供兼容 UI 读取 |
| 项目 revision、保存冲突、自动保存 | `useCanvasPersistence` | CAS 保存、在途合并、丢响应核对和退避重试 |
| 项目加载与跨页启动凭据 | `useCanvasProjectLoader` | 身份确认、文档恢复、生成任务续跑 |
| AI 生成登记与轮询 | `use-ai-generation` 模块级运行时 | 不绑定某个节点组件生命周期 |
| React Flow 节点与边 | `canvas-flow-adapter` | 从领域状态派生，不单独持久化 |

禁止维护第二份可写节点状态。所有节点变更最终必须通过 `useCanvasStore`。

## 页面数据流

```text
服务端 canvasData
  → Zod 顶层校验
  → 节点/连接/分组逐条校验与损坏项隔离
  → 领域文档 + 未知扩展字段
  → Zustand
  → React Flow adapter
  → React Flow 节点壳
  → 既有媒体节点 UI
```

保存方向相反：从 Zustand 取同一时刻的快照，移除 `blob:` 临时媒体地址，与未知顶层扩展字段
合并后序列化。框架内部字段不会进入 `canvasData`。

## 持久化与兼容约束

- `canvasData` 的 `nodes`、`connections`、`groups`、`skillRuns` 字段保持兼容。
- 未识别的顶层扩展字段必须往返保留，已知的旧 `skillRunState` 会迁移为 `skillRuns`。
- 单个坏节点、坏连接或坏分组只隔离该条记录，不能清空整张画布。
- 重复或缺失 ID 会生成稳定的本次恢复 ID；悬空连接和空分组会被隔离。
- `blob:` URL 不可跨会话恢复，禁止持久化。
- 已付费或可能已付费的生成请求必须先持久化冻结请求，再用稳定
  `clientRequestId` 调用幂等创建接口。
- 保存使用 revision compare-and-swap。发生真实冲突后暂停自动保存，不能覆盖其它窗口数据。

## React Flow 边界

React Flow 负责：

- 画布平移、滚轮/触控板滚动、捏合缩放；
- 节点拖动、吸附、框选和多选；
- 连接手柄、连线命中、边选择；
- 视口裁剪、适配视图和缩略图。

项目负责：

- 节点业务 UI、生成、上传和媒体展示；
- 节点/连接/分组领域模型；
- 撤销重做与持久化；
- 拖空连接后的快捷创建；
- 分组视觉层与分组移动。

`canvas-flow-adapter` 使用领域对象身份缓存派生对象。单节点不可变更新时，未变化的其余节点保持
React Flow 对象引用，从而降低 500 节点场景的无效渲染。

## 交互约定

- 左键拖动画布节点，左键拖空白区域框选需按住 Shift；中键或空白拖动用于平移。
- 触控板双指滚动平移，捏合缩放；禁止把普通滚轮强制解释为缩放。
- `Meta`/`Control` 用于多选，Delete/Backspace 继续走项目键盘协调器。
- 所有节点内部按钮、输入框、链接、音视频控件必须阻止指针事件冒泡到节点拖动。
- 触摸命中半径和连接半径不得低于当前 React Flow 配置；新增交互使用 Pointer Events，避免只监听鼠标。

## 错误与监控

`canvas-telemetry.ts` 是唯一监控出口。当前默认 sink 为无操作实现，后续接入云厂商监控或 SDK 时调用
`configureCanvasTelemetry` 注入适配器，业务代码不得直接依赖具体监控厂商。

事件命名使用稳定的点分层级，例如：

- `canvas.persistence.saved`
- `canvas.persistence.failed`
- `canvas.persistence.conflict`
- `canvas.document.recovered`
- `canvas.error_boundary.caught`

属性只允许非敏感、可序列化的计数、ID 和状态。不得上报提示词、鉴权信息、完整媒体 URL 或画布 JSON。

编辑器级错误边界提供整体恢复入口；节点级错误边界只隔离故障节点，避免一个媒体组件导致整张画布白屏。

## 性能预算与策略

目标工作负载为 500 个混合媒体节点。当前策略：

- `onlyRenderVisibleElements` 避免渲染视口外节点；
- React Flow 适配结果按不可变领域对象缓存；
- 拖动位置批量写回，拖动开始只记录一次历史快照；
- 选择集合变化前进行集合相等判断；
- 自动保存防抖 3 秒，在途保存只标记一次后续保存；
- 生成轮询采用单例登记、指数退避和长任务降频；
- 3D/媒体重资源继续遵循已有动态加载边界。

新增功能应以 500 节点为默认评审规模，避免在 render 中反复扫描所有节点、解析大 JSON 或创建对象 URL。

## 扩展与协作预留

未来实时协作不得直接把 WebSocket/CRDT 逻辑塞进组件或 Zustand action。推荐新增
`application/collaboration` 端口：

```ts
interface CanvasCollaborationPort {
  publish(operation: CanvasOperation): void;
  subscribe(listener: (operation: CanvasOperation) => void): () => void;
}
```

本轮不实现协议、光标、权限或冲突算法。引入协作前需先把当前快照式 action 定义为可重放操作，并明确
服务端权威、离线队列和生成任务所有权。

## 代码准入规则

- 新画布代码使用严格 TypeScript，不使用显式 `any`、`@ts-ignore` 或无说明的类型断言。
- 函数只承担一个用例；复杂条件提取为命名策略函数。
- 注释解释约束、时序和风险，不复述代码。
- 组件不直接解析持久化 JSON，不直接调用监控 SDK，不持有第二份领域状态。
- 合并前执行 `npm run typecheck`、`npm run lint`、`npm run build`，并完成手动验收清单。

