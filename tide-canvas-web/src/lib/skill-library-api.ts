import { http } from "@/lib/http";
import type { LibraryPage, LibrarySkill } from "@/types/skill-library";

export const skillLibraryApi = {
  list: (query: { pageNum: number; pageSize: number; category?: string; keyword?: string }, signal?: AbortSignal) =>
    http.get<LibraryPage>("/api/skill-library", query, { signal }),
  get: (id: string, signal?: AbortSignal) =>
    http.get<LibrarySkill>(`/api/skill-library/${encodeURIComponent(id)}`, undefined, { signal, cache: "no-store" }),
};

export function skillInstallURL(skill: Pick<LibrarySkill, "id" | "installable" | "installPath">, origin: string): string {
  if (skill.installable !== true || !/^[1-9]\d{0,18}$/.test(skill.id) || skill.installPath !== `/api/skill-library/${skill.id}/SKILL.md`) return "";
  return new URL(skill.installPath, origin).href;
}

export function skillInstallPrompt(url: string, apiKey?: string): string {
  let source: URL;
  try { source = new URL(url); } catch { return ""; }
  const match = /^\/api\/skill-library\/([1-9]\d{0,18})\/SKILL\.md$/.exec(source.pathname);
  if (!match || !["https:", "http:"].includes(source.protocol) || source.username || source.password || source.search || source.hash) return "";
  const id = match[1];
  const name = `flowlight-skill-${id}`;
  const server = `flowlight_skill_${id}`;
  const metadataUrl = new URL(`/api/skill-library/${id}`, source.origin).href;
  const authOption = apiKey ? "" : " --bearer-token-env-var FLOWLIGHT_API_KEY";
  const credentials = apiKey
    ? `本次安装附带我的主站 API Key：${JSON.stringify(apiKey)}。将其用于本技能的本地 MCP 私有配置。Codex 在 mcp_servers.${server}.http_headers 中设置 Authorization 为 Bearer 加这把密钥，并移除此服务器已有的 bearer_token_env_var/env_http_headers.Authorization，避免其他旧密钥覆盖本次配置。其他客户端将其配置到本技能 MCP 的 Authorization 请求头。不要输出或复述密钥，不要将它写入 SKILL.md、references/connection.json、项目仓库或公开链接；只改本技能的本地用户级 MCP 配置。`
    : `没有附带新密钥时，优先保留本技能现有的本地鉴权配置；仅在没有配置时使用本地 FLOWLIGHT_API_KEY。不要用示例环境变量覆盖已有的 http_headers 或其他有效鉴权，不输出密钥，也不要将它写进 SKILL.md 或来源记录。两者都未配置时，先完成安装，再指导我去 ${source.origin}/account 获取自己的 API Key 并在本地配置；此 MCP 不使用 OAuth 登录。`;
  return `请直接帮我安装这个 FlowLight Skill，并配置它对应的 MCP：
${source.href}

1. 下载上述链接的 SKILL.md，确认请求成功、内容为 Markdown，且 YAML 元数据包含 name: ${name} 和 description；不要把 HTML 页面或 JSON 错误保存为 Skill。
2. 安装到当前智能体支持的个人 Skill 目录，目录名为 ${name}，文件名为 SKILL.md。Codex 默认可用 ~/.agents/skills/${name}/SKILL.md；若当前环境已指定其他受支持目录，沿用现有目录，避免重复安装。已有同名文件时核对来源，仅更新同一来源的版本并保留本地修改备份。
3. 在该技能目录创建 references/connection.json，内容为：
${JSON.stringify({ sourceUrl: source.href, metadataUrl }, null, 2)}
4. 自动检查并安装 MCP：读取 ${metadataUrl} 的 data.mcpEndpoint，使用其有效 HTTP/HTTPS 地址。先检查名为 ${server} 的连接；Codex 可执行 codex mcp get ${server} --json，将输出保留在本地检查，不输出其中的密钥。只有明确确认该连接不存在时才新增；配置解析失败或权限不足时报告具体错误，不把读取失败当成未安装。连接不存在时，直接执行 codex mcp add ${server} --url <读取到的 mcpEndpoint>${authOption}（用实际地址替换占位符，按当前 shell 正确传参），并完成下一步鉴权配置。连接已存在且地址一致时复用；同一技能地址更新时只更新此连接，保留其他 MCP 配置。已被用户显式停用的连接保持停用并说明情况。若没有 Codex CLI 但能访问其用户级 config.toml，则备份后只合并 mcp_servers.${server} 配置段；其他智能体使用其受支持的远程 MCP 配置方式自动添加。这里接入的是远程服务，无需在用户机器安装或运行 FlowLight 服务端。不要只返回命令让用户自己执行；有权限时直接完成，受客户端权限限制时如实说明。
5. ${credentials}
6. 若 MCP 地址缺失、服务暂不可用或密钥缺失，保留已安装的 Skill，并明确告知“Skill 已安装，MCP 待连接”。验证本地文件和 MCP 配置；具备已启用密钥且 data.mcpAvailable 为 true 时，只调用 get_skill_info 检查连接，不要运行 run_skill 或发起付费任务。
7. 配置完成后尝试客户端支持的 MCP 重新连接，再验证 get_skill_info。若当前客户端不支持热加载，明确说明“MCP 已配置，需重新连接或开启新会话后使用”，不要把写入配置当成已连通。每次使用 Skill 时，若专属 MCP 不存在，按 SKILL.md 的自动接入步骤补齐；连接失败最多自动修复一次，仍失败则报告具体原因，不能重复安装或发起付费测试。完成后告诉我实际安装路径、MCP 配置名称及连接状态。Codex 中可通过 $${name} 使用。`;
}

export function skillCodexConfig(skill: Pick<LibrarySkill, "id" | "mcpEndpoint">, apiKey?: string): string {
  const auth = apiKey ? `http_headers = { Authorization = ${JSON.stringify(`Bearer ${apiKey}`)} }` : 'bearer_token_env_var = "FLOWLIGHT_API_KEY"';
  return `[mcp_servers.flowlight_skill_${skill.id}]\nurl = ${JSON.stringify(skill.mcpEndpoint || "")}\n${auth}\nstartup_timeout_sec = 30\ntool_timeout_sec = 90`;
}

export function skillMCPConfig(skill: Pick<LibrarySkill, "id" | "mcpEndpoint">, apiKey?: string): string {
  return JSON.stringify({ mcpServers: { [`flowlight_skill_${skill.id}`]: {
    type: "http", url: skill.mcpEndpoint, headers: { Authorization: `Bearer ${apiKey || "在本地填写你的主站APIKey"}` },
  } } }, null, 2);
}

export const LIBRARY_OUTPUT_LABELS: Record<string, string> = { text: "文本", image: "图片", video: "视频", audio: "音频", file: "文件" };
