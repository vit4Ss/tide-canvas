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
连接标识：%s
传输协议：MCP Streamable HTTP
鉴权请求头：Authorization: Bearer <用户自己的主站 API Key>

以上是通用连接参数。请映射到当前客户端实际支持的配置格式；已有有效鉴权时保留原配置。不要将它当成某个软件的完整配置文件覆盖写入。`, skill.MCPEndpoint, serverName)
	}
	bootstrap := fmt.Sprintf(`## 自动接入 MCP

首次安装以及每次使用本 Skill 时，先确认当前客户端，再检查标识为 %s 的专属 MCP。缺少连接时，在当前客户端允许的权限内自动接入，再继续用户任务。

1. 依据当前会话的宿主身份、管理工具和应用设置识别客户端，不根据模型名称或机器上存在的 CLI 判断。分别确认 Agent Skills 与带 Bearer 鉴权的远程 MCP Streamable HTTP 能力；不能把仅支持本地进程的 MCP 当作远程 HTTP 支持。嵌入式或桌面外壳提供 MCP 管理时，优先使用宿主入口。仅操作当前客户端，不修改其他智能体的配置；无法确认时先询问客户端名称。
2. 从已有 references/connection.json、宿主保存的来源资料或本次安装指令取得 metadataUrl，确认响应成功且 data.id 为字符串 "%s"，获取最新 data.mcpEndpoint 和 data.mcpAvailable。没有本地文件系统时不强求来源文件。所有来源信息都缺失时请用户提供原下载链接，不从本机目录或 MCP 域名反推主站地址。元数据读取失败、data.mcpAvailable 不为 true 或地址缺失时停止接入，说明具体原因并保留已有文件与配置，不猜测端点或保存无效连接。
3. 使用当前客户端的 MCP/扩展/连接器管理工具查询连接。配置存在且地址一致则复用；用户显式停用的配置保持停用。只有明确确认连接不存在时才新增，读取失败不能当成未安装。缺少管理工具时，先检查当前客户端的帮助和实际配置格式，确认其配置位置后备份，只新增或更新本技能连接，保留其他 MCP、模型和账户设置。
4. 仅为当前客户端已确认的 MCP 连接设置鉴权；没有可配置的连接时不要保存密钥。鉴权顺序：本次安装指令明确提供的新密钥 > 本技能已有的鉴权 > 当前客户端支持读取的 FLOWLIGHT_API_KEY。没有新密钥时保留已有有效鉴权。使用当前客户端的安全凭据存储或连接请求头设置 Authorization: Bearer；按照该客户端的规则处理本连接中的旧鉴权冲突，不套用其他软件的字段格式。缺少密钥时先完成可完成的安装，再说明需要用户自己的 Key，不保存占位密钥。
5. 本服务使用远程 MCP Streamable HTTP。只支持 MCP 的客户端可以接入工具，但不能报告本地 Skill 已安装；只支持 Skill、不支持远程 MCP 的客户端可安装说明文件，但应报告无法执行此云端技能，不转而修改其他软件。两者都不支持时说明能力限制。无需安装或启动本地 FlowLight 服务端。
6. 配置后使用当前客户端的刷新或重新连接能力加载工具，有有效密钥且服务允许调用时，只调用 get_skill_info 验证。核对工具属于连接 %s，返回 id 为 %s 且 enabled 为 true，才报告“连接验证通过”；其他 Skill 的同名工具不能代替验证。不能热加载时明确提示需重新连接或开启新会话，不把写入配置当成已连通，也不预设某个客户端的 Skill 调用命令。
7. 权限不足、鉴权失败或远程地址不可用时说明具体原因。自动修复最多一次，不重复安装、不重置密钥、不为检查连接运行付费生成。`, serverName, skill.ID.String(), serverName, skill.ID.String())
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

先识别当前客户端。支持 Agent Skills 时，通过其实际技能安装入口或已确认的技能目录安装本文件，目录名必须为 %s，主文件名必须为 SKILL.md；不固定任何软件的目录。不支持本地 Skill 但支持远程 MCP 时，可直接接入工具并如实报告接入状态。
存在本地技能目录时，将下载来源记录到 references/connection.json，保存 sourceUrl（本文件的原始下载链接）和 metadataUrl（同一源站的 /api/skill-library/%s）；此文件只保存公开地址，不保存密钥。使用宿主安装接口时可保存为其支持的附属资料；仅接入 MCP 且没有技能目录时不创建这个文件，使用本次安装指令中的来源地址。
只拿到本地 ZIP 且没有来源记录时，请用户提供原下载链接；不要从本机地址猜测源站。

安装 Skill 与调用 MCP 分开处理：客户端支持 Skill 安装时，没有 API Key 或服务暂不可用仍可安装说明文件，并如实说明尚待连接；只有已成功安装时才能报告“Skill 已安装”。只支持 MCP 的客户端在验证通过前报告“MCP 待连接”，不能提前报告已接入。
配置名为 %s 的 Streamable HTTP MCP 服务器。使用前读取来源记录或安装指令中的 metadataUrl：返回 404 时说明该技能已下架或关闭，停止调用；成功时读取 data.mcpEndpoint 和 data.mcpAvailable。地址未配置时保留已安装 Skill，等待配置完成后再读取，不要自动提交付费任务。

需要 Authorization: Bearer <用户自己的主站 API Key>。使用当前客户端的私有连接配置或安全凭据存储；确认客户端支持环境变量时，也可使用 FLOWLIGHT_API_KEY。安装指令附带用户自己的密钥时，仅为当前客户端的本技能连接配置它。不要将真实密钥写入这个可分享的 Skill 文件、来源记录或安装链接，不要在回复中重复输出密钥。
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
