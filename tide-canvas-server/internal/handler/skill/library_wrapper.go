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
	connection := "MCP 地址尚待配置。先安装 Skill 并记录来源；使用前按下面的发现流程读取专属地址。不要保存空 URL 或猜测地址。"
	if skill.MCPEndpoint != "" {
		connection = fmt.Sprintf(`当前专属 MCP 地址：%s

以下是未配置鉴权时的 Codex 示例；已有有效鉴权时保留原配置，不能直接覆盖。只新增或更新本技能的配置段：

~~~toml
[mcp_servers.%s]
url = %s
bearer_token_env_var = "FLOWLIGHT_API_KEY"
startup_timeout_sec = 30
tool_timeout_sec = 90
~~~`, skill.MCPEndpoint, serverName, yamlString(skill.MCPEndpoint))
	}
	bootstrap := fmt.Sprintf(`## 自动接入 MCP

首次安装以及每次使用本 Skill 时，先确认名为 %s 的专属 MCP 是否已配置并能提供 get_skill_info。缺少连接时，在当前客户端允许的权限内自动完成接入，然后继续用户任务。

1. 读取 references/connection.json 中的 metadataUrl，获取最新 data.mcpEndpoint；同时检查 data.mcpAvailable。地址缺失、技能关闭或服务暂不可用时保留已安装的文件并说明待连接，不猜测地址。
2. Codex 使用 codex mcp get %s --json 检查现有连接。将结果留在本地检查名称、URL 和启用状态，不在回复中输出完整请求头。只有明确确认该连接不存在时才新增；配置解析失败或权限不足时报告具体错误，不把读取失败当成未安装。配置存在且地址一致则复用；用户显式停用的配置保持停用。同一技能的旧地址只更新本配置段。
3. 鉴权顺序：本次安装指令明确提供的新密钥 > 本技能已有的本地鉴权 > FLOWLIGHT_API_KEY。没有新密钥时保留现有 http_headers、env_http_headers 或 bearer_token_env_var，不要用示例覆盖。连接不存在且已有本地 FLOWLIGHT_API_KEY 时，执行 codex mcp add %s --url <最新专属地址> --bearer-token-env-var FLOWLIGHT_API_KEY。如果安装指令提供的是直接密钥，则添加 URL 后将它写入本技能的本地 http_headers.Authorization，移除本技能过时的 bearer_token_env_var/env_http_headers.Authorization，避免冲突。缺少密钥时仍先建立连接配置，再说明需要配置用户自己的 Key。不要把占位符作为真实地址或密钥保存。
4. Codex CLI 不可用但允许编辑配置时，先备份用户级 config.toml，再只合并 mcp_servers.%s 配置段；保留其他 MCP、模型和账户设置。其他客户端采用其实际支持的远程 MCP 配置方式。无需安装或启动本地 FlowLight 服务端。
5. 配置后使用客户端提供的重新连接或刷新工具能力，再调用 get_skill_info 验证。客户端不能热加载时明确提示“MCP 已配置，需重新连接或开启新会话后使用”，不要声称工具已可调用。
6. 权限不足、鉴权失败或远程地址不可用时说明具体原因。自动修复最多一次，不重复安装、不重置密钥、不为检查连接运行付费生成。`, serverName, serverName, serverName, serverName)
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
安装时将下载来源记录到本地 references/connection.json，保存 sourceUrl（本文件的原始下载链接）和 metadataUrl（同一源站的 /api/skill-library/%s）；此文件只保存公开地址，不保存密钥。
只拿到本地 ZIP 且没有来源记录时，请用户提供原下载链接；不要从本机地址猜测源站。

安装 Skill 与调用 MCP 分开处理：没有 API Key 或服务暂不可用时，仍可安装本文件，说明尚待连接；不代表只能在主站使用。
配置名为 %s 的 Streamable HTTP MCP 服务器。使用前读取来源记录中的 metadataUrl：返回 404 时说明该技能已下架或关闭，停止调用；成功时读取 data.mcpEndpoint 和 data.mcpAvailable。地址未配置时保留已安装 Skill，等待配置完成后再读取，不要自动提交付费任务。

需要 Authorization: Bearer <用户自己的主站 API Key>。使用本地 MCP 私有配置中的请求头或 FLOWLIGHT_API_KEY 环境变量；安装指令附带用户自己的密钥时，用它配置本技能的本地用户级 MCP。不要将真实密钥写入这个可分享的 Skill 文件、来源记录或安装链接，不要在回复中重复输出密钥。
没有密钥时，请用户在主站个人中心获取并在本地配置。此服务使用 API Key，不使用 MCP OAuth 登录。

%s

其他客户端配置同一个 URL 和 Authorization 请求头即可。配置后重新连接 MCP，并确认能够找到下面的工具。
安装验证只检查文件与 MCP 配置；有密钥且服务可用时可调用 get_skill_info。不要为验证安装而调用 run_skill 或继续执行任务。

%s

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
		strings.ReplaceAll(strings.ReplaceAll(skill.Title, "\n", " "), "\r", " "), skill.SkillName, skill.ID.String(), serverName, connection, bootstrap)
}
