# RH Upscale 视频超分

RH Upscale 复用已有视频超分入口 `/tools/vupscale` 和 Relay 的 `POST /v1/video/upscale`。模型标识为 `rh-upscale`，任务处理器为 `video_upscale`，operation 仍为 `upscale`。

## 启用模型

1. 在后台「模型管理」刷新 Relay 模型目录，导入 modality 为 `upscale` 的 RH Upscale。
2. 配置支持的目标分辨率以及各分辨率的每秒积分，审核并上架模型。价格沿用平台配置，不自动按上游成本定价。
3. 上传或选择视频后，在视频超分页选择 RH Upscale。页面会显示增强档位与输出帧率选项。

## 参数

- `targetResolution` / `target_resolution`：`720p`、`1080p`、`2k`、`4k`。
- `upscaleModel` / `upscale_model`：`max`、`high`、`medium`、`low`。
- `outputFps` / `output_fps`：`1x`、`2x`、`3x`、`4x`，或 `23.976`、`24`、`25`、`29.97`、`30`、`48`、`50`、`59.94`、`60`、`72`、`90`、`96`、`120`、`144`。API 支持字符串或数字。

RH 可选参数未选择时不发送控件值；若工具配置了默认参数则保留，否则沿用上游路由默认值。旧请求的 `extras.output_fps` 与 `extras.upscale_model` 仍有效；对应顶层字段优先。非法顶层参数会直接拒绝，不回退到 extras。参数在探测视频时长与扣费前校验，任务记录统一保存为 `outputFps` / `upscaleModel`。发送给 Relay 时归一为顶层 snake_case 参数，不发送提示词。选择其它超分模型时，页面过滤 RH 控件和工具默认值中的 RH 专用字段。

200 同步结果与 202 异步任务均沿用已有结果处理和轮询逻辑；输出读取 `output_url` 或 `data[0].url`。页面刷新后从冻结请求恢复原模型及 RH 参数，兼容模型行 ID、上游 key 和旧 extras 写法。收到 5011（`submission_outcome_unknown`）时保留错误码，不自动重新提交上游请求，并提示用户先核实任务状态，避免重复提交。
