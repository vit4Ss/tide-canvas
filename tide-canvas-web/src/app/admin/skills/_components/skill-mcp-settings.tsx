"use client";

import { useEffect, useId, useState } from "react";
import { Copy, Plug } from "lucide-react";
import Link from "next/link";
import { http } from "@/lib/http";
import { copyText } from "@/lib/clipboard";
import { skillMCPConfig } from "@/lib/skill-library-api";
import { toast } from "@/components/shared/toast";

export function SkillMCPSettings({ enabled, onChange, disabled, skillId, savedEnabled }: {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  disabled?: boolean;
  skillId?: string;
  savedEnabled?: boolean;
}) {
  const id = useId();
  const [baseUrl, setBaseUrl] = useState("");
  const [configState, setConfigState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    void http.get<{ publicUrl: string }>("/api/mcp/config", undefined, { signal: controller.signal }).then((result) => {
      clearTimeout(timer);
      if (!alive) return;
      if (result.success && result.data?.publicUrl) { setBaseUrl(result.data.publicUrl); setConfigState("ready"); }
      else setConfigState(result.success ? "missing" : "error");
    });
    return () => { alive = false; clearTimeout(timer); controller.abort(); };
  }, []);
  const endpoint = skillId && baseUrl ? `${baseUrl.replace(/\/+$/, "")}/skills/${encodeURIComponent(skillId)}` : "";
  const copy = async (config: boolean) => {
    if (!skillId || !endpoint) return;
    const content = config ? skillMCPConfig({ id: skillId, mcpEndpoint: endpoint }) : endpoint;
    if (await copyText(content)) toast.success(config ? "已复制 MCP 配置，请填写使用者自己的 API Key" : "已复制 MCP 地址");
    else toast.error("复制失败，请手动复制地址");
  };
  return (
    <section className="adm-skill-mcp" aria-labelledby={`${id}-title`}>
      <div className="adm-skill-mcp-heading">
        <span id={`${id}-title`}><Plug size={16} aria-hidden /> 对外开放</span>
        <label>
          <input type="checkbox" checked={enabled} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
          开放至 MCP / Skill 广场
        </label>
      </div>
      <p>默认关闭。开启且上架后才会在前台 Skill 广场展示并开放 MCP，须通过标准 Skill 格式校验。使用已发布版本在服务端执行，按调用者的主站 API Key 扣积分；核心文件不会作为工具定义下发。</p>
      {enabled && (
        <div className="adm-skill-mcp-connection">
          {configState !== "ready" && <small role={configState === "error" ? "alert" : "status"}>
            {configState === "loading" ? "正在读取 MCP 接入地址…" : configState === "error" ? "暂时无法读取 MCP 配置，请重新打开此窗口重试。" : <>尚未配置对外地址，请在 <Link href="/admin/mcp">MCP 配置</Link> 中设置；用户可先安装 Skill，配置完成后连接使用。</>}
          </small>}
          {endpoint ? <>
            <input aria-label="技能 MCP 地址" readOnly value={endpoint} onFocus={(event) => event.target.select()} />
            <div className="adm-skill-mcp-actions">
              <button className="adm-btn ghost" type="button" onClick={() => void copy(false)}><Copy size={14} aria-hidden />复制地址</button>
              <button className="adm-btn ghost" type="button" onClick={() => void copy(true)}>复制接入配置</button>
            </div>
          </> : null}
          <small>{!skillId ? "导入或创建后生成专属地址；上架后可调用。" : !savedEnabled ? "保存并上架后生效，可在「MCP 配置」中管理服务总开关。" : "上架且 MCP 总开关开启时可调用；发布新版本后，新任务使用新版本。"}</small>
        </div>
      )}
    </section>
  );
}
