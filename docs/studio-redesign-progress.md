# 生成台(Creation Studio / 对话式生成)重设计 — 进度与待办

> 依据 `docs/studio-design.md` 把 `/chat`(生成台)重做成「对话即历史 + Task 为唯一真实来源」的
> 聊天式生成工作台。分阶段推进 P1→P5。**下次从 P2 继续。**

最后更新:2026-06-26

---

## ✅ P1 — 核心:Turn + Task 为唯一真实来源(已完成)

**后端**
- `model.IMMessage` 新增 `task_id`(助手消息指向生成任务)+ `params`(用户消息的参数快照);
  AutoMigrate 已加列(均可空)。
- 新端点 `POST /api/im/conversations/:id/turn`(`persistTurn`):原子持久化一个 turn
  (用户提示词+快照 / 助手 taskId),首条自动命名,无自动文字回复。
- `listMessages` 批量 join 任务状态(一条 `IN` 查询,只 select 渲染列,避免 N+1 / 大 blob),
  助手消息回带 `task{status,progress,resultUrl,resultMeta,errorMsg}`;task 不存在 → `task=null`。
- 相关文件:`internal/handler/chat/{dto,handler,register,repo,service,vo}.go`、`internal/model/im.go`。

**前端**(`src/app/(studio)/chat/page.tsx`、`lib/chat-api.ts`、`types/chat.ts`、`styles/liuguang/chat.css`)
- 选图片/视频模型送出:先 `aiApi.generate`(计费走既有管线)→ 被拒回滚乐观气泡 →
  成功 `chatApi.persistTurn` 落库 turn → 重载。
- 助手气泡从 task 渲染:生成中(带进度)/失败/已取消/已过期(task=null)/成功(图可放大、视频带播放器)。
- 轮询:有进行中任务时每 1.5s 刷新(不可见跳过、送出中暂停);刷新页面也能续跑。
- 结果下方「重新编辑 / 再次生成 / 重试」从 `params` 快照还原参数。
- 文本模型仍走原文字对话(`chatApi.send`)。

---

## ⏳ 待办(下次继续)

### P2 — Composer 重做 + 文件参考(下一步)
- 三种加入参考:`<input type=file>` 挑选 / 拖放(dragDepth 计数防闪) / 粘贴(onPaste files)。
- 上传生命周期:`URL.createObjectURL` blob 预览(uploading) → `uploadFileSmart` 真上传 → 回填 `{id/url}`;
  race-guard(预览已被替换则丢弃)、同 bytes 去重、blob 在送出/切对话/卸载三处 `revokeObjectURL`。
- id vs url:本地预览用 blob;送后端优先 `{id}` 否则 `{url}`,**永不**送 blob;历史缩图用重新签名 URL。
- 参数 pill 列(PillSelect,向上展开/键盘导览)、参考缩略图条、成本预估(余额不足禁用送出)、送出即清空。
- 文本模型附件(图片→id、其它→base64 file part),由模型 `webSearch/fileUpload` 控制按钮。

### P3 — `@` 引用 + RichPromptInput
- contentEditable(IME 安全,React 只渲染一次,不在打字时改写 DOM)、pill 渲染、inline `@` 菜单。
- 候选 scope = 当前 mode 上传;序列化 pill→`@名`;`buildSubmitBody` 去 `@`、折进参考集并以 id 去重;
  round-trip 无损(重新编辑→不改→再送出 字节级重现);粘贴自动配对;`@` query 边界 `NAME_STOP`(易出 bug)。

### P4 — 文本对话 SSE 串流
- 文本模型走 `/v1/chat/completions` 流式;`AbortController`(切对话/离开 abort,同控制器比对清理);
  每对话独立送出态(`sendingConvs` Set);Markdown 渲染;首 token 前「思考中」+ 串流 caret。

### P5 — 细节
- 灯箱(单/多图,Esc/←→,焦点管理)、对话重命名/删除、下载钮、MJ 衍生动作(U/V/reroll/zoom/pan)、
  管理员只读 scope、跨环境复制兜底(`document.execCommand` fallback)、樂觀更新 `mapTmpKeys` 防动画重播、
  自动捲動(强制 vs 接近底部跟随)。

---

## 注意(来自 studio-design.md,易踩坑)
- IME/contentEditable 不可在打字时改写 DOM;`@` query 往回扫须停在 `NAME_STOP`。
- 去重:同图可能以 `{id}`(面板)与 `{url}`(mention)两形态到达,必须以 id 去重(5 张变 9 张)。
- 乐观更新 vs 轮询:送出中暂停轮询/覆写;回滚/ setState 先确认仍在该对话。
- blob 生命周期三处 revoke;送上游永不用 blob。
- 计费/配额不绕过,一律走 `TaskService.submit`(我们这里是 `aiApi.generate`)。
