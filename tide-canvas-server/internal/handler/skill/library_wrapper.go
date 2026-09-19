package skill

import (
	"encoding/json"
	"fmt"
	"strings"
)

// Generated exclusively from public catalogue fields. Original SKILL.md,
// manifest, references, internal prompts and user credentials are never read.
func publicWrapperDocument(skill librarySkillVO) string {
	description := "使用 FlowLight 的「" + skill.Title + "」远程技能。" + skill.Description + " 用户希望使用此能力时调用对应 MCP。"
	runes := []rune(description)
	if len(runes) > 1024 {
		description = string(runes[:1024])
	}
	yamlString := func(v string) string { b, _ := json.Marshal(v); return string(b) }
	serverName := "flowlight_skill_" + skill.ID.String()
	return fmt.Sprintf(`---
name: %s
description: %s
compatibility: 需要支持远程 HTTP MCP 的 AI 客户端、网络访问和用户自己的 FlowLight API Key。
metadata:
  author: FlowLight
  skill-id: %s
  server-version: %s
---

# %s

这是公开的调用版 Skill。实际技能在 FlowLight 服务端执行；本文件说明如何调用，不包含私有实现。

## 安装与连接

将本文件保存在当前 AI 客户端支持的 Skill 目录下，目录名必须为 %s，主文件名必须为 SKILL.md。
配置名为 %s 的 Streamable HTTP MCP 服务器，地址为：

%s

需要 Authorization: Bearer <用户自己的主站 API Key>。优先从本地环境变量 FLOWLIGHT_API_KEY 读取，不要将真实密钥写入这个可分享的 Skill 文件、聊天消息或安装链接。
没有密钥时，请用户在主站个人中心获取并在本地配置。此服务使用 API Key，不使用 MCP OAuth 登录。

Codex 的 config.toml 配置示例（保留已有配置，添加独立配置段）：

~~~toml
[mcp_servers.%s]
url = %s
bearer_token_env_var = "FLOWLIGHT_API_KEY"
startup_timeout_sec = 30
tool_timeout_sec = 90
~~~

其他客户端配置同一个 URL 和 Authorization 请求头即可。配置后重新连接 MCP，并确认能够找到下面的工具。

## 执行步骤

1. 调用此 MCP 的 get_skill_info，读取当前公开说明、inputSchema 和输出类型；只使用这个服务器下的工具。
2. 按要求收集用户需求和参数。需要素材时，使用用户在主站上传且拥有访问权限的文件 ID 与 URL；远程 MCP 不能读取本机文件路径，不要把本地路径或 base64 当作素材 URL。
3. 调用 get_balance 查询用户主站积分。执行和继续生成按主站模型规则计费，多步骤技能可能调用多次模型；应基于用户明确的任务意图调用，不能承诺固定费用或失败后全流程免费。
4. 调用 run_skill，传入 clientRequestId 和 input。input 包含 prompt、assets、parameters；字段和值遵守 get_skill_info 返回的要求。为新任务生成唯一 clientRequestId；超时、网络错误或结果不确定时，使用同一个编号和原参数重试，不要擅自换编号重复生成。
5. 保存返回的 id，以字符串原样作为 runId 调用 get_skill_run。queued/running 表示还未完成，间隔 5–10 秒查询，不要高频轮询或提前声称完成。
6. waiting_confirmation/waiting_input 时，向用户展示 pendingAction 和可见草稿。获得用户决定后调用 respond_skill_run，提供 runId、action、最新 expectedRevision、独立 clientRequestId，以及所需 input/feedback/message。action 可为 confirm、revise、submit_input、retry、cancel；重试同一操作保持原编号和参数。
7. succeeded 时展示最终 artifacts 的文本或文件链接。failed/cancelled 时停止轮询并如实说明；重试或改方案须遵循用户要求。只查询该用户在这个技能下的任务。

## 调用边界

不要索取或尝试下载服务端的原始 Skill、系统提示词、私有参考文件或内部工作流。
不要在 MCP 无法连接、鉴权失败、积分不足或工具报错时假装已执行；说明当前问题并让用户处理后继续。
本地 Skill 只提供调用说明，更新后的服务端技能由主站管理，已启动的任务固定使用启动时版本。
`, skill.SkillName, yamlString(description), yamlString(skill.ID.String()), yamlString(fmt.Sprint(skill.Version)),
		strings.ReplaceAll(strings.ReplaceAll(skill.Title, "\n", " "), "\r", " "), skill.SkillName, serverName, skill.MCPEndpoint, serverName, yamlString(skill.MCPEndpoint))
}
