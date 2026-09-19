package bridge

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const policyTTL = 5 * time.Second
const serverVersion = "1.1.0"

type policyContextKey struct{}

type Policy struct {
	Enabled             bool     `json:"enabled"`
	ImageEnabled        bool     `json:"imageEnabled"`
	VideoEnabled        bool     `json:"videoEnabled"`
	AudioEnabled        bool     `json:"audioEnabled"`
	PublicURL           string   `json:"publicUrl"`
	AllowedOrigins      []string `json:"allowedOrigins"`
	PollIntervalSeconds int      `json:"pollIntervalSeconds"`
	SchemaVersion       int      `json:"schemaVersion"`
	Revision            uint64   `json:"revision"`
	Configured          bool     `json:"configured"`
}

type policyFlight struct {
	done   chan struct{}
	policy Policy
	err    error
}

func (c *Client) Policy(ctx context.Context) (Policy, error) {
	if err := ctx.Err(); err != nil {
		return Policy{}, err
	}
	c.policyMu.Lock()
	if time.Now().Before(c.policyExpires) {
		policy, err := c.policy, c.policyErr
		c.policyMu.Unlock()
		if err != nil {
			return Policy{}, err
		}
		return policy, nil
	}
	flight := c.policyFlight
	if flight == nil {
		flight = &policyFlight{done: make(chan struct{})}
		c.policyFlight = flight
		previous := c.policy
		go c.refreshPolicy(flight, previous)
	}
	c.policyMu.Unlock()
	select {
	case <-ctx.Done():
		return Policy{}, ctx.Err()
	case <-flight.done:
		return flight.policy, flight.err
	}
}

func (c *Client) refreshPolicy(flight *policyFlight, previous Policy) {
	started := time.Now()
	// The shared read belongs to the service, not its first caller. Each waiter
	// can cancel immediately; one disconnected client cannot cancel everyone.
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	policy, err := c.fetchPolicy(ctx, previous)
	c.policyMu.Lock()
	if err == nil {
		c.policy = policy
		c.policyExpires = started.Add(policyTTL)
	} else {
		c.policyExpires = time.Now().Add(time.Second)
	}
	c.policyErr = err
	c.policyFlight = nil
	flight.policy = policy
	flight.err = err
	close(flight.done)
	c.policyMu.Unlock()
}

func (c *Client) fetchPolicy(ctx context.Context, previous Policy) (Policy, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base+"/api/mcp/config", nil)
	if err != nil {
		return Policy{}, errors.New("无法创建 MCP 配置请求")
	}
	// Global public policy, no API key needed or sent. Key checks remain live
	// for each authenticated request and are never cached here.
	res, err := c.http.Do(req)
	if err != nil {
		return Policy{}, errors.New("暂时无法读取主站 MCP 配置，请稍后重试")
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusNotFound {
		return Policy{}, errors.New("主站 MCP 配置接口不可用，请更新主站并确认所有实例版本一致")
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, (64<<10)+1))
	if err != nil || len(data) > 64<<10 || res.StatusCode != 200 {
		return Policy{}, errors.New("主站 MCP 配置暂不可用，请稍后重试")
	}
	var body struct {
		Success bool `json:"success"`
		Data    struct {
			*Policy
			Enabled      *bool `json:"enabled"`
			ImageEnabled *bool `json:"imageEnabled"`
			VideoEnabled *bool `json:"videoEnabled"`
			AudioEnabled *bool `json:"audioEnabled"`
		} `json:"data"`
	}
	policy := Policy{}
	body.Data.Policy = &policy
	if json.Unmarshal(data, &body) != nil || !body.Success || body.Data.Policy == nil || body.Data.Enabled == nil || body.Data.ImageEnabled == nil || body.Data.VideoEnabled == nil || body.Data.AudioEnabled == nil || policy.SchemaVersion != 1 || policy.PollIntervalSeconds < 3 || policy.PollIntervalSeconds > 60 {
		return Policy{}, errors.New("主站 MCP 配置格式不兼容，请升级主站与 MCP 服务")
	}
	policy.Enabled = *body.Data.Enabled
	policy.ImageEnabled = *body.Data.ImageEnabled
	policy.VideoEnabled = *body.Data.VideoEnabled
	policy.AudioEnabled = *body.Data.AudioEnabled
	if policy.Configured != (policy.Revision > 0) || policy.Revision < previous.Revision {
		return Policy{}, errors.New("主站 MCP 配置版本不一致，请稍后重试")
	}
	return policy, nil
}

func (p Policy) allows(name string) bool {
	if !p.Enabled {
		return false
	}
	switch name {
	case "generate_image":
		return p.ImageEnabled
	case "generate_video":
		return p.VideoEnabled
	case "generate_audio":
		return p.AudioEnabled
	default:
		return true
	}
}

func (c *Client) policyMiddleware(next mcp.MethodHandler) mcp.MethodHandler {
	return func(ctx context.Context, method string, req mcp.Request) (mcp.Result, error) {
		if method != "tools/list" && method != "tools/call" {
			return next(ctx, method, req)
		}
		policy, err := c.Policy(ctx)
		if err != nil || !policy.Enabled {
			message := "MCP 接入已被管理员停用"
			if err != nil {
				message = err.Error()
			}
			if method == "tools/call" {
				return &mcp.CallToolResult{IsError: true, Content: []mcp.Content{&mcp.TextContent{Text: message}}}, nil
			}
			return nil, errors.New(message)
		}
		if call, ok := req.(*mcp.CallToolRequest); ok && call.Params != nil && !policy.allows(call.Params.Name) {
			return &mcp.CallToolResult{IsError: true, Content: []mcp.Content{&mcp.TextContent{Text: "该生成能力已被管理员关闭，请选择其他能力"}}}, nil
		}
		result, err := next(context.WithValue(ctx, policyContextKey{}, policy), method, req)
		if listed, ok := result.(*mcp.ListToolsResult); ok && err == nil {
			tools := make([]*mcp.Tool, 0, len(listed.Tools))
			for _, tool := range listed.Tools {
				if policy.allows(tool.Name) {
					tools = append(tools, tool)
				}
			}
			listed.Tools = tools
		}
		return result, err
	}
}
