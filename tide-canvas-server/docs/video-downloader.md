# 本站视频下载器

`/api/social-analysis/downloader/platforms`、`resolve`、`download/:token` 的前端契约不变。
视频解析和下载由 FlowLight 后端执行，不再请求 APIRouter 的 `/v1/tools/video-downloader/*`，也不需要 Relay API Key。
其他模型生成和账号分析的供应商配置不受此修改影响。

## 实现与依赖

- B 站公开视频优先使用公开资料/播放接口，支持分 P、连续分段和 DASH 音视频合并。
- 抖音优先读取公开分享页，支持视频页、分享短链及 `jingxuan?modal_id=...`；分享页无法读取或本地播放地址下载失败时，自动使用后台现有 TikHub 配置兜底。
- 快手和 Pinterest 优先读取公开分享页的视频地址；跳转到首页、登录页或账号主页会被拒绝。多个不同视频无法确定主视频时，交由平台解析器识别，避免下载推荐作品。
- YouTube、TikTok、Instagram 及原生解析未覆盖的公开链接使用 yt-dlp。
- ffmpeg 合并/封装为 MP4；兼容画质限制 1080p 并使用 H.264 / 8-bit 4:2:0，极速画质限制 480p。
- 平台没有低分辨率版本或未提供尺寸时，会读取可用版本再转码；分段缺失或合并过程中读到损坏分段时明确失败，不返回只含前几段的视频。
- 实际可用画质取决于平台公开返回的内容。私密、登录限制、付费/试看和 DRM 内容不会绕过限制。

后端 Dockerfile 已安装并校验 yt-dlp 2026.08.19（可通过构建参数 `YT_DLP_VERSION` 更新），以及 ffmpeg、ffprobe、Node.js 22+。
直接运行 Go 服务时，需要自行将这些程序加入 PATH，或设置下表中的可执行文件路径；运行环境缺少依赖时，能力接口返回 `enabled:false`。
yt-dlp 官方安装与更新说明：https://github.com/yt-dlp/yt-dlp#installation

## 配置

配置节点为 `videoDownloader`，环境变量优先。默认启用，不需要新增数据库表。

| 环境变量（统一前缀 `TIDECANVAS_VIDEODOWNLOADER_`） | 默认值 | 作用 |
| --- | --- | --- |
| `ENABLED` | `true` | 下载器开关 |
| `COMMAND` | `yt-dlp` | yt-dlp 可执行路径 |
| `FFMPEGCOMMAND` | `ffmpeg` | 合并/转码程序路径 |
| `FFPROBECOMMAND` | `ffprobe` | 媒体校验程序路径 |
| `JSRUNTIME` | `node` | Node.js 可执行路径 |
| `TEMPDIR` | 系统临时目录 | 后端专用临时文件位置 |
| `MAXFILEBYTES` | `536870912` | 单文件上限，最大允许 2 GiB |
| `MAXCONCURRENT` | `2` | 单实例下载并发，含附件传输期间 |
| `MAXCONCURRENTRESOLVES` | `4` | 单实例解析并发 |
| `RESOLVETIMEOUT` | `60s` | 单次解析总超时，最多 3 分钟 |
| `DOWNLOADTIMEOUT` | `15m` | 准备视频总超时，最多 1 小时 |

启用新镜像后，需要同步 `deploy/nginx/conf.d/flowlight.conf` 的下载路由长超时配置并 reload nginx；
否则大视频准备超过旧的 300 秒仍可能被网关截断。Next 开发代理的超时也已对齐。

## 票据与资源生命周期

解析只生成 5 分钟有效的本站签名票据，不创建下载历史；开始下载时才记录。
票据绑定用户、原链接、画质、文件名和记录 ID，不能修改参数借用他人的记录。
实际下载时重新读取公开播放地址，所以服务重启或切换后端实例不依赖内存中的上游令牌。
成功、失败、超时、断开连接均释放临时文件和并发名额；强制终止服务前残留的系统临时目录可由运维周期清理。
同一实例内，相同记录的下载请求在处理和传输期间互斥，避免重复转码或误写失败状态。
异常退出遗留的「下载中」记录，在超过一小时硬时限及一分钟宽限后，会在读取历史时标记为中断；正在传输的记录不会因为五分钟票据过期而提前结束。
解析器出站 HTTP、短链跳转及 yt-dlp 请求均校验公网地址；命令通过参数数组执行，不经过 shell。
下载结束前校验实际大小与视频轨道，再按附件流返回浏览器默认下载目录。
临时磁盘用量在进程运行期间及结束时均检查，避免快速完成的命令漏过大小限制。

## 抖音 TikHub 兜底

复用「后台配置 → 内容拆解」的 `social.tikhub.enabled`、`social.tikhub.baseUrl` 和 `social.tikhub.apiKey`，每次读取当前设置，无需额外填写下载 Key。

- 高清画质优先 `GET /api/v1/douyin/web/fetch_video_high_quality_play_url`；无有效直链时尝试 App V3 同名接口。
- 参数为 `aweme_id`（从视频页 / modal_id 提取），或短链 `share_url`，同时传 `region=CN`。取 `data.original_video_url`。
- 兼容 / 极速画质优先从 App V3 / Web 作品详情选择合适分辨率的播放地址，避免先下载体积过大的原画文件；详情没有可用播放地址时再尝试原画接口。高清画质的原画接口失败时则反向兜底到作品详情。
- TikHub 只提供解析结果，文件仍由本站下载、转码、校验后输出；API Key 不发送到媒体 CDN 或浏览器。
- 明确私密、已删除、图文作品直接报错；分享页 HTTP 403 本身不作为作品已删除的证据。
- 凭证、额度及限流错误保留具体提示并停止重试，包括 HTTP 200 响应体中的业务错误码；单次下载的媒体失败最多再尝试一次解析兜底。
- 数据库配置查询和各个接口请求均受调用方取消 / 超时控制，页面请求结束后不会继续读取配置或调用剩余接口。
- 下载不扣本站用户积分，但 TikHub API 调用按供应商账户规则计费。当前解析预览和实际下载分别获取地址，不持久保存临时直链。

接口依据：[TikHub Web 原画接口](https://docs.tikhub.io/312096106e0)、[App V3 原画接口](https://docs.tikhub.io/312096107e0)、[作品详情及 Web 兼容说明](https://docs.tikhub.io/186826219e0)。

## 验证

常规运行 `go test ./...`；安装 ffmpeg 后，会额外执行真实的转码、多段合并、损坏分段、独立音轨和临时文件清理测试。
`VIDEO_DOWNLOAD_SMOKE_URL` 可指定公开视频运行 `go test ./internal/pkg/videodownload -run TestPublicVideoSmoke -v`，
同时设置 `VIDEO_DOWNLOAD_SMOKE_FILE=1` 可验证实际 MP4 下载，测试结束会清理文件。
默认测试不会访问平台。

开发电脑若启用了 fake-IP DNS，公网校验会拒绝其 `198.18.0.0/15` 虚拟地址；
应为服务提供正常公网 DNS。联网测试也可用 `VIDEO_DOWNLOAD_SMOKE_DOH=https://223.5.5.5/dns-query`
获取真实 DNS 答案，这个选项仅在测试中生效，不更改生产地址校验。
