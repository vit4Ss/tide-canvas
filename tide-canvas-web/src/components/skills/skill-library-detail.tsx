"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { ArrowLeft, ArrowRight, Check, ChevronDown, Code2, Copy, Download, FileText, KeyRound, Layers3, Loader2, ShieldCheck, Sparkles, Workflow } from "lucide-react";
import { copyText } from "@/lib/clipboard";
import { LIBRARY_OUTPUT_LABELS, skillCodexConfig, skillInstallPrompt, skillInstallURL, skillLibraryApi, skillMCPConfig } from "@/lib/skill-library-api";
import { toast } from "@/components/shared/toast";
import { useAuthStore } from "@/stores/use-auth-store";
import type { LibrarySkill } from "@/types/skill-library";
import { SkillCover } from "./skill-library";
import { SkillCopyButton } from "./skill-copy-button";
import styles from "./skill-library.module.css";

function CopyAction({ value, label, primary = false }: { value: string; label: string; primary?: boolean }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(false), 2000); return () => clearTimeout(timer); }, [copied]);
  return <button className={primary ? styles.primaryButton : styles.secondaryButton} disabled={!value} onClick={async () => {
    if (await copyText(value)) { setCopied(true); toast.success("已复制"); } else toast.error("复制失败，请选中文字手动复制");
  }}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? "已复制" : label}</button>;
}

function Markdown({ text }: { text: string }) {
  return <div className={styles.markdown}><ReactMarkdown components={{ img: () => null, a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}>{text}</ReactMarkdown></div>;
}

function nativeWorkspace(skill: LibrarySkill) {
  const label = ({ "/projects": "画布", "/studio": "创作台", "/chat": "生成页" } as Record<string, string>)[skill.nativePath || ""];
  return label && skill.nativePath ? { label, href: skill.nativePath } : null;
}

function inputFields(schema?: Record<string, unknown>): Array<{ key: string; label: string; description: string; required: boolean }> {
  if (!schema) return [];
  if (Array.isArray(schema.fields)) return schema.fields.flatMap((field: unknown) => {
    if (!field || typeof field !== "object") return [];
    const f = field as Record<string, unknown>;
    if (typeof f.key !== "string") return [];
    return [{ key: f.key, label: typeof f.label === "string" ? f.label : f.key, description: typeof f.description === "string" ? f.description : "使用时按技能要求填写", required: f.required === true }];
  });
  if (!schema.properties || typeof schema.properties !== "object" || Array.isArray(schema.properties)) return [];
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  const names: Record<string, string> = { prompt: "任务描述", assets: "参考素材", parameters: "其他选项", sourceNodeIds: "画布参考" };
  return Object.entries(schema.properties).flatMap(([key, value]) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const field = value as Record<string, unknown>;
    return [{ key, label: typeof field.title === "string" ? field.title : names[key] || key,
      description: typeof field.description === "string" ? field.description : key === "assets" ? "按技能要求提供主站已上传的图片、视频或文件" : "使用时按技能要求填写", required: required.has(key) }];
  });
}

function InstallPanel({ skill, origin }: { skill: LibrarySkill; origin: string }) {
  const accountId = useAuthStore((state) => state.user?.id);
  const [tab, setTab] = useState<"codex" | "mcp">("codex");
  const [source, setSource] = useState("");
  const [sourceError, setSourceError] = useState("");
  const [showSource, setShowSource] = useState(false);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const url = skillInstallURL(skill, origin);
  const prompt = skillInstallPrompt(url);
  const workspace = nativeWorkspace(skill);
  useEffect(() => {
    if (!showSource || !url) return;
    const controller = new AbortController(); let alive = true;
    const timer = setTimeout(() => controller.abort(), 15000);
    void (async () => {
      setSourceLoading(true); setSourceError("");
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok || !(response.headers.get("content-type") || "").startsWith("text/plain")) throw new Error("文件暂不可用");
        const text = await response.text(); if (alive) setSource(text);
      } catch { if (alive) setSourceError("安装说明暂时无法读取，请收起后重试。"); }
      finally { clearTimeout(timer); if (alive) setSourceLoading(false); }
    })();
    return () => { alive = false; clearTimeout(timer); controller.abort(); };
  }, [showSource, url]);

  const download = async () => {
    if (downloading || !skill.downloadPath || !skill.installable) return;
    setDownloading(true);
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`/api/skill-library/${encodeURIComponent(skill.id)}/download`, { signal: controller.signal });
      if (!response.ok || !(response.headers.get("content-type") || "").includes("application/zip")) throw new Error("安装包暂不可用");
      const blob = await response.blob(); const objectURL = URL.createObjectURL(blob);
      const anchor = document.createElement("a"); anchor.href = objectURL; anchor.download = `${skill.skillName}.zip`;
      document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(objectURL), 60000);
      toast.success("已发起安装包下载");
    } catch { toast.error("下载失败，技能可能暂时关闭了安装，请刷新后重试"); }
    finally { clearTimeout(timer); setDownloading(false); }
  };

  return <aside className={styles.installPanel} aria-labelledby="install-title">
    <div className={styles.installHeading}><span className={styles.installIcon}><Download size={20} /></span><div><span className={styles.eyebrow}>INSTALL WITH YOUR AGENT</span><h2 id="install-title">一键安装 Skill</h2></div></div>
    {!skill.installable ? <div className={styles.unavailable}><Layers3 size={24} /><strong>安装包暂不可用</strong><p>{skill.unavailableReason || "安装包正在准备中，请稍后重试"}</p>{workspace && <Link className={styles.secondaryButton} href={workspace.href}>前往{workspace.label}<ArrowRight size={16} /></Link>}</div> : <>
      <p className={styles.installIntro}>复制下面的指令，粘贴给 Codex、Claude Code 等智能体。它会安装 Skill、检查 MCP，未接入时自动添加，已有连接直接复用。</p>
      <div className={styles.installContent}>
        <label className={styles.promptField}><span>粘贴到智能体对话中</span><textarea readOnly rows={7} value={prompt} aria-label="智能体安装指令" onFocus={e => e.target.select()} /></label>
        <SkillCopyButton skill={skill} origin={origin} className={styles.primaryButton} />
        <p className={styles.configHint}>{accountId ? "复制时自动附带当前账号的 API Key，智能体可一起配置。预览中不显示密钥。" : "登录后复制会自动附带你的 API Key；未登录时复制通用安装指令。"}</p>
        <label className={styles.linkField}><span>Skill 原始链接</span><input readOnly value={url} onFocus={e => e.target.select()} aria-label="Skill 安装链接" /></label>
        <CopyAction value={url} label="只复制链接" />
      </div>
      {skill.mcpAvailable === false && <p className={styles.connectionHint} role="status">{skill.mcpUnavailableReason || "可先安装 Skill，MCP 连接暂不可用。"}</p>}
      <details className={styles.manualSetup}>
        <summary>手动配置 MCP</summary>
        {skill.mcpEndpoint ? <>
          <div className={styles.installTabs} role="tablist" aria-label="MCP 客户端">
            {([["codex", "Codex"], ["mcp", "其他客户端"]] as const).map(([value, label]) => <button key={value} id={`install-tab-${value}`} role="tab" aria-selected={tab === value} aria-controls="install-content" className={tab === value ? styles.tabActive : ""} onClick={() => setTab(value)}>{label}</button>)}
          </div>
          <div id="install-content" role="tabpanel" aria-labelledby={`install-tab-${tab}`} className={styles.installContent}>
          <p className={styles.configHint}>{accountId ? "复制时自动填入当前账号的 API Key；下方预览隐藏密钥。将复制内容用于本地客户端的 MCP 配置。" : tab === "codex" ? "添加到 Codex 的 config.toml，并在启动 Codex 的环境中设置 FLOWLIGHT_API_KEY。" : "选择 Streamable HTTP，将自己的 API Key 填入 Authorization 请求头。"}</p>
          <pre className={styles.configCode}>{tab === "codex" ? skillCodexConfig(skill) : skillMCPConfig(skill)}</pre>
          <SkillCopyButton key={tab} skill={skill} origin={origin} format={tab} label="复制 MCP 配置" className={styles.primaryButton} />
          </div>
        </> : <p className={styles.configHint}>专属地址尚待配置。先复制安装指令，智能体会安装 Skill 并在使用前重新读取地址。</p>}
      </details>
      <div className={styles.keyNote}><KeyRound size={17} /><div><strong>连接当前账号</strong><p>{accountId ? "安装指令和 MCP 配置会附带本人的 Key。只复制链接和下载 ZIP 不包含密钥。" : "登录后可复制带有本人 API Key 的安装指令。"}</p><Link href="/account#account-api-key-title">管理 API Key<ArrowRight size={13} /></Link></div></div>
      <div className={styles.packageActions}>
        <button disabled={downloading} onClick={() => void download()}>{downloading ? <Loader2 size={15} className={styles.spinner} /> : <Download size={15} />}{downloading ? "正在准备…" : "下载 ZIP"}</button>
        <button aria-expanded={showSource} onClick={() => setShowSource(v => !v)}><FileText size={15} />查看公开 Skill<ChevronDown size={13} /></button>
      </div>
      {showSource && <div className={styles.sourcePreview}>{sourceLoading ? <p role="status">正在读取…</p> : sourceError ? <p role="alert">{sourceError}</p> : <pre>{source}</pre>}</div>}
    </>}
    <div className={styles.privateNote}><ShieldCheck size={15} /><span>本地保存调用说明，专业工作流在云端执行。</span></div>
  </aside>;
}

export function SkillLibraryDetail({ id }: { id: string }) {
  const [resource, setResource] = useState<{ skill: LibrarySkill; origin: string } | null>(null);
  const [error, setError] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); let alive = true;
    const timer = setTimeout(() => controller.abort(), 15000);
    void (async () => {
      const result = await skillLibraryApi.get(id, controller.signal);
      clearTimeout(timer); if (!alive) return;
      if (result.success && result.data) { setResource({ skill: result.data, origin: window.location.origin }); setError(""); }
      else { setNotFound(result.code === 404); setError(result.code === 404 ? "这项技能不存在或已下架。" : "技能详情暂时无法加载，请稍后重试。"); }
    })();
    return () => { alive = false; clearTimeout(timer); controller.abort(); };
  }, [id, retry]);
  if (error) return <div className={styles.page}><Link className={styles.back} href="/skills"><ArrowLeft size={16} />返回 Skill 广场</Link><div className={styles.empty} role="alert"><Layers3 size={32} /><h1>{notFound ? "技能暂不可用" : "暂时无法加载"}</h1><p>{error}</p>{!notFound && <button className={styles.secondaryButton} onClick={() => setRetry(n => n + 1)}>重新加载</button>}</div></div>;
  if (!resource) return <div className={styles.page} aria-busy="true"><Link className={styles.back} href="/skills"><ArrowLeft size={16} />返回 Skill 广场</Link><div className={styles.detailSkeleton}><span /><span /><div /><div /></div><span className={styles.srOnly} role="status">正在加载技能详情</span></div>;
  const { skill, origin } = resource;
  const workspace = nativeWorkspace(skill);
  const fields = inputFields(skill.inputSchema);
  const outputs = skill.outputTypes.map(type => LIBRARY_OUTPUT_LABELS[type] || type).join("、");
  return <div className={styles.page}>
    <Link className={styles.back} href="/skills"><ArrowLeft size={16} />返回 Skill 广场</Link>
    <header className={styles.detailHero}>
      <div><div className={styles.eyebrow}><span />{skill.category || "通用技能"} / SKILL</div><h1>{skill.title}</h1><p>{skill.description || "在这里了解技能的用途与使用方法。"}</p><div className={styles.detailMeta}><span>{skill.authorName || "FlowLight"}</span><span>v{skill.version}</span><span>{skill.useCount.toLocaleString()} 次使用</span>{skill.outputTypes.map(type => <span className={styles.metaBadge} key={type}>{LIBRARY_OUTPUT_LABELS[type] || type}</span>)}</div></div>
      <SkillCover skill={skill} detail key={skill.coverUrl} />
    </header>
    <div className={styles.detailLayout}>
      <div className={styles.detailSections}>
        <section className={styles.detailSection}><div className={styles.sectionLabel}><Sparkles size={18} /><h2>这项 Skill 能做什么</h2></div><Markdown text={skill.description || "请参阅技能的公开使用说明。"} /><div className={styles.purposeGrid}><div><span>适用场景</span><Markdown text={skill.usageScenario || "向 AI 描述你的任务，由它结合技能的输入要求与你确认。"} /></div><div><span>输出内容</span><Markdown text={skill.outputDescription || `根据任务生成${outputs || "对应的结果"}，通过 AI 客户端查看或获取产物。`} /></div></div></section>
        <section className={styles.detailSection}><div className={styles.sectionLabel}><Layers3 size={18} /><h2>使用前需要准备</h2></div>{fields.length ? <div className={styles.inputTable}>{fields.map(field => <div key={field.key}><strong>{field.label}{field.required && <span>必填</span>}</strong><p>{field.description}</p></div>)}</div> : <p>准备好任务描述。AI 会按当前技能要求，与你确认需要的素材和选项。</p>}<p className={styles.smallNote}>涉及图片、视频或文件时，先上传到主站，再使用属于你自己的文件 ID 和地址。</p></section>
        <section className={styles.detailSection}><div className={styles.sectionLabel}><Workflow size={18} /><h2>如何使用</h2></div>{skill.howTo && <Markdown text={skill.howTo} />}{skill.installable ? <ol className={styles.howSteps}><li><span>01</span><div><h3>复制指令，让智能体安装</h3><p>将“安装指令”粘贴给 Codex 等智能体，自动下载 Skill、安装文件并配置专属 MCP。</p></div></li><li><span>02</span><div><h3>连接你的账号</h3><p>登录后复制的指令会附带本人的 API Key，智能体会将它配置到本地 MCP 并检查连接。</p></div></li><li><span>03</span><div><h3>直接告诉 AI 你的需求</h3><p>AI 调用云端技能；需要补充信息或确认方案时，会继续与你沟通。</p></div></li><li><span>04</span><div><h3>获取你的结果</h3><p>任务完成后，在对话中查看结果和文件链接。</p></div></li></ol> : <p>{skill.unavailableReason || "安装包暂不可用，请稍后重试。"}{workspace && `你也可以在${workspace.label}中选择这项技能使用。`}</p>}</section>
        <section className={styles.detailSection}><div className={styles.sectionLabel}><KeyRound size={18} /><h2>积分与账号</h2></div><p>执行技能按主站实际模型调用规则消耗积分。多步骤任务可能涉及多次调用，费用以任务和积分流水为准；查询余额、查询进度不会重复收费。</p><Link className={styles.inlineLink} href="/account/points">查看我的积分流水<ArrowRight size={15} /></Link></section>
        <div className={styles.connectionNote}><Code2 size={21} /><div><strong>一个 Skill，一个专属连接</strong><p>公开文件提供调用规则，服务端保留技能实现。安装包不包含你的密钥，也不会打包原始私有文件。</p></div></div>
      </div>
      <InstallPanel skill={skill} origin={origin} />
    </div>
  </div>;
}
