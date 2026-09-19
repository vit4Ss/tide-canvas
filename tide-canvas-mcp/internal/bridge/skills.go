package bridge

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type skillContextKey struct{}

type SkillDescriptor struct {
	Enabled     bool           `json:"enabled"`
	ID          string         `json:"id"`
	Title       string         `json:"title"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"inputSchema"`
	OutputTypes []string       `json:"outputTypes"`
	VersionID   string         `json:"versionId"`
}

type SkillAsset struct {
	ID      string `json:"id,omitempty" jsonschema:"通过主站上传后返回的文件 ID"`
	Type    string `json:"type" jsonschema:"image、video、audio、file 或 text"`
	URL     string `json:"url,omitempty" jsonschema:"主站上传后返回的素材 URL，不接受本地路径"`
	Content string `json:"content,omitempty" jsonschema:"文本素材内容"`
	Name    string `json:"name,omitempty"`
}

type SkillRunInput struct {
	Prompt     string         `json:"prompt,omitempty" jsonschema:"用户本次需求；是否必填遵循 get_skill_info 返回的输入规范"`
	Assets     []SkillAsset   `json:"assets,omitempty" jsonschema:"按 get_skill_info 的输入要求提供主站已上传素材"`
	Parameters map[string]any `json:"parameters,omitempty" jsonschema:"按 get_skill_info 的 inputSchema 提供输入参数"`
}

type RunSkillInput struct {
	ClientRequestID string        `json:"clientRequestId" jsonschema:"本次请求唯一编号；超时必须沿用原编号和参数，禁止自动更换编号重试"`
	Input           SkillRunInput `json:"input"`
}

type SkillRunQuery struct {
	RunID string `json:"runId" jsonschema:"run_skill 返回的 id，原样保留为字符串"`
}

type SkillArtifact struct {
	Type    string `json:"type"`
	Title   string `json:"title,omitempty"`
	URL     string `json:"url,omitempty"`
	Text    string `json:"text,omitempty"`
	IsFinal bool   `json:"isFinal"`
}

type SkillPendingAction struct {
	Type    string         `json:"type"`
	Title   string         `json:"title,omitempty"`
	Message string         `json:"message,omitempty"`
	Schema  map[string]any `json:"schema,omitempty"`
}

type SkillRunOutput struct {
	ID            string              `json:"id"`
	SkillID       string              `json:"skillId"`
	Status        string              `json:"status"`
	Progress      int                 `json:"progress"`
	Revision      int64               `json:"revision"`
	PointCost     int64               `json:"pointCost"`
	PendingAction *SkillPendingAction `json:"pendingAction,omitempty"`
	Artifacts     []SkillArtifact     `json:"artifacts"`
	ErrorMessage  string              `json:"errorMessage,omitempty"`
	CreateTime    string              `json:"createTime,omitempty"`
}

type SkillActionInput struct {
	RunID            string         `json:"runId"`
	Action           string         `json:"action" jsonschema:"confirm、revise、submit_input、retry 或 cancel；涉及修改和重新执行需要用户明确要求"`
	ExpectedRevision int64          `json:"expectedRevision" jsonschema:"最近查询返回的 revision；状态变化时先重新查询"`
	ClientRequestID  string         `json:"clientRequestId" jsonschema:"操作唯一编号，重试同一操作沿用原编号"`
	Input            map[string]any `json:"input,omitempty" jsonschema:"按 pendingAction.schema 填写的用户补充输入"`
	Feedback         string         `json:"feedback,omitempty" jsonschema:"用户修改意见"`
	Message          string         `json:"message,omitempty" jsonschema:"用户补充消息"`
}

// Each endpoint has its own immutable skill binding. No client-controlled skill
// ID is accepted by tools, and no per-user server or credential cache is kept.
func NewSkillServer(c *Client, skill SkillDescriptor) *mcp.Server {
	instructions := "这是技能「" + skill.Title + "」的专属服务。先 get_skill_info 了解输入要求，使用用户自己的主站 API Key。run_skill 和继续执行按主站模型规则消耗积分。长任务用 get_skill_run 查询；等待确认/输入时向用户展示待办和草稿，用 respond_skill_run 提交用户选择。相同请求重试沿用 clientRequestId 和参数，避免重复扣费。不要索取或声称获得服务端 Skill 源码。"
	if !skill.Enabled {
		instructions = "此技能已停止接收新任务。当前仅可 get_skill_run 查询本账号已受理的任务，或使用 respond_skill_run 的 cancel 操作取消它们；不能继续、重试或新建任务。get_balance 可查询本账号积分。任务 ID 和 revision 请使用已有任务返回的值。"
	}
	server := mcp.NewServer(&mcp.Implementation{Name: "flowlight-skill-" + skill.ID, Version: serverVersion}, &mcp.ServerOptions{
		Instructions: instructions,
		SetCacheable: func(_ context.Context, _ mcp.Request, cache *mcp.Cacheable) { cache.CacheScope = "private" },
	})
	server.AddReceivingMiddleware(c.policyMiddleware)
	if !skill.Enabled {
		server.AddReceivingMiddleware(func(next mcp.MethodHandler) mcp.MethodHandler {
			return func(ctx context.Context, method string, request mcp.Request) (mcp.Result, error) {
				result, err := next(ctx, method, request)
				if method == "tools/list" && err == nil {
					if listed, ok := result.(*mcp.ListToolsResult); ok && listed != nil {
						visible := make([]*mcp.Tool, 0, len(listed.Tools))
						for _, tool := range listed.Tools {
							if tool.Name != "run_skill" {
								visible = append(visible, tool)
							}
						}
						listed.Tools = visible
					}
				}
				return result, err
			}
		})
	}
	no, yes := false, true
	read := &mcp.ToolAnnotations{ReadOnlyHint: true, DestructiveHint: &no, IdempotentHint: true, OpenWorldHint: &yes}
	paid := &mcp.ToolAnnotations{ReadOnlyHint: false, DestructiveHint: &yes, IdempotentHint: true, OpenWorldHint: &yes}
	base := "/api/open/v1/mcp/skills/" + skill.ID
	mcp.AddTool(server, &mcp.Tool{Name: "get_skill_info", Description: "查看当前技能的公开说明、输入要求和输出类型。" + skill.Description, Annotations: read}, func(ctx context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, SkillDescriptor, error) {
		return nil, skill, nil
	})
	mcp.AddTool(server, &mcp.Tool{Name: "run_skill", Description: "运行「" + skill.Title + "」。服务端执行已发布 Skill，按主站模型计费；返回异步任务。先 get_skill_info 检查输入。", Annotations: paid}, func(ctx context.Context, _ *mcp.CallToolRequest, input RunSkillInput) (*mcp.CallToolResult, SkillRunOutput, error) {
		if !skill.Enabled {
			return nil, SkillRunOutput{}, errors.New("此技能已停止接收新任务，仅可查询或取消已受理任务")
		}
		if !requestIDPattern.MatchString(input.ClientRequestID) {
			return nil, SkillRunOutput{}, errors.New("请提供有效 clientRequestId，超时重试必须沿用原编号")
		}
		return skillRequest(ctx, c, "POST", base+"/runs", skill.ID, "", input)
	})
	mcp.AddTool(server, &mcp.Tool{Name: "get_skill_run", Description: "查询当前技能下自己的任务、积分消耗、最终产物及待确认内容；不重复生成和扣费。queued/running 可继续轮询；waiting_confirmation/waiting_input 需要用户回复。", Annotations: read}, func(ctx context.Context, _ *mcp.CallToolRequest, input SkillRunQuery) (*mcp.CallToolResult, SkillRunOutput, error) {
		if !validTaskID(input.RunID) {
			return nil, SkillRunOutput{}, errors.New("runId 必须为主站返回的任务 ID 字符串")
		}
		return skillRequest(ctx, c, "GET", base+"/runs/"+input.RunID, skill.ID, input.RunID, nil)
	})
	mcp.AddTool(server, &mcp.Tool{Name: "respond_skill_run", Description: "提交用户确认、修改意见、补充输入、重试或取消。继续/重试可能产生模型费用；必须沿用返回的 revision，重试同一操作不换 clientRequestId。", Annotations: paid}, func(ctx context.Context, _ *mcp.CallToolRequest, input SkillActionInput) (*mcp.CallToolResult, SkillRunOutput, error) {
		if !skill.Enabled && input.Action != "cancel" {
			return nil, SkillRunOutput{}, errors.New("此技能已停止接收新任务，当前只允许取消已受理任务")
		}
		if !validTaskID(input.RunID) || !requestIDPattern.MatchString(input.ClientRequestID) || input.ExpectedRevision < 0 {
			return nil, SkillRunOutput{}, errors.New("runId、expectedRevision 或 clientRequestId 不正确")
		}
		body := map[string]any{"action": input.Action, "expectedRevision": input.ExpectedRevision, "clientRequestId": input.ClientRequestID, "input": input.Input, "feedback": input.Feedback, "message": input.Message}
		return skillRequest(ctx, c, "POST", base+"/runs/"+input.RunID+"/actions", skill.ID, input.RunID, body)
	})
	mcp.AddTool(server, &mcp.Tool{Name: "get_balance", Description: "查询当前 API Key 对应账号积分，不扣费。", Annotations: read}, func(ctx context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, *Identity, error) {
		identity, err := c.Identity(ctx)
		return nil, identity, err
	})
	return server
}

func skillRequest(ctx context.Context, c *Client, method, path, skillID, runID string, input any) (*mcp.CallToolResult, SkillRunOutput, error) {
	var raw json.RawMessage
	err := c.request(ctx, method, path, input, true, &raw)
	var out SkillRunOutput
	if err == nil {
		out, err = parseSkillRun(raw, skillID, runID)
	}
	if err != nil {
		if method == "POST" {
			return nil, SkillRunOutput{}, errors.New(err.Error() + "；提交结果未确认时，请沿用原 clientRequestId 和原参数重试，不要换新编号")
		}
		return nil, SkillRunOutput{}, err
	}
	return nil, out, nil
}

func parseSkillRun(raw json.RawMessage, skillID, runID string) (SkillRunOutput, error) {
	var required struct {
		ID        *string `json:"id"`
		SkillID   *string `json:"skillId"`
		Status    *string `json:"status"`
		Revision  *int64  `json:"revision"`
		Progress  *int    `json:"progress"`
		PointCost *int64  `json:"pointCost"`
	}
	if json.Unmarshal(raw, &required) != nil || required.ID == nil || !validTaskID(*required.ID) || required.SkillID == nil || *required.SkillID != skillID ||
		(runID != "" && *required.ID != runID) || required.Status == nil || required.Revision == nil || *required.Revision < 0 ||
		required.Progress == nil || *required.Progress < 0 || *required.Progress > 100 || required.PointCost == nil || *required.PointCost < 0 {
		return SkillRunOutput{}, errors.New("主站返回的技能任务数据不完整或任务不匹配，请稍后查询原任务")
	}
	switch *required.Status {
	case "queued", "running", "waiting_input", "waiting_confirmation", "succeeded", "failed", "cancelled":
	default:
		return SkillRunOutput{}, errors.New("主站返回了未知的技能任务状态，请稍后查询原任务")
	}
	var out SkillRunOutput
	if err := json.Unmarshal(raw, &out); err != nil {
		return SkillRunOutput{}, errors.New("主站技能任务响应格式不兼容")
	}
	if out.Status == "waiting_input" || out.Status == "waiting_confirmation" {
		want := "input"
		if out.Status == "waiting_confirmation" {
			want = "confirmation"
		}
		if out.PendingAction == nil || out.PendingAction.Type != want {
			return SkillRunOutput{}, errors.New("技能等待用户操作，但返回的交互信息不完整，请重新查询任务")
		}
	}
	if out.Artifacts == nil {
		out.Artifacts = []SkillArtifact{}
	}
	if out.Status == "succeeded" {
		hasResult := false
		for _, artifact := range out.Artifacts {
			if artifact.IsFinal && (strings.TrimSpace(artifact.Text) != "" || strings.TrimSpace(artifact.URL) != "") {
				hasResult = true
				break
			}
		}
		if !hasResult {
			return SkillRunOutput{}, errors.New("主站任务标记成功但未提供最终结果，请稍后查询原任务，不要重新提交生成")
		}
	}
	return out, nil
}
