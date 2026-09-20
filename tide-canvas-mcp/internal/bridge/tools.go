package bridge

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

var requestIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$`)
var taskIDPattern = regexp.MustCompile(`^[1-9][0-9]{0,18}$`)

func validTaskID(id string) bool {
	if !taskIDPattern.MatchString(id) {
		return false
	}
	n, err := strconv.ParseInt(id, 10, 64)
	return err == nil && n > 0
}

func parseTask(data json.RawMessage, expectedID string) (Task, error) {
	var required struct {
		ID     *string `json:"id"`
		Status *int    `json:"status"`
	}
	if err := json.Unmarshal(data, &required); err != nil || required.ID == nil || !validTaskID(*required.ID) || required.Status == nil || *required.Status < 0 || *required.Status > 3 {
		return Task{}, errors.New("主站任务响应缺少有效 ID 或状态，请检查主站服务，不能按生成中继续轮询")
	}
	if expectedID != "" && *required.ID != expectedID {
		return Task{}, errors.New("主站返回了不匹配的任务 ID，请稍后查询原任务")
	}
	var task Task
	if err := json.Unmarshal(data, &task); err != nil {
		return Task{}, errors.New("主站任务响应格式不兼容")
	}
	return task, nil
}

type CommonInput struct {
	ModelID         string         `json:"modelId" jsonschema:"主站 list_models 返回的 modelId，不是模型展示名"`
	ClientRequestID string         `json:"clientRequestId" jsonschema:"本次生成的唯一编号，建议 UUID；同一次生成的超时重试必须沿用原编号和原参数，新的生成才换新编号"`
	Prompt          string         `json:"prompt,omitempty" jsonschema:"用户确认的生成描述；纯歌词音乐等模式可留空并传 parameters"`
	Parameters      map[string]any `json:"parameters,omitempty" jsonschema:"按模型 config 传入 resolution、quality、ratio、duration、batchCount，或音频 lyrics、tags、extras 等；不要传入 handler、身份、积分、提示词或参考素材字段"`
}
type ImageInput struct {
	CommonInput
	ImageURLs []string `json:"imageUrls,omitempty" jsonschema:"可选参考图片 URL；提供后使用图生图，否则文生图。先通过主站上传素材"`
}
type VideoInput struct {
	CommonInput
	Mode       string   `json:"mode,omitempty" jsonschema:"可选：text_to_video、image_to_video、start_end_to_video、reference_to_video；未填时根据参考素材自动选择"`
	ImageURLs  []string `json:"imageUrls,omitempty" jsonschema:"参考图片 URL 列表"`
	FirstFrame string   `json:"firstFrame,omitempty" jsonschema:"首尾帧模式的首帧 URL"`
	LastFrame  string   `json:"lastFrame,omitempty" jsonschema:"首尾帧模式的尾帧 URL"`
	VideoURLs  []string `json:"videoUrls,omitempty" jsonschema:"全能参考模式的视频 URL 列表"`
	AudioURLs  []string `json:"audioUrls,omitempty" jsonschema:"全能参考模式的音频 URL 列表"`
}
type AudioInput struct{ CommonInput }
type TaskInput struct {
	TaskID string `json:"taskId" jsonschema:"生成接口返回的任务 ID；必须原样传字符串，不可转浮点数"`
}
type ModelsInput struct {
	Type string `json:"type,omitempty" jsonschema:"按 image、video、audio 筛选；空值返回三类模型"`
}
type HistoryInput struct {
	PageNum  int  `json:"pageNum,omitempty" jsonschema:"页码，默认 1"`
	PageSize int  `json:"pageSize,omitempty" jsonschema:"每页条数，默认 20，上限 100"`
	Status   *int `json:"status,omitempty" jsonschema:"可选任务状态：0 生成中、1 成功、2 失败、3 已取消"`
}
type TaskOutput struct {
	Task             Task   `json:"task"`
	StatusText       string `json:"statusText"`
	PollAfterSeconds int    `json:"pollAfterSeconds,omitempty"`
}

func taskOutput(ctx context.Context, task Task) TaskOutput {
	text := map[int]string{0: "processing", 1: "succeeded", 2: "failed", 3: "cancelled"}[task.Status]
	if text == "" {
		text = "unknown"
	}
	output := TaskOutput{Task: task, StatusText: text}
	if task.Status == 0 {
		output.PollAfterSeconds = 5
		if policy, ok := ctx.Value(policyContextKey{}).(Policy); ok {
			output.PollAfterSeconds = policy.PollIntervalSeconds
		}
	}
	return output
}

func (c *Client) create(ctx context.Context, handler string, common CommonInput, refs map[string]any) (*mcp.CallToolResult, TaskOutput, error) {
	common.ModelID = strings.TrimSpace(common.ModelID)
	common.ClientRequestID = strings.TrimSpace(common.ClientRequestID)
	if common.ModelID == "" {
		return nil, TaskOutput{}, errors.New("请先调用 list_models，选择主站实际可用的 modelId")
	}
	if !requestIDPattern.MatchString(common.ClientRequestID) {
		return nil, TaskOutput{}, errors.New("clientRequestId 必须为 1–80 位字母、数字、点、下划线、冒号或连字符，首位为字母或数字")
	}
	if (handler == "text_to_image" || handler == "text_to_video") && strings.TrimSpace(common.Prompt) == "" {
		return nil, TaskOutput{}, errors.New("文生图或文生视频需要填写 prompt；参考素材请放入工具顶层的对应字段")
	}
	input := make(map[string]any, len(common.Parameters)+len(refs)+1)
	reserved := map[string]bool{"prompt": true, "handler": true, "modelId": true, "clientRequestId": true, "userId": true, "projectId": true, "isApiCall": true, "pointCost": true, "imageUrls": true, "image_urls": true, "imageList": true, "sourceImage": true, "imageUrl": true, "image_url": true, "firstFrame": true, "lastFrame": true, "startImageUrl": true, "endImageUrl": true, "videoReferences": true, "video_urls": true, "audioReferences": true, "audio_urls": true, "videoUrls": true, "audioUrls": true, "mode": true, "parameters": true}
	for key, value := range common.Parameters {
		if reserved[key] {
			return nil, TaskOutput{}, errors.New("parameters 中不能包含受保护字段 " + key + "；请使用工具的对应顶层参数")
		}
		input[key] = value
	}
	input["prompt"] = common.Prompt
	for key, value := range refs {
		input[key] = value
	}
	var raw json.RawMessage
	err := c.request(ctx, "POST", "/api/open/v1/generations", map[string]any{
		"handler": handler, "modelId": common.ModelID, "clientRequestId": common.ClientRequestID, "input": input,
	}, true, &raw)
	if err != nil {
		return nil, TaskOutput{}, err
	}
	task, err := parseTask(raw, "")
	if err != nil {
		return nil, TaskOutput{}, errors.New(err.Error() + "；提交结果未确认，请沿用原 clientRequestId 和原参数重试，不要换新编号")
	}
	return nil, taskOutput(ctx, task), nil
}

func validateMediaURLs(values ...[]string) error {
	for _, group := range values {
		for _, raw := range group {
			u, err := url.Parse(raw)
			if err != nil || u.Hostname() == "" || u.User != nil || (u.Scheme != "http" && u.Scheme != "https") {
				return errors.New("参考素材必须是 HTTP/HTTPS URL；不接受本地路径或 base64，请先通过主站上传")
			}
		}
	}
	return nil
}

func (c *Client) image(ctx context.Context, _ *mcp.CallToolRequest, input ImageInput) (*mcp.CallToolResult, TaskOutput, error) {
	if err := validateMediaURLs(input.ImageURLs); err != nil {
		return nil, TaskOutput{}, err
	}
	handler, refs := "text_to_image", map[string]any{}
	if len(input.ImageURLs) > 0 {
		handler = "image_to_image"
		refs["imageUrls"] = input.ImageURLs
	}
	return c.create(ctx, handler, input.CommonInput, refs)
}

func (c *Client) video(ctx context.Context, _ *mcp.CallToolRequest, input VideoInput) (*mcp.CallToolResult, TaskOutput, error) {
	frames := []string{}
	if input.FirstFrame != "" {
		frames = append(frames, input.FirstFrame)
	}
	if input.LastFrame != "" {
		frames = append(frames, input.LastFrame)
	}
	if err := validateMediaURLs(input.ImageURLs, input.VideoURLs, input.AudioURLs, frames); err != nil {
		return nil, TaskOutput{}, err
	}
	mode := input.Mode
	if mode == "" {
		switch {
		case len(frames) > 0:
			mode = "start_end_to_video"
		case len(input.VideoURLs)+len(input.AudioURLs) > 0:
			mode = "reference_to_video"
		case len(input.ImageURLs) > 1:
			mode = "reference_to_video"
		case len(input.ImageURLs) == 1:
			mode = "image_to_video"
		default:
			mode = "text_to_video"
		}
	}
	refs := map[string]any{}
	switch mode {
	case "text_to_video":
		if len(input.ImageURLs)+len(input.VideoURLs)+len(input.AudioURLs)+len(frames) > 0 {
			return nil, TaskOutput{}, errors.New("文生视频模式不能同时传参考素材，请选择匹配的模式")
		}
	case "image_to_video":
		if len(input.ImageURLs) != 1 || len(input.VideoURLs)+len(input.AudioURLs)+len(frames) > 0 {
			return nil, TaskOutput{}, errors.New("图生视频需要一张 imageUrls 首帧；多素材请使用全能参考模式")
		}
		refs["imageUrls"] = input.ImageURLs
	case "start_end_to_video":
		if input.FirstFrame == "" || input.LastFrame == "" || len(input.ImageURLs)+len(input.VideoURLs)+len(input.AudioURLs) > 0 {
			return nil, TaskOutput{}, errors.New("首尾帧模式请同时传 firstFrame 和 lastFrame，不混用其他素材字段")
		}
		refs["firstFrame"], refs["lastFrame"] = input.FirstFrame, input.LastFrame
	case "reference_to_video":
		if len(input.ImageURLs)+len(input.VideoURLs)+len(input.AudioURLs) == 0 || len(frames) > 0 {
			return nil, TaskOutput{}, errors.New("全能参考模式需要 imageUrls、videoUrls 或 audioUrls，不使用首尾帧字段")
		}
		if len(input.ImageURLs) > 0 {
			refs["imageUrls"] = input.ImageURLs
		}
		if len(input.VideoURLs) > 0 {
			refs["videoReferences"] = input.VideoURLs
		}
		if len(input.AudioURLs) > 0 {
			refs["audioReferences"] = input.AudioURLs
		}
	default:
		return nil, TaskOutput{}, errors.New("未知的视频生成模式")
	}
	return c.create(ctx, mode, input.CommonInput, refs)
}

func (c *Client) audio(ctx context.Context, _ *mcp.CallToolRequest, input AudioInput) (*mcp.CallToolResult, TaskOutput, error) {
	return c.create(ctx, "text_to_audio", input.CommonInput, nil)
}

func NewServer(c *Client) *mcp.Server {
	server := mcp.NewServer(&mcp.Implementation{Name: "flowlight-generation", Version: serverVersion}, &mcp.ServerOptions{
		Instructions: "使用用户自己的主站 API Key。先 list_models 获取真实 modelId 和规格。生成会扣用户积分，按用户明确的创作需求调用。本地参考文件先用 prepare_asset_upload 取得一次性地址并由客户端上传；公网文件直链用 import_asset_url 导入，随后把返回 URL 传给生成工具。每个新任务用唯一 clientRequestId；超时重试沿用原编号和参数，禁止自动改编号重生成。返回 processing 表示已受理，每 5–10 秒 get_generation_task 查询；成功用 resultUrl/resultMeta 展示结果，失败显示 errorMsg。不得把生成中说成已成功。",
		SetCacheable: func(_ context.Context, _ mcp.Request, cache *mcp.Cacheable) { cache.CacheScope = "private" },
	})
	no, yes := false, true
	server.AddReceivingMiddleware(c.policyMiddleware)
	// Generation debits an existing points balance; clients must not mistake
	// these paid tools for read-only or purely additive operations.
	paid := &mcp.ToolAnnotations{ReadOnlyHint: false, DestructiveHint: &yes, IdempotentHint: true, OpenWorldHint: &yes}
	read := &mcp.ToolAnnotations{ReadOnlyHint: true, DestructiveHint: &no, IdempotentHint: true, OpenWorldHint: &yes}
	write := &mcp.ToolAnnotations{ReadOnlyHint: false, DestructiveHint: &no, IdempotentHint: true, OpenWorldHint: &yes}
	mcp.AddTool(server, &mcp.Tool{Name: "import_asset_url", Description: "把可直接下载的公网图片、视频、音频或文件 URL 导入当前账号，返回生成工具和 Skill 可复用的素材 ID/URL；不扣积分但占用存储空间。", Annotations: write}, func(ctx context.Context, _ *mcp.CallToolRequest, input ImportSkillAssetInput) (*mcp.CallToolResult, SkillAssetRecord, error) {
		return importSkillAsset(ctx, c, input)
	})
	mcp.AddTool(server, &mcp.Tool{Name: "prepare_asset_upload", Description: "为本地文件签发 5 分钟一次性上传地址。客户端按返回信息上传后，响应中的 ID/URL 可用于生成工具和 Skill；不扣积分。", Annotations: write}, func(ctx context.Context, _ *mcp.CallToolRequest, input PrepareSkillAssetUploadInput) (*mcp.CallToolResult, SkillAssetUploadPlan, error) {
		return prepareSkillAssetUpload(ctx, c, input)
	})
	mcp.AddTool(server, &mcp.Tool{Name: "generate_image", Description: "生成图片或基于参考图修改图片。按主站定价扣积分；返回任务 ID，使用 get_generation_task 获取最终结果。重试必须保持 clientRequestId 和全部参数不变。", Annotations: paid}, c.image)
	mcp.AddTool(server, &mcp.Tool{Name: "generate_video", Description: "生成视频，支持文生、图生、首尾帧和全能参考。使用用户积分，立即返回任务 ID；不要在未查到 succeeded 时声称视频完成。", Annotations: paid}, c.video)
	mcp.AddTool(server, &mcp.Tool{Name: "generate_audio", Description: "生成音乐、音效或语音，具体能力由所选主站音频模型决定。按主站定价扣积分；参数中可传 lyrics、tags、title、makeInstrumental、extras。", Annotations: paid}, c.audio)
	mcp.AddTool(server, &mcp.Tool{Name: "list_models", Description: "读取主站当前启用的图片、视频和音频模型及其规格、定价配置。生成前选择实际 modelId，不要编造模型名称。", Annotations: read}, func(ctx context.Context, _ *mcp.CallToolRequest, input ModelsInput) (*mcp.CallToolResult, map[string]any, error) {
		if input.Type != "" && input.Type != "image" && input.Type != "video" && input.Type != "audio" {
			return nil, nil, errors.New("type 只能是 image、video 或 audio")
		}
		var models []Model
		if err := c.get(ctx, "/models", &models); err != nil {
			return nil, nil, err
		}
		selected := []Model{}
		for _, model := range models {
			if (model.Type == "image" || model.Type == "video" || model.Type == "audio") && (input.Type == "" || model.Type == input.Type) {
				selected = append(selected, model)
			}
		}
		return nil, map[string]any{"models": selected, "total": len(selected)}, nil
	})
	mcp.AddTool(server, &mcp.Tool{Name: "get_generation_task", Description: "查询自己任务的实际进度、扣费和结果 URL。status 0 生成中、1 成功、2 失败、3 取消；终态停止轮询。查询不会再次生成或扣费。", Annotations: read}, func(ctx context.Context, _ *mcp.CallToolRequest, input TaskInput) (*mcp.CallToolResult, TaskOutput, error) {
		if !validTaskID(input.TaskID) {
			return nil, TaskOutput{}, errors.New("taskId 必须是主站返回的数字 ID 字符串")
		}
		var raw json.RawMessage
		if err := c.get(ctx, "/tasks/"+input.TaskID, &raw); err != nil {
			return nil, TaskOutput{}, err
		}
		task, err := parseTask(raw, input.TaskID)
		if err != nil {
			return nil, TaskOutput{}, err
		}
		return nil, taskOutput(ctx, task), nil
	})
	mcp.AddTool(server, &mcp.Tool{Name: "list_generation_tasks", Description: "分页查看自己的接口调用历史，包括 MCP 和 REST 提交的生成任务。", Annotations: read}, func(ctx context.Context, _ *mcp.CallToolRequest, input HistoryInput) (*mcp.CallToolResult, map[string]any, error) {
		if input.PageNum == 0 {
			input.PageNum = 1
		}
		if input.PageSize == 0 {
			input.PageSize = 20
		}
		if input.PageNum < 1 || input.PageNum > 1_000_000 || input.PageSize < 1 || input.PageSize > 100 {
			return nil, nil, errors.New("pageNum 应为 1–1000000，pageSize 应为 1–100")
		}
		q := url.Values{"pageNum": {strconv.Itoa(input.PageNum)}, "pageSize": {strconv.Itoa(input.PageSize)}}
		if input.Status != nil {
			if *input.Status < 0 || *input.Status > 3 {
				return nil, nil, errors.New("status 应为 0–3")
			}
			q.Set("status", strconv.Itoa(*input.Status))
		}
		var out map[string]any
		if err := c.get(ctx, "/tasks?"+q.Encode(), &out); err != nil {
			return nil, nil, err
		}
		return nil, out, nil
	})
	mcp.AddTool(server, &mcp.Tool{Name: "get_balance", Description: "查询当前 Key 对应主站账号的积分余额，不扣费。", Annotations: read}, func(ctx context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, *Identity, error) {
		credentials, _ := ctx.Value(credentialsKey{}).(Credentials)
		if credentials.Identity != nil {
			return nil, credentials.Identity, nil
		}
		identity, err := c.Identity(ctx)
		return nil, identity, err
	})
	return server
}
