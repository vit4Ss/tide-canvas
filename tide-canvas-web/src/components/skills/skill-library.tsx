"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowDown, ArrowRight, Box, ChevronLeft, ChevronRight, Download, KeyRound, Layers3, Search, Sparkles, Workflow } from "lucide-react";
import { fallbackOssDisplayImage, ossDisplayUrl, restoreOssDisplayImage } from "@/lib/oss-display";
import { LIBRARY_OUTPUT_LABELS, skillLibraryApi } from "@/lib/skill-library-api";
import type { LibraryPage, LibrarySkill } from "@/types/skill-library";
import { SkillCopyButton } from "./skill-copy-button";
import styles from "./skill-library.module.css";

export function SkillCover({ skill, detail = false }: { skill: LibrarySkill; detail?: boolean }) {
  const [broken, setBroken] = useState(false);
  return <div className={`${styles.cover} ${detail ? styles.detailCover : ""}`}>
    {skill.coverUrl && !broken ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={ossDisplayUrl(skill.coverUrl, 960)} alt="" loading="lazy" decoding="async" onLoad={event => restoreOssDisplayImage(event.currentTarget)} onError={event => {
        if (!fallbackOssDisplayImage(event.currentTarget, skill.coverUrl)) setBroken(true);
      }} />
    ) : <div className={styles.coverFallback} aria-hidden><Workflow size={detail ? 56 : 36} strokeWidth={1} /><span>FLOWLIGHT · SKILL</span></div>}
    <span className={styles.coverLabel}>{skill.category || "通用技能"}</span>
  </div>;
}

function SkillCard({ skill }: { skill: LibrarySkill }) {
  return <article className={styles.card}>
    <Link className={styles.cardCoverLink} href={`/skills/${skill.id}`} aria-label={`查看 ${skill.title}`}><SkillCover skill={skill} key={skill.coverUrl} /></Link>
    <div className={styles.cardBody}>
      <div className={styles.cardEyebrow}><span>{skill.authorName || "FlowLight"}</span><span>v{skill.version}</span></div>
      <h2><Link href={`/skills/${skill.id}`}>{skill.title}</Link></h2>
      <p className={styles.description}>{skill.description || "查看技能详情，了解它的使用方式与输出内容。"}</p>
      <div className={styles.cardMeta}>
        <div className={styles.outputTags}>{skill.outputTypes.map(type => <span key={type}>{LIBRARY_OUTPUT_LABELS[type] || type}</span>)}</div>
        <span className={styles.usage}>{skill.useCount.toLocaleString()} 次使用</span>
      </div>
      <div className={styles.cardFoot}>
        <SkillCopyButton skill={skill} className={styles.copyButton} />
        <Link className={styles.detailLink} href={`/skills/${skill.id}`}>了解技能<ArrowRight size={15} /></Link>
      </div>
    </div>
  </article>;
}

export function SkillLibrary() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<LibraryPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(async () => {
      setLoading(true); setError("");
      timeout = setTimeout(() => controller.abort("timeout"), 15000);
      const result = await skillLibraryApi.list({ pageNum: page, pageSize: 12, category: category || undefined, keyword: query.trim() || undefined }, controller.signal);
      clearTimeout(timeout);
      if (!alive) return;
      if (result.success && result.data) setData(result.data);
      else setError("技能暂时加载失败，请重试。");
      setLoading(false);
    }, 250);
    return () => { alive = false; clearTimeout(timer); clearTimeout(timeout); controller.abort(); };
  }, [query, category, page, retry]);
  return <div className={styles.page}>
    <header className={styles.hero}>
      <div className={styles.heroCopy}>
        <div className={styles.eyebrow}><span /> FLOWLIGHT / SKILLS</div>
        <h1>让你的 AI，<br />多一项专业能力。</h1>
        <p>挑选一个 Skill，把安装链接交给你的 AI。<br className={styles.desktopBreak} />从审片到创作，让专业工作流随你的需求开始。</p>
        <a className={styles.primaryButton} href="#skill-catalog">发现技能<ArrowDown size={16} /></a>
      </div>
      <div className={styles.heroDiagram} aria-label="安装并使用 Skill 的流程">
        <div className={styles.diagramHeading}><span>从一个链接开始</span><span className={styles.diagramMark}>SKILL → MCP</span></div>
        <div className={styles.diagramRow}><span className={styles.diagramIcon}><Download size={21} /></span><div><strong>安装到你的 AI</strong><span>公开 Skill 提供调用说明</span></div><span className={styles.stepNumber}>01</span></div>
        <div className={styles.diagramConnector} />
        <div className={styles.diagramRow}><span className={styles.diagramIcon}><KeyRound size={21} /></span><div><strong>连接你的账号</strong><span>使用自己的主站 API Key</span></div><span className={styles.stepNumber}>02</span></div>
        <div className={styles.diagramConnector} />
        <div className={styles.diagramRow}><span className={styles.diagramIcon}><Workflow size={21} /></span><div><strong>开始专业任务</strong><span>通过 MCP 在云端执行技能</span></div><span className={styles.stepNumber}>03</span></div>
        <div className={styles.diagramFooter}><Box size={14} />兼容支持 Skill 与远程 MCP 的 AI 客户端</div>
      </div>
    </header>

    <section className={styles.catalog} id="skill-catalog" aria-labelledby="catalog-title">
      <div className={styles.catalogHead}>
        <div><div className={styles.eyebrow}>THE COLLECTION</div><h2 id="catalog-title">Skill 广场 <span>{data && !loading ? `${data.total.toLocaleString()} 个技能` : ""}</span></h2></div>
        <label className={styles.search}><Search size={17} /><input aria-label="搜索技能" placeholder="搜索技能名称或能力…" maxLength={100} value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} /></label>
      </div>
      <div className={styles.filters} aria-label="技能分类">
        {["", ...(data?.categories || [])].map(item => <button key={item} className={category === item ? styles.filterActive : ""} aria-pressed={category === item} onClick={() => { setCategory(item); setPage(1); }}>{item || "全部技能"}</button>)}
      </div>
      {error ? <div className={styles.empty} role="alert"><Layers3 size={30} /><h3>暂时无法加载</h3><p>{error}</p><button className={styles.secondaryButton} onClick={() => setRetry(n => n + 1)}>重新加载</button></div>
        : loading ? <div className={styles.grid} aria-busy="true" aria-label="正在加载技能">{Array.from({ length: 4 }, (_, i) => <div key={i} className={styles.skeleton}><div /><span /><span /><span /></div>)}</div>
          : !data?.records.length ? <div className={styles.empty}><Sparkles size={30} /><h3>{query || category ? "没有找到匹配的技能" : "新的能力正在准备中"}</h3><p>{query || category ? "换个关键词，或者查看全部分类。" : "技能上架后会展示在这里。"}</p>{(query || category) && <button className={styles.secondaryButton} onClick={() => { setQuery(""); setCategory(""); setPage(1); }}>查看全部技能</button>}</div>
            : <div className={styles.grid}>{data.records.map(skill => <SkillCard skill={skill} key={skill.id} />)}</div>}
      {!loading && !error && data && data.pages > 1 && <nav className={styles.pagination} aria-label="技能分页"><button aria-label="上一页" disabled={page <= 1} onClick={() => setPage(n => n - 1)}><ChevronLeft size={18} /></button><span>{page} / {data.pages}</span><button aria-label="下一页" disabled={page >= data.pages} onClick={() => setPage(n => n + 1)}><ChevronRight size={18} /></button></nav>}
    </section>
    <section className={styles.bottomNote}><KeyRound size={20} /><div><h2>一把 Key，连接你的主站账号</h2><p>登录后复制安装指令会附带当前账号的 API Key，执行技能使用你的账号积分。公开链接与安装包不含密钥。</p></div><Link href="/account#account-api-key-title">管理 API Key<ArrowRight size={16} /></Link></section>
  </div>;
}
