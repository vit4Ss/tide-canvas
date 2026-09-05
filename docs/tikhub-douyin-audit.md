# 抖音账号识别与接口兼容核查（2026-09-05）

## 原因

截图 URL 为 `https://www.douyin.com/jingxuan?modal_id=7669082935156313379`，选择的是“整个账号”。
旧实现把除 `/user/...` 之外的链接全部交给 `web/get_sec_user_id?url=...`。
[该接口的官方参数说明](https://docs.tikhub.io/186826167e0)要求账号主页 URL；精选页的 `modal_id` 则标识作品。
此外旧实现允许将返回的 `user_id` 填进 `sec_user_id` 参数；数字 UID、抖音号和 sec_user_id 不能混用。
App 两个账号接口即使成功响应，若返回空对象，旧实现也不尝试其他接口，最终统一报“没有可识别的账号或作品信息”。

未取得截图那次带 Key 的原始响应，因此不能断言其上游返回了什么具体对象；链接分派和标识混用的代码缺口可以确认。

## 修复后的分派

- 明确的 `/user/{sec_user_id}` 主页或合法的 sec_uid 查询参数：按账号标识查询资料、作品。
- `/jingxuan?modal_id=...`、`/video/{id}`、`/note/{id}`：按作品 ID 读取详情，从该作品的 `author.sec_uid` 识别作者，再分析账号。
- 分享短链：尝试提取账号；没有合法 sec_user_id 时读取分享作品及作者。只有作者 UID 时，使用 `web/fetch_user_profile_by_uid?uid=...` 查询，并核对返回 UID，不能把 UID 传到 sec_user_id 参数中。
- 没有具体作品标识的精选/搜索页：直接提示提供作品或主页，避免无效调用。
- 单个作品模式也支持 modal_id，保留 ID 字符串，避免长整数精度丢失。
- 账号主页按钮使用解析后的作者主页地址；原始输入 URL 仍保存在历史记录中，保证历史恢复和 AI 运行关联一致。

## 实际调用与上限

| 目的 | 主接口 | 有限补充 |
| --- | --- | --- |
| 已知作品 ID 的详情 | `app/v3/fetch_one_video?aweme_id=...` | `web/fetch_one_video`，同一作品 ID |
| 分享作品详情 | `app/v3/fetch_one_video_by_share_url` | `web/fetch_one_video_by_share_url` |
| 账号资料 | `app/v3/handler_user_profile?sec_user_id=...` | `web/handler_user_profile` |
| 最近 12 条作品 | `app/v3/fetch_user_post_videos` | `web/fetch_user_post_videos` |

路径均以 `/api/v1/douyin/` 开头。官方[App 作品接口](https://docs.tikhub.io/186826219e0)明确建议空响应时尝试 Web，并给出 `filter_list[].reason` 的访问限制含义。
账号接口优先 App；Web 仅补空缺，不改变已有的有效结果。整个检查有 55 秒上限，不无限重试、不批量翻页。
正常主页两次请求；正常作品转账号三次请求。最复杂的短链、UID 查询和全部补充路径最多八次请求。

## 返回与数据边界

- 从确定的作品、作者、账号节点读取数据，不递归借用推荐作品、其他作者或其他账号的指标。
- App 或 Web 一侧失败时保留已有账号/作品，返回缺失提示。
- 只有账号作品数明确为 0 且作品列表成功返回空数组时，才按零作品账号处理；网络错误或无法识别的对象不能当作 0。
- 对官方返回的访问限制给出具体说明；原因 8 同时涵盖删除和地区/版权限制，不能武断判断其中一种。
- 保留原始响应明确返回的 0；没有提供的数据继续缺省，不凭空补指标。

## 验证范围

读取官方完整 OpenAPI 中相关详情、账号资料、作品列表、ID 提取和 UID 查询接口说明。
成功请求官方免费 Demo 的 App 和 Web 两种真实响应，验证 `aweme_detail.author` 与 `statistics` 的字段结构。
回归 fixture 只保留必要结构、公开 ID/数字，并替换文本和素材 URL。
截图的作品及生产 TikHub Key 未实调，不将 Demo 验证描述为该作品的线上成功。
