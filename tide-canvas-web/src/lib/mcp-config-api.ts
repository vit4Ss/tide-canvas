import { http } from "./http";

export interface MCPSettings {
  enabled: boolean;
  imageEnabled: boolean;
  videoEnabled: boolean;
  audioEnabled: boolean;
  publicUrl: string;
  allowedOrigins: string[];
  pollIntervalSeconds: number;
}
export interface MCPConfig extends MCPSettings {
  schemaVersion: number;
  revision: number;
  configured: boolean;
  updatedAt?: string;
}
export interface MCPStatus {
  reachable: boolean;
  checkedAt: string;
  latencyMs: number;
  message: string;
  version?: string;
  adminConfig: boolean;
  policyAvailable: boolean;
  policyRevision: number;
  internalUrl: string;
}
export const mcpConfigApi = {
  publicConfig: () => http.get<MCPConfig>("/api/mcp/config"),
  get: (signal?: AbortSignal) => http.get<MCPConfig>("/api/admin/mcp", undefined, { signal }),
  save: (data: MCPSettings & { revision: number }, signal?: AbortSignal) => http.put<MCPConfig>("/api/admin/mcp", data, { signal }),
  status: (signal?: AbortSignal) => http.get<MCPStatus>("/api/admin/mcp/status", undefined, { signal }),
};

export function mcpClientConfig(publicUrl: string, origin: string) {
  return {
    mcpServers: {
      "flowlight-generation": {
        type: "http", url: publicUrl.trim() || `${origin}/mcp`,
        headers: { Authorization: "Bearer 你的主站APIKey" },
      },
    },
  };
}

export function mcpServiceState(status: MCPStatus | null, revision: number) {
  if (!status) return { label: "未检测", tone: "neutral" };
  if (!status.reachable) return { label: "未连接", tone: "error" };
  if (!status.adminConfig) return { label: "需要升级服务", tone: "warning" };
  if (!status.policyAvailable) return { label: "配置尚未读取", tone: "warning" };
  if (status.policyRevision !== revision) return { label: "等待配置同步", tone: "warning" };
  return { label: "配置已同步", tone: "success" };
}
