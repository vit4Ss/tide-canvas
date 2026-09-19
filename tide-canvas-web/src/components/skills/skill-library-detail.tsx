"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { ArrowLeft, ArrowRight, Check, ChevronDown, Code2, Copy, Download, FileText, KeyRound, Layers3, Loader2, ShieldCheck, Sparkles, Workflow } from "lucide-react";
import { copyText } from "@/lib/clipboard";
import { LIBRARY_OUTPUT_LABELS, skillCodexConfig, skillInstallPrompt, skillInstallURL, skillLibraryApi, skillMCPConfig } from "@/lib/skill-library-api";
import { toast } from "@/components/shared/toast";
import type { LibrarySkill } from "@/types/skill-library";
import { SkillCover } from "./skill-library";
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
  const [tab, setTab] = useState<"agent" | "codex" | "mcp">("agent");
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
    <div className={styles.installHeading}><span className={styles.installIcon}><Download size={20} /></span><div><span className={styles.eyebrow}>TAKE IT WITH YOU</span><h2 id="install-title">安装到你的 AI</h2></div></div>
    {!skill.installable ? <div className={styles.unavailable}><Layers3 size={24} /><strong>{workspace ? "当前仅支持站内使用" : "暂未开放客户端安装"}</strong><p>{skill.unavailableReason || "该技能暂未开放客户端安装"}</p>{workspace && <Link className={styles.primaryButton} href={workspace.href}>前往{workspace.label}<ArrowRight size={16} /></Link>}</div> : <>
      <p className={styles.installIntro}>复制安装指令交给 AI，它会读取公开 Skill，并指导你连接对应的 MCP。</p>
      <div className={styles.installTabs} role="tablist" aria-label="安装方式">
        {([["agent", "让 AI 安装"], ["codex", "Codex"], ["mcp", "其他客户端"]] as const).map(([value, label]) => <button key={value} id={`install-tab-${value}`} role="tab" aria-selected={tab === value} aria-controls="install-content" className={tab === value ? styles.tabActive : ""} onClick={() => setTab(value)}>{label}</button>)}
      </div>
      <div id="install-content" role="tabpanel" aria-labelledby={`install-tab-${tab}`} className={styles.installContent}>
        {tab === "agent" ? <>
          <div className={styles.installInstruction}><Sparkles size={16} /><p>“请读取并安装这个 Skill，并按文件说明配置 MCP。”</p></div>
          <label className={styles.linkField}><span>Skill 安装链接</span><input readOnly value={url} onFocus={e => e.target.select()} aria-label="Skill 安装链接" /></label>
          <CopyAction value={prompt} label="复制安装指令" primary />
          <CopyAction value={url} label="只复制链接" />
        </> : <>
          <p className={styles.configHint}>{tab === "codex" ? "添加到 Codex 的 config.toml，并在启动 Codex 的环境中设置 FLOWLIGHT_API_KEY。" : "选择 Streamable HTTP，将自己的 API Key 填入 Authorization 请求头。"}</p>
          <pre className={styles.configCode}>{tab === "codex" ? skillCodexConfig(skill) : skillMCPConfig(skill)}</pre>
          <CopyAction value={tab === "codex" ? skillCodexConfig(skill) : skillMCPConfig(skill)} label="复制 MCP 配置" primary />
          <p className={styles.smallNote}>MCP 配置建立连接；需要本地 Skill 时，请先使用“让 AI 安装”或下载 ZIP 包。</p>
        </>}
      </div>
      <div className={styles.keyNote}><KeyRound size={17} /><div><strong>使用你自己的 API Key</strong><p>在本地配置，不需要把密钥发给 AI。</p><Link href="/account#account-api-key-title">前往个人中心获取<ArrowRight size={13} /></Link></div></div>
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
        <section className={styles.detailSection}><div className={styles.sectionLabel}><Workflow size={18} /><h2>如何使用</h2></div>{skill.howTo && <Markdown text={skill.howTo} />}{skill.installable ? <ol className={styles.howSteps}><li><span>01</span><div><h3>把安装链接交给 AI</h3><p>让 AI 阅读公开 Skill，并安装到当前客户端的技能目录。</p></div></li><li><span>02</span><div><h3>在本地配置 API Key</h3><p>连接技能专属 MCP，使用你在主站个人中心获取的密钥。</p></div></li><li><span>03</span><div><h3>直接告诉 AI 你的需求</h3><p>AI 调用云端技能；需要补充信息或确认方案时，会继续与你沟通。</p></div></li><li><span>04</span><div><h3>获取你的结果</h3><p>任务完成后，在对话中查看结果和文件链接。</p></div></li></ol> : <p>{workspace ? `在${workspace.label}中选择这项技能，填写任务描述与参考素材后使用。` : "请等待这项技能开放使用入口。"}该技能当前未开放外部客户端安装。</p>}</section>
        <section className={styles.detailSection}><div className={styles.sectionLabel}><KeyRound size={18} /><h2>积分与账号</h2></div><p>执行技能按主站实际模型调用规则消耗积分。多步骤任务可能涉及多次调用，费用以任务和积分流水为准；查询余额、查询进度不会重复收费。</p><Link className={styles.inlineLink} href="/account/points">查看我的积分流水<ArrowRight size={15} /></Link></section>
        <div className={styles.connectionNote}><Code2 size={21} /><div><strong>一个 Skill，一个专属连接</strong><p>公开文件提供调用规则，服务端保留技能实现。安装包不包含你的密钥，也不会打包原始私有文件。</p></div></div>
      </div>
      <InstallPanel skill={skill} origin={origin} />
    </div>
  </div>;
}
