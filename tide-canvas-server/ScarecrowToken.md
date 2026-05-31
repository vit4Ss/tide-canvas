/v1/images/generations
按 prompt 生成图片(如 gpt-image-2)。同步成功返回 200,上游异步时返回 202 + task id,需轮询 /v1/tasks/{id}。

示例请求
```
curl https://relay.mbfczzzz.top/v1/images/generations \
-H "Authorization: Bearer $SCARECROWTOKEN_API_KEY" \
-H "Content-Type: application/json" \
-d '{
"model": "gpt-image-2",
"prompt": "A retro-futuristic skyline at sunset",
"resolution": "1k",
"aspect_ratio": "1:1",
"quality": "high"
}'
```
model	string	是	gpt-image-2 等(GET /v1/models 查看)	模型 ID。后端按 (model, operation) 路由到上游适配器。
prompt	string	是	任意文本	生图提示词。
quality	string	否	low / medium / high	出图质量,影响积分扣费(单次 2.00 – 8.00 credits)。
resolution	string	否	1k / 2k / 4k(规范)	未匹配 schema 的值会原样透传给适配器,可能成功也可能上游报错,生产环境建议严格按 schema 取值。
aspect_ratio	string	否	1:1 / 16:9 / 9:16	别名 aspect 也接受(@JsonAlias)。其他值原样透传。

200 同步成功(适配器拿到结果)
```
{
"created": 1780070073,
"data": [{ "url": "https://..." }],
"id": "task_xxx",
"status": "succeeded",
"model": "gpt-image-2"
}
```

202 异步进行中,需轮询 /v1/tasks/{id}
{ "id": "task_xxx", "status": "processing", "model": "gpt-image-2" }

502 任务失败,符合 OpenAI 错误信封
```
{
"error": { "message": "...", "type": "task_failed", "code": "task_failed" },
"id": "task_xxx",
"status": "failed"
}
```

/v1/images/edits
示例请求
```
curl https://relay.mbfczzzz.top/v1/images/edits \
  -H "Authorization: Bearer $SCARECROWTOKEN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-image-2",
    "prompt": "Make the sky a vivid sunset",
    "image_urls": ["https://example.com/source.png"]
  }'
```
请求参数
字段	类型	必填	可选值	说明
model	string	是	支持 edits 操作的图像模型	需在 /v1/models 中 operations 包含 "edits"。
prompt	string	是	任意文本	对参考图的编辑指令。
image_urls	string[]	是	1 – 4 个公网可达 URL	当前只取数组第一项作为 first_frame 传给适配器;多图入参为对齐 OpenAI 规范。
quality	string	否	low / medium / high	同 /v1/images/generations。
resolution	string	否	1k / 2k / 4k	同 /v1/images/generations,未匹配值透传。


响应 
200 同步成功
```
{ "created": ..., "data": [{ "url": "..." }], "id": "task_xxx", "status": "succeeded", "model": "..." }
```

202 异步进行中
```
{ "id": "task_xxx", "status": "processing", "model": "..." }
```

502 失败
```
{ "error": { "message": "...", "type": "task_failed", "code": "task_failed" }, "id": "task_xxx", "status": "failed" }
```

POST
/v1/contents/generations/tasks

提交视频任务(Seedance)。content[] 多模态数组,role 选 first_frame / last_frame / reference_image / reference_video / reference_audio。

```
curl https://relay.mbfczzzz.top/v1/contents/generations/tasks \
  -H "Authorization: Bearer $SCARECROWTOKEN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "seedance-v2",
    "ratio": "16:9",
    "resolution": "720p",
    "content": [
      {"type": "text", "text": "the cat slowly turns and yawns"},
      {"type": "image_url",
       "image_url": {"url": "https://example.com/cat.png"},
       "role": "first_frame"}
    ]
  }'
```

请求参数
字段	类型	必填	可选值	说明
model	string	是	seedance-v2 / seedance-v2-fast 等视频模型	GET /v1/models 中 modality = "video" 的模型。
content	object[]	是	多模态数组,每项 type ∈ text / image_url / video_url / audio_url	text 项:{ type:"text", text:"..." }。image_url / video_url / audio_url 项:{ type, *_url:{ url|id }, role }。role 可选:first_frame / last_frame / reference_image / reference_video / reference_audio。
ratio	string	否	16:9 / 4:3 / 1:1 / 3:4 / 9:16 / 21:9 / adaptive	画幅比例(后端映射到 aspect 字段)。
resolution	string	否	720p / 1080p / 512 / 1024 / 2048 / 4k	seedance-v2 全集;seedance-v2-fast 仅 720p / 1080p。
duration	string	否	5s / 10s / 15s	视频时长。
fps	string	否	24 / 30 / 60	视频帧率。
mode	string	否	t2v / i2v / keyframe / omni_ref	显式声明 sub-mode 可短路适配器内容推断,加快校验;省略时按 content 推断(last_frame → keyframe,有参考媒体 → omni_ref,仅 first_frame → i2v)。

响应
202 已受理,需轮询(视频几乎都是异步)
```
{ "id": "task_xxx", "status": "processing", "model": "seedance-v2" }
```
200 同步成功(少见)
```
{ "created": ..., "data": [{ "url": "..." }], "id": "task_xxx", "status": "succeeded", "model": "..." }
```
400 请求体非法
```
"model is required" 或 "content is required"
```
502 上游失败
```
{ "error": { "message": "...", "type": "task_failed", "code": "task_failed" }, "id": "task_xxx", "status": "failed" }
```

/v1/tasks/{id}

查询任意异步任务状态(图片或视频)。status=succeeded 时返回 output_url。

示例请求
```
curl https://relay.mbfczzzz.top/v1/tasks/{id} \
-H "Authorization: Bearer $SCARECROWTOKEN_API_KEY"
```


请求参数
字段	类型	必填	可选值	说明
id(path)	string	是	提交时返回的 task id	路径参数。仅返回归属当前 API key 所属用户的任务,跨用户访问 403。
响应

200 查询成功(任意终态/中间态)
```
{
"id": "task_xxx",
"object": "generation.task",
"model": "gpt-image-2",
"operation": "generation",
"status": "queued | processing | succeeded | failed",
"reserved_credits": "2.00",
"settled_credits": "2.00",
"output_url": "https://...",
"error_message": "",
"created_at": 1780070073000,
"updated_at": 1780070115000
}
```
403 不属于当前 API key 用户
```
{ "error": { "message": "not your task" } }
```
404 task id 不存在
```
{ "error": { "message": "task" } }
```


/v1/models

示例请求
```
curl https://relay.mbfczzzz.top/v1/models \
-H "Authorization: Bearer $SCARECROWTOKEN_API_KEY"
```

响应
200 启用中的模型列表
```
[
    {
        "id": "gpt-image-2",
        "name": "GPT Image 2",
        "modality": "image",
        "operations": ["generation", "edits"],
        "min_credit_cost": 2.00,
        "max_credit_cost": 8.00,
        "capabilities": ["1k/2k/4k", "low/medium/high quality", "edits"],
        "resolution_options": ["1k", "2k", "4k"],
        "params_schema": {
        "modes": ["t2i", "i2i"],
        "aspect": ["1:1", "16:9", "9:16"],
        "quality": ["low", "medium", "high"],
        "resolution": ["1k", "2k", "4k"]
        }
    }
]
```