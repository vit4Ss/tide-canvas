import { http } from "@/lib/http";
import type { LibraryPage, LibrarySkill } from "@/types/skill-library";

export const skillLibraryApi = {
  list: (query: { pageNum: number; pageSize: number; category?: string; keyword?: string }, signal?: AbortSignal) =>
    http.get<LibraryPage>("/api/skill-library", query, { signal }),
  get: (id: string, signal?: AbortSignal) =>
    http.get<LibrarySkill>(`/api/skill-library/${encodeURIComponent(id)}`, undefined, { signal }),
};

export function skillInstallURL(skill: Pick<LibrarySkill, "id" | "installable" | "installPath">, origin: string): string {
  if (!skill.installable || !/^[1-9]\d{0,18}$/.test(skill.id) || skill.installPath !== `/api/skill-library/${skill.id}/SKILL.md`) return "";
  return new URL(skill.installPath, origin).href;
}

export function skillInstallPrompt(url: string): string {
  return `请读取并安装这个公开 Skill：${url}\n请按当前 AI 客户端的 Skill 规范安装，再根据文件说明连接对应 MCP。调用需要我自己的 FlowLight API Key，请指导我在本地配置 FLOWLIGHT_API_KEY，不要把真实密钥写进 Skill 文件或发到对话中。`;
}

export function skillCodexConfig(skill: Pick<LibrarySkill, "id" | "mcpEndpoint">): string {
  return `[mcp_servers.flowlight_skill_${skill.id}]\nurl = ${JSON.stringify(skill.mcpEndpoint || "")}\nbearer_token_env_var = "FLOWLIGHT_API_KEY"\nstartup_timeout_sec = 30\ntool_timeout_sec = 90`;
}

export function skillMCPConfig(skill: Pick<LibrarySkill, "id" | "mcpEndpoint">): string {
  return JSON.stringify({ mcpServers: { [`flowlight_skill_${skill.id}`]: {
    type: "http", url: skill.mcpEndpoint, headers: { Authorization: "Bearer 在本地填写你的主站APIKey" },
  } } }, null, 2);
}

export const LIBRARY_OUTPUT_LABELS: Record<string, string> = { text: "文本", image: "图片", video: "视频", audio: "音频", file: "文件" };
