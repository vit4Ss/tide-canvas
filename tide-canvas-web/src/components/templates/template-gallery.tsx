"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowUpRight, ChevronRight, History, ImageIcon, Loader2, Search, Video, X } from "lucide-react";
import { studioTemplateApi, type PublicTemplatePage } from "@/lib/studio-template-api";
import { templateInputs } from "@/lib/studio-template";
import { TemplateMedia } from "@/components/studio/create-studio/template-media";
import css from "./templates.module.css";
import { templateFilters, templateListURL, saveTemplateScroll, restoreTemplateScroll, type TemplateFilters } from "@/lib/template-navigation";
import { templateUploadSlots } from "@/lib/template-workshop";

export default function TemplateGallery() {
  const searchParams = useSearchParams();
  const [filters, setFilters] = useState(() => templateFilters(searchParams));
  const { media, category, keyword, page } = filters;
  const main = useRef<HTMLElement>(null);
  const listURL = templateListURL(filters);
  const restoredURL = useRef("");
  const categoriesElement = useRef<HTMLDivElement>(null);
  const [categoryOverflow, setCategoryOverflow] = useState(false);
  const [categoryEnd, setCategoryEnd] = useState(false);
  useEffect(() => {
    // URL changes are external navigation state, including browser Back.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFilters(templateFilters(searchParams));
  }, [searchParams]);
  const update = (patch: Partial<TemplateFilters>) => {
    const next = { ...filters, page: 1, ...patch };
    if (templateListURL(next) === listURL) return;
    setFilters(next); setLoading(true);
    window.history.replaceState(null, "", templateListURL(next));
  };
  const [data, setData] = useState<PublicTemplatePage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [active, setActive] = useState("");
  useEffect(() => {
    const element = categoriesElement.current;
    if (!element) return;
    const measure = () => { setCategoryOverflow(element.scrollWidth > element.clientWidth + 1); setCategoryEnd(element.scrollLeft + element.clientWidth >= element.scrollWidth - 2); };
    const observer = new ResizeObserver(measure); observer.observe(element); element.addEventListener("scroll", measure);
    const frame = requestAnimationFrame(measure);
    return () => { observer.disconnect(); element.removeEventListener("scroll", measure); cancelAnimationFrame(frame); };
  }, [data]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true); setError("");
      try {
        const res = await studioTemplateApi.list({ mediaType: media || undefined, category: category || undefined, keyword: keyword.trim() || undefined, pageNum: page, pageSize: 18 }, controller.signal);
        if (controller.signal.aborted) return;
        if (res.success && res.data) setData(res.data);
        else { setData(null); setError(res.message || "模板暂时无法加载，请重试"); }
      } catch { if (!controller.signal.aborted) { setData(null); setError("网络连接中断，请重试"); } }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }, 180);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [media, category, keyword, page, retry]);
  useEffect(() => {
    if (loading || !data || restoredURL.current === listURL) return;
    const frame = requestAnimationFrame(() => { if (main.current) restoreTemplateScroll(listURL, main.current); restoredURL.current = listURL; });
    return () => cancelAnimationFrame(frame);
  }, [loading, data, listURL]);
  const changeMedia = (value: typeof media) => {
    update({ media: value, category: "" });
  };
  return <main ref={main} className={`${css.page} ${css.galleryPage}`}>
    <header className={css.header}>
      <div><h1>灵感和模板</h1><p>选一个喜欢的效果，放入你的素材，生成属于你的作品。</p></div>
      <Link className={css.historyLink} href="/generation-history" title="我的生成记录"><History size={16} />我的生成记录 <ArrowUpRight size={16} /></Link>
    </header>
    <div className={css.filters}>
      <div className={css.tabs} role="group" aria-label="作品类型">
        <button aria-pressed={!media} onClick={() => changeMedia("")}>全部模板</button>
        <button aria-pressed={media === "image"} onClick={() => changeMedia("image")}><ImageIcon size={17} />图片</button>
        <button aria-pressed={media === "video"} onClick={() => changeMedia("video")}><Video size={17} />视频</button>
      </div>
      <label className={css.search}><Search size={17} /><input aria-label="搜索模板" placeholder="找一个你想做的效果" value={keyword} maxLength={128} onChange={e => update({ keyword: e.target.value })} />{keyword && <button aria-label="清除搜索" onClick={() => update({ keyword: "" })}><X size={16} /></button>}</label>
    </div>
    {!!data?.categories.length && <div className={css.categoryBar}><div ref={categoriesElement} className={css.categories} role="group" aria-label="模板分类">
      {["", ...data.categories].map(value => <button key={value} aria-pressed={category === value} onClick={() => update({ category: value })}>{value || "全部风格"}</button>)}
    </div>{categoryOverflow && <button className={css.categoryMore} aria-label={categoryEnd ? "返回首个分类" : "查看更多分类"} onClick={() => { const element = categoriesElement.current; if (element) element.scrollTo({ left: categoryEnd ? 0 : element.scrollLeft + element.clientWidth * .75, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" }); }}><ChevronRight size={18} style={{ transform: categoryEnd ? "rotate(180deg)" : undefined }} /></button>}{!loading && <span className={css.catalogCount}>{data.total} 个模板</span>}</div>}
    {loading ? <div className={css.loading} role="status"><Loader2 className={css.spin} size={22} />正在寻找创作灵感…</div> : error ? <div className={css.empty} role="alert"><h2>暂时没能加载模板</h2><p>{error}</p><button className={css.secondary} onClick={() => setRetry(v => v + 1)}>重新加载</button></div> : !data?.records.length ? <div className={css.empty}><ImageIcon size={32} /><h2>{keyword || category ? "没有找到匹配的模板" : "模板正在准备中"}</h2><p>{keyword || category ? "换一个关键词，或看看其他分类。" : "已上架的图片和视频模板会展示在这里，你也可以先去自由创作。"}</p>{keyword || category ? <button className={css.secondary} onClick={() => { update({ keyword: "", category: "" }); }}>清除筛选</button> : <Link href="/studio" className={css.secondary}>前往创作台</Link>}</div> : <>
      <div className={`${css.grid} ${media === "video" ? css.videoGrid : ""}`}>
        {data.records.map(row => <Link key={row.id} className={css.card} href={`/templates/${encodeURIComponent(row.id)}?returnTo=${encodeURIComponent(listURL)}`} onClick={() => { if (main.current) saveTemplateScroll(listURL, main.current); }} onMouseEnter={() => setActive(row.id)} onMouseLeave={() => setActive("")} onFocus={() => setActive(row.id)} onBlur={() => setActive("")}>
          <div className={css.poster}>
            <TemplateMedia row={row} active={active === row.id} width={720} />
            {row.mediaType === "image" && <span className={css.mediaLabel}><ImageIcon size={13} />图片</span>}
            {row.category && <span className={css.cardCategory}>{row.category}</span>}
            <div className={css.cardCopy}><h2>{row.title}</h2><p>{row.description || row.category}</p></div>
          </div>
          <div className={css.cardFooter}><span>{row.inputLabels && Object.values(row.inputLabels).some(labels => labels?.some(Boolean)) ? templateUploadSlots(row).map(slot => slot.label).join(" + ") : templateInputs(row)}</span><span className={css.cardAction}>做同款 <ArrowUpRight size={16} /></span></div>
        </Link>)}
      </div>
      {data.pages > 1 && <nav className={css.pagination} aria-label="模板分页"><button className={css.secondary} disabled={page === 1} onClick={() => { update({ page: page - 1 }); }}>上一页</button><span>第 {page} / {data.pages} 页</span><button className={css.secondary} disabled={page >= data.pages} onClick={() => { update({ page: page + 1 }); }}>下一页</button></nav>}
    </>}
  </main>;
}
