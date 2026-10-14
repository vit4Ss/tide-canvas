export type AgentClient = "codex" | "opencode";
export type AgentShell = "posix" | "powershell" | "cmd";
export interface AgentModel { id: string; name: string }

export function gatewayBase(origin: string): string {
  const url = new URL(origin);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("Invalid site origin");
  return `${url.origin}/api/integrations/v1`;
}
function validModel(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256 && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
}
export function agentModels(value: unknown): AgentModel[] {
  if (!value || typeof value !== "object" || !("data" in value) || !Array.isArray(value.data)) throw new Error("模型列表格式不正确，请重试");
  const seen = new Set<string>();
  return value.data.flatMap((row: unknown) => {
    if (!row || typeof row !== "object" || !("id" in row) || !validModel(row.id) || seen.has(row.id)) return [];
    seen.add(row.id);
    return [{ id: row.id, name: "name" in row && typeof row.name === "string" && row.name.trim() ? row.name.trim() : row.id }];
  });
}
function validate(client: AgentClient, origin: string, model: string, secret?: string) {
  if (client !== "codex" && client !== "opencode") throw new Error("Unsupported client");
  if (!validModel(model)) throw new Error("Choose an available model");
  // Account keys are base64url; reject metacharacters rather than producing
  // an executable shell fragment from a malformed credential response.
  if (secret !== undefined && !/^tc_sk_[A-Za-z0-9_-]+$/.test(secret)) throw new Error("密钥格式不正确，请重新读取");
  return gatewayBase(origin);
}
export function agentConfig(client: AgentClient, origin: string, model: string): string {
  const base = validate(client, origin, model);
  if (client === "codex") return `model = ${JSON.stringify(model)}\nmodel_provider = "flowlight"\n\n[model_providers.flowlight]\nname = "FlowLight"\nbase_url = ${JSON.stringify(base)}\nenv_key = "FLOWLIGHT_API_KEY"\nwire_api = "responses"`;
  return JSON.stringify({ $schema: "https://opencode.ai/config.json", model: `flowlight/${model}`, provider: {
    flowlight: { npm: "@ai-sdk/openai-compatible", name: "FlowLight", options: { baseURL: base, apiKey: "{env:FLOWLIGHT_API_KEY}" }, models: { [model]: { name: model } } },
  } }, null, 2);
}
export function agentTerminal(client: AgentClient, shell: AgentShell, secret: string): string {
  validate(client, "https://example.test", "model", secret);
  if (shell === "posix") return `export FLOWLIGHT_API_KEY='${secret}'\n${client}`;
  if (shell === "powershell") return `$env:FLOWLIGHT_API_KEY = '${secret}'\n${client}`;
  if (shell === "cmd") return `set "FLOWLIGHT_API_KEY=${secret}"\n${client}`;
  throw new Error("Unsupported shell");
}
export function agentConfigPath(client: AgentClient, shell: AgentShell): string {
  const home = shell === "cmd" ? "%USERPROFILE%" : shell === "powershell" ? "$HOME" : "~";
  const path = client === "codex" ? ".codex/config.toml" : ".config/opencode/opencode.json";
  return shell === "posix" ? `${home}/${path}` : `${home}\\${path.replaceAll("/", "\\")}`;
}

// CC Switch's official provider-import protocol. Construct only in response to
// a user action. Never send this URL to an online generator, logs or storage.
export function ccSwitchLink(client: AgentClient, origin: string, model: string, secret: string): string {
  const endpoint = validate(client, origin, model, secret);
  const params = new URLSearchParams({ resource: "provider", app: client, name: "FlowLight", endpoint,
    apiKey: secret, model, homepage: new URL(origin).origin, apiFormat: client === "codex" ? "openai_responses" : "openai_chat" });
  return `ccswitch://v1/import?${params.toString()}`;
}
