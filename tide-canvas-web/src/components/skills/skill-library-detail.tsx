"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, ArrowRight, Check, ChevronDown, ChevronUp, Copy, Download, KeyRound, Layers3, ListChecks, MessageSquare, ShieldCheck, Sparkles } from "lucide-react";
import { copyText } from "@/lib/clipboard";
import { LIBRARY_OUTPUT_LABELS, skillInstallURL, skillLibraryApi } from "@/lib/skill-library-api";
import { toast } from "@/components/shared/toast";
import { useAuthStore } from "@/stores/use-auth-store";
import type { LibrarySkill } from "@/types/skill-library";
import { SkillCover } from "./skill-library";
import { SkillCopyButton } from "./skill-copy-button";
import styles from "./skill-library.module.css";

function CopyAction({ value, label, className = styles.linkCopy }: { value: string; label: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(false), 2000); return () => clearTimeout(timer); }, [copied]);
  return <button type="button" className={className} disabled={!value} onClick={async () => {
    if (await copyText(value)) { setCopied(true); toast.success("已复制"); } else toast.error("复制失败，请选中文字手动复制");
  }}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? "已复制" : label}</button>;
}

function Markdown({ text }: { text: string }) {
  return <div className={styles.markdown}><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ img: () => null, table: ({ children }) => <div className={styles.tableScroll}><table>{children}</table></div>, a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}>{text}</ReactMarkdown></div>;
}

function OutputExample({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const [long, setLong] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = content.current;
    if (!element) return;
    const measure = () => setLong(element.scrollHeight > 300);
    const frame = requestAnimationFrame(measure);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [text]);
  return <div className={styles.outputExample}>
    <div className={!expanded ? styles.exampleClamped : undefined}><div ref={content}><Markdown text={text} /></div></div>
    {long && <button type="button" className={styles.expandExample} aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? "收起样例" : "展开完整样例"}{expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button>}
  </div>;
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
  const url = skillInstallURL(skill, origin);
  const workspace = nativeWorkspace(skill);

  return <aside id="skill-install" className={styles.installPanel} aria-labelledby="install-title">
    <div className={styles.installHeading}><span className={styles.installIcon}><Download size={20} /></span><div><span className={styles.eyebrow}>INSTALL WITH YOUR AGENT</span><h2 id="install-title">一键安装 Skill</h2></div></div>
    {!skill.installable ? <div className={styles.unavailable}><Layers3 size={24} /><strong>安装包暂不可用</strong><p>{skill.unavailableReason || "安装包正在准备中，请稍后重试"}</p>{workspace && <Link className={styles.secondaryButton} href={workspace.href}>前往{workspace.label}<ArrowRight size={16} /></Link>}</div> : <>
      <p className={styles.installIntro}>把安装指令交给你正在使用的智能体，由它按当前客户端的方式完成安装和连接。</p>
      <div className={styles.installContent}>
        <ol className={styles.installFlow} aria-label="安装流程">
          <li><span className={styles.flowIcon}><Copy size={18} aria-hidden /></span><span>复制指令</span></li>
          <li><span className={styles.flowIcon}><MessageSquare size={18} aria-hidden /></span><span>粘贴给 AI</span></li>
          <li><span className={styles.flowIcon}><Sparkles size={18} aria-hidden /></span><span>开始使用</span></li>
        </ol>
        <SkillCopyButton skill={skill} origin={origin} className={styles.primaryButton} />
        <p className={styles.configHint}>{accountId ? "复制时自动附带当前账号的 API Key。" : "登录后，可自动带上你的 API Key。"}</p>
        <CopyAction value={url} label="只复制链接" />
      </div>
      {skill.mcpAvailable === false && <p className={styles.connectionHint} role="status">{skill.mcpUnavailableReason || "可先安装 Skill，MCP 连接暂不可用。"}</p>}
      <div className={styles.keyNote}><KeyRound size={17} /><div><strong>连接当前账号</strong><p>{accountId ? "安装指令会附带本人的 Key，智能体会自动完成账号配置。" : "登录后可复制带有本人 API Key 的安装指令。"}</p><Link href="/account#account-api-key-title">管理 API Key<ArrowRight size={13} /></Link></div></div>
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
  const fields = inputFields(skill.inputSchema);
  const outputs = skill.outputTypes.map(type => LIBRARY_OUTPUT_LABELS[type] || type).join("、");
  const inputDescription = skill.inputDescription?.trim() || skill.howTo?.trim() || "告诉智能体你的任务目标，并提供相关背景或参考素材。";
  const inputExample = skill.inputExample?.trim() || "请使用「" + skill.title + "」帮我完成【任务目标】。\n参考信息：【背景或素材】\n希望得到：【结果与要求】";
  const outputExample = skill.outputExample?.trim() || "";
  return <div className={styles.page}>
    <Link className={styles.back} href="/skills"><ArrowLeft size={16} />返回 Skill 广场</Link>
    <header className={styles.detailHero}>
      <div><div className={styles.eyebrow}><span />{skill.category || "通用技能"} / SKILL</div><h1>{skill.title}</h1><p>{skill.description || "在这里了解技能的用途与使用方法。"}</p><div className={styles.detailMeta}><span>{skill.authorName || "FlowLight"}</span><span>v{skill.version}</span><span>{skill.useCount.toLocaleString()} 次使用</span>{skill.outputTypes.map(type => <span className={styles.metaBadge} key={type}>{LIBRARY_OUTPUT_LABELS[type] || type}</span>)}</div><a className={styles.mobileInstallLink} href="#skill-install">安装这个 Skill<ArrowRight size={15} /></a></div>
      <SkillCover skill={skill} detail key={skill.coverUrl} />
    </header>
    <div className={styles.detailLayout}>
      <div className={styles.detailSections}>
        <nav className={styles.guideNav} aria-label="技能使用指南"><a href="#skill-how"><span>01</span>怎么用</a><a href="#skill-input"><span>02</span>输入什么</a><a href="#skill-output"><span>03</span>输出什么</a></nav>
        <section id="skill-how" className={styles.quickStart} aria-labelledby="how-title">
          <div className={styles.guideHeading}><span className={styles.sectionNumber}>01</span><div><h2 id="how-title">怎么用</h2><p>安装后，在智能体对话中直接开始任务。</p></div></div>
          <ol className={styles.usageSteps}>
            <li><MessageSquare size={20} aria-hidden /><h3>说清目标</h3><p>描述你想完成的任务与要求。</p></li>
            <li><Layers3 size={20} aria-hidden /><h3>提供输入</h3><p>按下方说明补充信息或参考素材。</p></li>
            <li><ListChecks size={20} aria-hidden /><h3>获取结果</h3><p>在对话中查看结果，继续提出修改意见。</p></li>
          </ol>
          {skill.howTo?.trim() && skill.howTo.trim() !== inputDescription && <div className={styles.usageDetail}><Markdown text={skill.howTo} /></div>}
        </section>
        <div className={styles.ioGrid}>
          <section id="skill-input" className={`${styles.ioCard} ${styles.inputCard}`} aria-labelledby="input-title">
            <div className={styles.guideHeading}><span className={styles.sectionNumber}>02</span><div><h2 id="input-title">输入什么</h2><p>你需要提供的内容</p></div></div>
            <Markdown text={inputDescription} />
            {fields.length > 0 && <details className={styles.inputRequirements}><summary>查看输入要求<ChevronDown size={14} /></summary><div className={styles.inputTable}>{fields.map(field => <div key={field.key}><strong>{field.label}{field.required && <span>必填</span>}</strong><p>{field.description}</p></div>)}</div></details>}
            <div className={styles.inputSample}>
              <div className={styles.sampleHeading}><MessageSquare size={15} aria-hidden /><strong>{skill.inputExample?.trim() ? "输入样例" : "参考提问模板"}</strong></div>
              <p className={styles.samplePrompt}>{inputExample}</p>
              <CopyAction value={inputExample} label={skill.inputExample?.trim() ? "复制示例提问" : "复制提问模板"} className={styles.sampleCopy} />
            </div>
          </section>
          <section id="skill-output" className={`${styles.ioCard} ${styles.outputCard}`} aria-labelledby="output-title">
            <div className={styles.guideHeading}><span className={styles.sectionNumber}>03</span><div><h2 id="output-title">输出什么</h2><p>你会得到的结果</p></div></div>
            <div className={styles.outputTags}>{skill.outputTypes.map(type => <span key={type}>{LIBRARY_OUTPUT_LABELS[type] || type}</span>)}</div>
            <Markdown text={skill.outputDescription || `根据你的任务生成${outputs || "对应的结果"}，在对话中查看或获取。`} />
            <div className={styles.outputSample}>
              <div className={styles.sampleHeading}><Sparkles size={15} aria-hidden /><strong>输出样例</strong><span>示例展示</span></div>
              {outputExample ? <OutputExample text={outputExample} /> : <p className={styles.sampleEmpty}>这项技能还没有展示样例，输出内容可参考上方说明。</p>}
            </div>
          </section>
        </div>
        <details className={styles.aboutSkill}><summary>更多介绍与适用场景<ChevronDown size={16} /></summary><Markdown text={skill.description || "向智能体说明你的任务目标，即可开始使用。"} />{skill.usageScenario && <><h3>适用场景</h3><Markdown text={skill.usageScenario} /></>}</details>
        <div className={styles.billingNote}><KeyRound size={17} aria-hidden /><div><strong>按实际使用消耗积分</strong><p>具体费用以任务记录和积分流水为准，查询进度不重复收费。</p></div><Link href="/account/points">查看流水<ArrowRight size={14} /></Link></div>
      </div>
      <InstallPanel skill={skill} origin={origin} />
    </div>
  </div>;
}
