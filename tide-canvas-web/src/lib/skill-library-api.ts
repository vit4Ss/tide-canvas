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
  const credentials = apiKey
    ? `本次安装附带我的主站 API Key：${JSON.stringify(apiKey)}。使用当前客户端支持的安全凭据存储或连接请求头设置，把它配置为该连接的 Authorization: Bearer <这把密钥>。仅替换本技能连接的旧鉴权，并按当前客户端的优先级处理冲突，不套用其他软件的字段格式。不要输出或复述密钥，不要将它写入 SKILL.md、references/connection.json、项目仓库或公开链接。`
    : `没有附带新密钥时，优先保留本技能现有的鉴权配置；没有配置时，可以使用本地 FLOWLIGHT_API_KEY，但须确认当前客户端支持读取此环境变量。不要覆盖已有有效鉴权，不输出密钥，也不要将它写进 SKILL.md 或来源记录。缺少密钥时先完成可完成的安装，再指导我去 ${source.origin}/account 获取自己的 API Key；此 MCP 不使用 OAuth 登录。`;
  return `请在当前承接这条请求的智能体客户端中安装这个 FlowLight Skill，并接入它的 MCP：
${source.href}

1. 先确认当前客户端和能力：依据会话明确的宿主身份、可用管理工具和当前应用设置识别客户端，不按模型名称、机器上安装了哪个 CLI 或文档里的品牌示例判断。分别确认是否支持 Agent Skills，以及带 Bearer 鉴权的远程 MCP Streamable HTTP；不要把仅支持本地进程的 MCP 等同于支持远程 HTTP。若运行在桌面外壳或嵌入式宿主中，优先使用该宿主提供的 Skill/MCP 管理入口。仅操作当前客户端，不修改其他智能体的配置；不能确认时先询问客户端名称，不猜路径。
2. 下载上述链接的 SKILL.md，确认请求成功、内容为 Markdown，且 YAML 元数据包含 name: ${name} 和 description；不要把 HTML 页面或 JSON 错误保存为 Skill。
3. 当前客户端支持 Agent Skills 时，使用它的实际技能安装接口或已确认的个人 Skill 目录，安装为 ${name}/SKILL.md，不固定任何软件的目录。已有同名文件时核对来源，仅更新同一来源的内容并保留本地修改备份；版本号相同也要比较文档内容，避免继续使用旧安装规则。只支持远程 MCP 时跳过本地 Skill 目录创建，完成第5—7步后再报告实际连接状态，不提前报告“已接入”。只支持 Skill、不支持本服务的远程 MCP 时，可以安装说明文件，但应明确报告当前客户端无法执行此云端技能，不继续尝试其他软件的 MCP 配置。两者都不支持时说明限制，不创建无效配置。
4. 仅在确实创建了本地技能目录时，才在该目录创建 references/connection.json，内容为：
${JSON.stringify({ sourceUrl: source.href, metadataUrl }, null, 2)}
没有本地技能目录时不要求这个文件，直接使用本次指令中的来源链接和元数据地址；宿主支持附属资料时可保存同样的公开来源信息，不保存密钥。
5. 仅在当前客户端支持本服务的远程 MCP 时执行接入。读取 ${metadataUrl}，确认响应成功且 data.id 为字符串 "${id}"，从 data.mcpEndpoint 取得有效 HTTP/HTTPS 地址。元数据读取失败、data.mcpAvailable 不为 true 或地址缺失时停止接入，说明具体原因并保留已有文件与配置，不猜测端点或保存无效连接。需要接入的统一参数是：连接标识 ${server}、传输协议 MCP Streamable HTTP、该远程地址、Authorization: Bearer 请求头。优先使用当前客户端的 MCP/扩展/连接器管理工具；没有管理工具时，先检查当前客户端自身的帮助或配置格式，再备份并只合并这一条连接。保留其他 MCP 配置。连接已存在且地址一致时复用；只有明确确认连接不存在时才新增；读取失败不能当成未安装。用户显式停用的连接保持停用。不要因本机存在某个 CLI 就为另一个客户端安装，安装远程连接不需要部署本地 FlowLight 服务端。
6. 仅为已确认的当前客户端 MCP 连接设置鉴权；没有可配置的连接时不要保存密钥。${credentials}
7. 使用当前客户端的刷新或重新连接能力加载工具；具备已启用密钥且 data.mcpAvailable 为 true 时，只调用 get_skill_info 检查连接，并确认工具属于连接 ${server}，返回 id 为 ${id}、enabled 为 true 后才能报告“连接验证通过”。其他 Skill 的同名工具、只列出工具或仅写入配置都不算验证通过。不要运行 run_skill 或发起付费任务。无法热加载时明确提示需重新连接或开启新会话，不要把写入配置当成已连通。若本地 Skill 确已安装但 MCP 地址或密钥缺失，报告“Skill 已安装，MCP 待连接”；只支持 MCP 的客户端报告“MCP 待连接”，验证通过后才报告“已接入 MCP，当前客户端不支持本地 Skill”。未写入技能时不能报告已安装。
8. 每次使用 Skill 时，若专属 MCP 不存在，按 SKILL.md 的自动接入步骤在当前客户端补齐；连接失败最多自动修复一次。最终报告当前客户端名称、实际安装路径或接入入口、连接标识和验证状态，并给出该客户端实际支持的调用方式；不统一套用某个客户端的命令。`;
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
