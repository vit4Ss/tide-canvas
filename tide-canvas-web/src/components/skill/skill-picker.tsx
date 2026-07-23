"use client";

/* ============================================================================
   SkillPicker — 技能广场选择弹层(/chat、创作台、画布节点三入口共用)。

   深色画廊形态(对齐参考产品与前台身份):分类页签 + 搜索 + 封面卡片栅格,
   点卡即选中并关闭,由调用方把技能附着为输入框 chip。outputType 由入口按
   模态传入过滤(图片节点只列 image 技能;不传 = 全部)。

   注意:画布节点内使用时是 React portal——遮罩与面板必须 stopPropagation,
   否则 mousedown 沿组件树冒泡到节点根部会把节点拖走(画布三约束之一)。
   ========================================================================== */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Search, Sparkles, X } from "lucide-react";
import { skillApi } from "@/lib/skill-api";
import { SKILL_CATEGORIES, SKILL_OUTPUT_LABEL, type SkillVO } from "@/types/skill";

interface Props {
  open: boolean;
  onClose: () => void;
  onPick: (skill: SkillVO) => void;
  /** 按输出模态过滤（image/video/audio/text）；缺省列全部 */
  outputType?: string;
  /** 当前已选技能 id（高亮回显） */
  currentId?: string;
}

const fmtCount = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

export function SkillPicker({ open, onClose, onPick, outputType, currentId }: Props) {
  const [category, setCategory] = useState("");
  const [keyword, setKeyword] = useState("");
  const [rows, setRows] = useState<SkillVO[] | null>(null);
  // 该模态下真正有技能的分类：页签只列这些，避免点进去是空的。
  // null = 未取到（先只显示「推荐」，不预先摆一排可能全是空的页签）。
  const [cats, setCats] = useState<string[] | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    skillApi
      .categories(outputType)
      .then((res) => {
        if (!alive) return;
        const have = new Set(res.success && res.data ? res.data : []);
        // 排序以 SKILL_CATEGORIES 为准（推荐目录的既定次序），
        // 后台自定义的分类是自由串、不在目录里，接在后面而不是被丢掉。
        const known = SKILL_CATEGORIES.filter((c) => have.has(c));
        const extra = [...have].filter((c) => !SKILL_CATEGORIES.includes(c as (typeof SKILL_CATEGORIES)[number]));
        const list = [...known, ...extra];
        setCats(list);
        // 模态切换后当前分类可能已不存在（图片切视频时的「动漫游戏」），退回「推荐」，
        // 否则会卡在一个永远查不到东西的分类上
        setCategory((cur) => (cur && !list.includes(cur) ? "" : cur));
      })
      .catch(() => {
        // 取不到就退回全目录，宁可多一个空页签也不要没有分类可切
        if (alive) setCats([...SKILL_CATEGORIES]);
      });
    return () => {
      alive = false;
    };
  }, [open, outputType]);

  // seq 守卫:切分类/搜索的旧响应后到不覆盖新结果;关窗后丢弃。
  // 置 loading(rows=null)放在异步回调里,不在 effect 体内同步 setState。
  const seqRef = useRef(0);
  useEffect(() => {
    if (!open) return;
    const seq = ++seqRef.current;
    const timer = setTimeout(() => {
      setRows(null);
      skillApi
        .list({ pageNum: 1, pageSize: 60, category: category || undefined, keyword: keyword.trim() || undefined, outputType })
        .then((res) => {
          if (seq !== seqRef.current) return;
          setRows(res.success && res.data ? res.data.records : []);
        })
        .catch(() => {
          if (seq === seqRef.current) setRows([]);
        });
    }, keyword ? 250 : 0); // 输入搜索词做轻防抖
    return () => clearTimeout(timer);
  }, [open, category, keyword, outputType]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return createPortal(
    <div
      className="fixed inset-0 z-[240] flex items-center justify-center bg-black/60 p-6 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="选择技能"
        className="flex h-[min(680px,calc(100vh-64px))] w-[min(1080px,calc(100vw-48px))] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#141416] text-neutral-100 shadow-2xl"
        onMouseDown={stop}
        onClick={stop}
      >
        {/* 头部:标题 + 搜索 + 关闭 */}
        <header className="flex items-center gap-4 border-b border-white/8 px-5 py-3.5">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4" />
            技能
          </h3>
          <div className="relative ml-auto w-64">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-500" />
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索技能"
              className="h-8 w-full rounded-lg border border-white/10 bg-white/5 pl-8 pr-3 text-xs text-neutral-100 outline-none placeholder:text-neutral-500 focus:border-white/25"
            />
          </div>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="rounded-lg p-1.5 text-neutral-400 transition-colors hover:bg-white/8 hover:text-neutral-100"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* 分类页签 */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-white/8 px-5 py-2.5">
          {["", ...(cats ?? [])].map((cat) => (
            <button
              key={cat || "all"}
              type="button"
              onClick={() => setCategory(cat)}
              className={`rounded-lg px-2.5 py-1 text-xs transition-colors ${
                category === cat
                  ? "bg-white text-neutral-950"
                  : "text-neutral-400 hover:bg-white/8 hover:text-neutral-100"
              }`}
            >
              {cat || "推荐"}
            </button>
          ))}
        </div>

        {/* 卡片栅格 */}
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {rows === null ? (
            <div className="flex h-full items-center justify-center text-neutral-500">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : rows.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-neutral-500">
              <Sparkles className="h-6 w-6" />
              <p className="text-xs">暂无匹配的技能</p>
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
              {rows.map((s) => {
                const selected = currentId === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => onPick(s)}
                    className={`group flex gap-3 rounded-xl border p-2.5 text-left transition-colors ${
                      selected
                        ? "border-white/40 bg-white/8"
                        : "border-white/8 bg-white/[0.03] hover:border-white/20 hover:bg-white/6"
                    }`}
                  >
                    {/* 无封面时整块不渲染:一排空灰盒比没有图更碍眼,让文字占满卡片。
                        模态角标随之落到底部信息行,信息不丢。 */}
                    {s.coverUrl && (
                      <span className="relative h-[92px] w-[132px] shrink-0 overflow-hidden rounded-lg bg-neutral-800">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={s.coverUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                        <span className="absolute right-1.5 top-1.5 rounded bg-black/60 px-1 text-[10px] leading-4 text-white/90 backdrop-blur-sm">
                          {SKILL_OUTPUT_LABEL[s.outputType] ?? s.outputType}
                        </span>
                      </span>
                    )}
                    <span className="flex min-w-0 flex-1 flex-col py-0.5">
                      <span className="truncate text-[13px] font-semibold text-neutral-50">{s.title}</span>
                      <span className="mt-1 line-clamp-2 text-xs leading-5 text-neutral-400">{s.description}</span>
                      <span className="mt-auto flex items-center gap-1.5 pt-2 text-[11px] text-neutral-500">
                        {!s.coverUrl && (
                          <>
                            <span>{SKILL_OUTPUT_LABEL[s.outputType] ?? s.outputType}</span>
                            <span>·</span>
                          </>
                        )}
                        {s.authorName && <span className="truncate">{s.authorName}</span>}
                        {s.authorName && <span>·</span>}
                        <span>{fmtCount(s.useCount)} 次使用</span>
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>,
    document.body,
  );
}
