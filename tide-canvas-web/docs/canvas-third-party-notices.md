# 核心画布新增第三方依赖说明

本文件记录本次核心画布重构直接引入的运行时依赖。完整依赖及准确版本以 `package-lock.json` 为准。

## React Flow / `@xyflow/react`

- 用途：画布平移、缩放、节点拖动、选择、连线、缩略图和视口裁剪。
- 版本：`12.11.2`。
- 项目：https://github.com/xyflow/xyflow
- 许可证：MIT。
- 说明：默认保留 React Flow 界面署名。仅在已确认订阅 React Flow Pro 时配置
  `NEXT_PUBLIC_REACT_FLOW_PRO=true` 隐藏；MIT 版权与许可声明仍随依赖包和部署制品保留。

## Zod / `zod`

- 用途：服务端 `canvasData` 的运行时结构校验及损坏数据隔离。
- 版本：`4.4.3`。
- 项目：https://github.com/colinhacks/zod
- 许可证：MIT。

## 维护要求

- 升级依赖前先查看发布说明和许可证变化，并执行类型检查、Lint、生产构建和画布手动验收。
- 不得把 React Flow 的内部数据结构写入持久化格式。
- 不得绕过 Zod 边界直接把未验证 JSON 写入画布领域状态。
- 发布前执行 `npm audit`；高危或严重生产依赖漏洞必须在发布前解决或形成书面风险接受。
