import { copyText } from "@/lib/clipboard";
import { getAccessToken } from "@/lib/http";
import { skillCodexConfig, skillInstallPrompt, skillInstallURL, skillLibraryApi, skillMCPConfig } from "@/lib/skill-library-api";
import { userApiKeyApi } from "@/lib/user-api-key";
import { useAuthStore } from "@/stores/use-auth-store";
import type { LibrarySkill } from "@/types/skill-library";

export type SkillCopyFormat = "install" | "codex" | "mcp";

// Read a secret only for an explicit copy action. Never put it in component
// state, the public API, browser storage, previews or shareable Skill packages.
export async function copySkillSetup(skill: LibrarySkill, origin: string, format: SkillCopyFormat, signal: AbortSignal): Promise<{ includesKey: boolean; keyEnabled: boolean }> {
  const source = skillInstallURL(skill, origin);
  if (!source) throw new Error("安装配置暂不可用，请刷新后重试");
  const token = getAccessToken();
  const accountId = useAuthStore.getState().user?.id;
  if (token && !accountId) throw new Error("登录信息尚未加载，请稍后再复制");
  const assertCurrent = () => {
    if (signal.aborted) throw new Error("复制已取消或请求超时，请重试");
    if (getAccessToken() !== token || useAuthStore.getState().user?.id !== accountId) throw new Error("登录状态已变化，请重新复制");
  };
  let key = "";
  let keyEnabled = true;
  let content = "";
  try {
    assertCurrent();
    // Revalidate exposure and the endpoint before reading a private key. The
    // administrator may have changed either since this page was opened.
    const latest = await skillLibraryApi.get(skill.id, signal);
    assertCurrent();
    if (!latest.success) throw new Error(latest.message || "技能已关闭或安装配置暂不可用，请刷新后重试");
    const current = latest.data;
    if (!current || current.id !== skill.id || current.mcpEnabled !== true || skillInstallURL(current, origin) !== source) throw new Error("技能安装配置已变化，请刷新后重试");
    if (current.mcpEndpoint) {
      let endpoint: URL;
      try { endpoint = new URL(current.mcpEndpoint); } catch { throw new Error("MCP 地址格式异常，请稍后重试"); }
      if (!["https:", "http:"].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !endpoint.pathname.endsWith(`/skills/${current.id}`)) throw new Error("MCP 地址与当前技能不匹配，请稍后重试");
    } else if (format !== "install") {
      throw new Error("MCP 地址尚未配置，可以先复制安装指令");
    }
    if (token && accountId) {
      const info = await userApiKeyApi.get(accountId, signal);
      assertCurrent();
      if (!info.success || !info.data) throw new Error(info.message || "无法读取当前账号 API Key");
      if (!Number.isSafeInteger(info.data.revision) || info.data.revision < 1 || typeof info.data.enabled !== "boolean") throw new Error("密钥信息不完整，请稍后重试");
      keyEnabled = info.data.enabled;
      const revealed = await userApiKeyApi.reveal(accountId, info.data.revision, signal);
      assertCurrent();
      if (!revealed.success || !revealed.data) throw new Error(revealed.message || "无法读取当前账号 API Key");
      if (revealed.data.revision !== info.data.revision || !/^tc_sk_[A-Za-z0-9_-]{43}$/.test(revealed.data.key)) throw new Error("API Key 已变化或响应异常，请重新复制");
      key = revealed.data.key;
    }
    content = format === "install" ? skillInstallPrompt(source, key || undefined)
      : format === "codex" ? skillCodexConfig(current, key || undefined) : skillMCPConfig(current, key || undefined);
    if (key && !keyEnabled && format === "install") content += "\n附注：随附 API Key 当前已停用。先完成安装，使用前请用户在主站个人中心启用；不要自动启用、轮换密钥或发起付费验证。";
    assertCurrent();
    if (!content) throw new Error("安装指令为空，请刷新后重试");
    const copied = await copyText(content, () => { assertCurrent(); return true; });
    assertCurrent();
    if (!copied) throw new Error("复制失败，请重新点击复制按钮");
    return { includesKey: !!key, keyEnabled };
  } finally {
    key = "";
    content = "";
  }
}
