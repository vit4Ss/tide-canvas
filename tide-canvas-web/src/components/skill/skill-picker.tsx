"use client";

/* ============================================================================
   SkillPicker — 技能广场选择弹层(/chat、创作台、项目启动器、画布助手共用)。

   深色画廊形态(对齐参考产品与前台身份):分类页签 + 搜索 + 封面卡片栅格,
   点卡即选中并关闭,由调用方把技能附着为输入框 chip。outputType 由入口按
   模态传入过滤(图片节点只列 image 技能;不传 = 全部)。

   注意:画布节点内使用时是 React portal——遮罩与面板必须 stopPropagation,
   否则 mousedown 沿组件树冒泡到节点根部会把节点拖走(画布三约束之一)。
   ========================================================================== */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Loader2, Search, Sparkles, X } from "lucide-react";
import { skillApi } from "@/lib/skill-api";
import { skillCoverUrl } from "@/components/skill/skill-cover";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import {
  SKILL_CATEGORIES,
  SKILL_KIND_LABEL,
  SKILL_OUTPUT_LABEL,
  skillKindOf,
  skillOutputTypesOf,
  skillSupportsEntryPoint,
  skillSupportsOutput,
  type SkillEntryPoint,
  type SkillKind,
  type SkillVO,
} from "@/types/skill";

interface Props {
  open: boolean;
  onClose: () => void;
  onPick: (skill: SkillVO) => void;
  /** 按输出模态过滤（image/video/audio/text）；缺省列全部 */
  outputType?: string;
  /** 当前已选技能 id（高亮回显） */
  currentId?: string;
  /** 按执行形态过滤；旧调用不传时仍显示全部技能。 */
  kinds?: SkillKind[];
  /** 当前产品入口，用于隐藏不支持该入口的工作流。 */
  entryPoint?: SkillEntryPoint;
  /** 当前入口的具体落点，如画布节点类型或资产分类。 */
  targetType?: string;
  /** 当前模型不支持某项技能时返回原因；该卡片保留可见但不可选择。 */
  skillUnavailableReason?: (skill: SkillVO) => string | undefined;
}

const fmtCount = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

export function SkillPicker({ open, onClose, onPick, outputType, currentId, kinds, entryPoint, targetType, skillUnavailableReason }: Props) {
  const dialogRef = useFocusTrap<HTMLElement>(open);
  const kindsKey = kinds?.join(",") ?? "";
  const mixedPresetTool = kindsKey.split(",").includes("preset") && kindsKey.split(",").includes("tool");
  // Agent and Tool runs are not tied to the launcher's current media tab. The
  // single-output filter narrows Presets only, otherwise Studio would hide file
  // and analysis tools while the user is on an image/video/audio tab.
  const requestOutputType = kindsKey.includes("agent") || kindsKey.includes("tool") ? undefined : outputType;
  const [category, setCategory] = useState("");
  const [keyword, setKeyword] = useState("");
  const [rows, setRows] = useState<SkillVO[] | null>(null);
  const [loadedQueryKey, setLoadedQueryKey] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  // 该模态下真正有技能的分类：页签只列这些，避免点进去是空的。
  // null = 未取到（先只显示「推荐」，不预先摆一排可能全是空的页签）。
  const [cats, setCats] = useState<string[] | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    const requests = mixedPresetTool
      ? [
          skillApi.categories(outputType, entryPoint, ["preset"], targetType),
          skillApi.categories(undefined, entryPoint, ["tool"], targetType),
        ]
      : [skillApi.categories(
          requestOutputType,
          entryPoint,
          kindsKey ? (kindsKey.split(",") as SkillKind[]) : undefined,
          targetType,
        )];
    Promise.all(requests)
      .then((results) => {
        if (!alive) return;
        const have = new Set(results.flatMap((res) => res.success && res.data ? res.data : []));
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
  }, [open, requestOutputType, outputType, entryPoint, kindsKey, mixedPresetTool, targetType]);

  // seq 守卫:切分类/搜索的旧响应后到不覆盖新结果;关窗后丢弃。
  // 置 loading(rows=null)放在异步回调里,不在 effect 体内同步 setState。
  const seqRef = useRef(0);
  const queryKey = JSON.stringify({ open, category, keyword: keyword.trim(), requestOutputType, outputType, entryPoint, kindsKey, targetType, retryNonce });
  // Keep a debounced search responsive without exposing the previous surface's
  // cards as clickable results while the new request is still in flight.
  const visibleRows = loadedQueryKey === queryKey ? rows : null;
  useEffect(() => {
    if (!open) return;
    const seq = ++seqRef.current;
    const timer = setTimeout(() => {
      setRows(null);
      setLoadFailed(false);
      const baseQuery = {
        pageNum: 1,
        pageSize: 60,
        category: category || undefined,
        keyword: keyword.trim() || undefined,
        entryPoint,
        targetType,
      };
      const requests = mixedPresetTool
        ? [
            skillApi.list({ ...baseQuery, outputType, kind: "preset" }),
            skillApi.list({ ...baseQuery, kind: "tool" }),
          ]
        : [skillApi.list({
            ...baseQuery,
            outputType: requestOutputType,
            ...(kindsKey.includes(",")
              ? { kinds: kindsKey }
              : kindsKey
                ? { kind: kindsKey as SkillKind }
                : {}),
          })];
      Promise.all(requests)
        .then((results) => {
          if (seq !== seqRef.current) return;
          const successful = results.filter((result) => result.success && result.data);
          if (!successful.length) {
            setRows([]);
            setLoadFailed(true);
            setLoadedQueryKey(queryKey);
            return;
          }
          const byID = new Map<string, SkillVO>();
          for (const result of successful) {
            for (const record of result.data!.records) byID.set(record.id, record);
          }
          const records = [...byID.values()].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
          const kindSet = new Set(kindsKey ? (kindsKey.split(",") as SkillKind[]) : []);
          setRows(
            records.filter(
              (skill) =>
                (!kindSet.size || kindSet.has(skillKindOf(skill))) &&
                skillSupportsEntryPoint(skill, entryPoint) &&
                (skillKindOf(skill) !== "preset" || skillSupportsOutput(skill, outputType)),
            ),
          );
          setLoadedQueryKey(queryKey);
        })
        .catch(() => {
          if (seq === seqRef.current) {
            setRows([]);
            setLoadFailed(true);
            setLoadedQueryKey(queryKey);
          }
        });
    }, keyword ? 250 : 0); // 输入搜索词做轻防抖
    return () => {
      clearTimeout(timer);
      if (seqRef.current === seq) seqRef.current += 1;
    };
  }, [open, category, keyword, outputType, requestOutputType, entryPoint, kindsKey, mixedPresetTool, targetType, queryKey]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    const body = document.body;
    const previousOverflow = body.style.overflow;
    const previousPaddingRight = body.style.paddingRight;
    const scrollbarWidth = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
    body.style.overflow = "hidden";
    if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`;
    return () => {
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPaddingRight;
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  const stop = (e: React.MouseEvent) => e.stopPropagation();
  // 主题自适应:深色工作室/站点(body.imini)维持深色画廊;
  // 浅色画布((canvas) 布局摘除 body.imini)切换为令牌化浅色变体。打开时读取即可。
  const dark = document.body.classList.contains("imini");
  const focusRing = dark
    ? "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-400/60"
    : "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

  return createPortal(
    <div
      className={`fixed inset-0 z-[240] flex items-center justify-center p-3 sm:p-6 ${dark ? "bg-black/70" : "bg-black/50"}`}
      onPointerDown={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <section
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="选择技能"
        className={`flex h-[min(640px,calc(100dvh-24px))] w-[min(960px,calc(100vw-24px))] flex-col overflow-hidden rounded-xl border sm:h-[min(640px,calc(100dvh-64px))] sm:w-[min(960px,calc(100vw-48px))] sm:rounded-2xl ${
          dark
            ? "border-white/12 bg-[#141416] text-neutral-100 shadow-[0_24px_80px_rgba(0,0,0,0.46)]"
            : "border-border bg-popover text-popover-foreground shadow-lg"
        }`}
        onPointerDown={stop}
        onClick={stop}
      >
        {/* 头部:标题 + 搜索 + 关闭 */}
        <header className={`flex flex-wrap items-center gap-3 border-b px-4 py-3.5 sm:flex-nowrap sm:gap-4 sm:px-5 ${dark ? "border-white/8" : "border-border"}`}>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4" />
            技能
          </h3>
          <div className="relative order-last w-full sm:order-none sm:ml-auto sm:w-64">
            <Search className={`absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 ${dark ? "text-neutral-400" : "text-muted-foreground"}`} />
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              aria-label="搜索技能"
              placeholder="搜索技能"
              className={`h-11 w-full rounded-lg border pl-8 pr-3 text-xs outline-none ${
                dark
                  ? "border-white/10 bg-white/5 text-neutral-100 placeholder:text-neutral-400 focus:border-white/25 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-400/60"
                  : "border-border bg-background text-foreground placeholder:text-muted-foreground focus:border-ring focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              }`}
            />
          </div>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className={`ml-auto grid h-11 w-11 place-items-center rounded-lg transition-colors sm:ml-0 ${focusRing} ${
              dark ? "text-neutral-400 hover:bg-white/8 hover:text-neutral-100" : "text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* 分类页签 */}
        <div className={`flex flex-nowrap items-center gap-1.5 overflow-x-auto overscroll-x-contain border-b px-4 py-2.5 [scrollbar-width:none] sm:px-5 [&::-webkit-scrollbar]:hidden ${dark ? "border-white/8" : "border-border"}`}>
          {["", ...(cats ?? [])].map((cat) => (
            <button
              key={cat || "all"}
              type="button"
              onClick={() => setCategory(cat)}
              aria-pressed={category === cat}
              className={`min-h-11 shrink-0 rounded-lg px-2.5 py-1 text-xs transition-colors ${focusRing} ${
                category === cat
                  ? (dark ? "bg-white text-neutral-950" : "bg-foreground text-background")
                  : (dark ? "text-neutral-400 hover:bg-white/8 hover:text-neutral-100" : "text-muted-foreground hover:bg-accent hover:text-foreground")
              }`}
            >
              {cat || "推荐"}
            </button>
          ))}
        </div>

        {/* 卡片栅格 */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-5">
          {visibleRows === null ? (
            <div className={`flex h-full items-center justify-center ${dark ? "text-neutral-500" : "text-muted-foreground"}`} role="status" aria-live="polite">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="sr-only">正在加载技能</span>
            </div>
          ) : loadFailed ? (
            <div className={`flex h-full flex-col items-center justify-center gap-3 ${dark ? "text-neutral-400" : "text-muted-foreground"}`} role="status">
              <p className="text-xs">技能加载失败，请检查网络后重试</p>
              <button
                type="button"
                className={`min-h-11 rounded-lg border px-3 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 ${
                  dark
                    ? "border-white/15 bg-white/5 text-neutral-100 hover:bg-white/10 focus-visible:ring-cyan-400/60"
                    : "border-border bg-background text-foreground hover:bg-accent focus-visible:ring-ring"
                }`}
                onClick={() => setRetryNonce((value) => value + 1)}
              >
                重新加载
              </button>
            </div>
          ) : visibleRows.length === 0 ? (
            <div className={`flex h-full flex-col items-center justify-center gap-2 ${dark ? "text-neutral-400" : "text-muted-foreground"}`}>
              <Sparkles className="h-6 w-6" />
              <p className="text-xs">暂无匹配的技能</p>
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] gap-3 sm:gap-4">
              {visibleRows.map((s) => {
                const selected = currentId === s.id;
                const unavailableReason = skillUnavailableReason?.(s);
                const kind = skillKindOf(s);
                const coverUrl = skillCoverUrl(s);
                const outputLabel = skillOutputTypesOf(s)
                  .map((type) => SKILL_OUTPUT_LABEL[type] ?? type)
                  .join(" / ");
                const guidance = [
                  s.usageScenario ? `适用场景：${s.usageScenario}` : "",
                  s.howTo ? `如何使用：${s.howTo}` : "",
                  s.outputDescription ? `输出内容：${s.outputDescription}` : "",
                ].filter(Boolean).join("\n");
                const guidanceSummary = guidance.length > 600 ? `${guidance.slice(0, 600)}…` : guidance;
                const accessibleSummary = [s.title, s.description, outputLabel].filter(Boolean).join("。");
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => { if (!unavailableReason) onPick(s); }}
                    title={unavailableReason || guidanceSummary || undefined}
                    aria-label={[accessibleSummary, unavailableReason].filter(Boolean).join("。")}
                    aria-disabled={!!unavailableReason}
                    aria-pressed={selected}
                    className={`group flex gap-3 rounded-xl border p-2.5 text-left transition-colors ${focusRing} ${
                      unavailableReason
                        ? (dark ? "cursor-not-allowed border-white/6 bg-white/[0.02] opacity-55" : "cursor-not-allowed border-border bg-muted/35 opacity-60")
                        : selected
                        ? (dark ? "border-white/35 bg-white/8 ring-1 ring-inset ring-white/20" : "border-foreground/40 bg-accent ring-1 ring-inset ring-foreground/15")
                        : (dark ? "border-white/8 bg-white/[0.03] hover:border-white/20 hover:bg-white/6" : "border-border bg-card hover:border-foreground/25 hover:bg-accent/60")
                    }`}
                  >
                    {/* 无封面时整块不渲染:一排空灰盒比没有图更碍眼,让文字占满卡片。
                        模态角标随之落到底部信息行,信息不丢。 */}
                    {coverUrl && (
                      <span className={`relative h-[92px] w-[132px] shrink-0 overflow-hidden rounded-lg max-[360px]:h-[76px] max-[360px]:w-[104px] ${dark ? "bg-neutral-800" : "bg-muted"}`}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={coverUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                        <span className="absolute right-1.5 top-1.5 rounded bg-black/60 px-1 text-[10px] leading-4 text-white/90 backdrop-blur-sm">
                          {outputLabel}
                        </span>
                      </span>
                    )}
                    <span className="flex min-w-0 flex-1 flex-col py-0.5">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className={`truncate text-[13px] font-semibold ${dark ? "text-neutral-50" : "text-foreground"}`}>{s.title}</span>
                        {selected && <Check aria-hidden className={`h-3.5 w-3.5 shrink-0 ${dark ? "text-neutral-100" : "text-foreground"}`} />}
                      </span>
                      <span className={`mt-1 line-clamp-2 text-xs leading-5 ${dark ? "text-neutral-400" : "text-muted-foreground"}`}>{s.description}</span>
                      {unavailableReason ? (
                        <span className={`mt-1 line-clamp-2 text-[11px] leading-4 ${dark ? "text-amber-300/85" : "text-amber-700"}`}>
                          {unavailableReason}
                        </span>
                      ) : s.usageScenario && (
                        <span className={`mt-0.5 line-clamp-1 text-[11px] leading-4 ${dark ? "text-neutral-400" : "text-muted-foreground"}`}>
                          适用：{s.usageScenario}
                        </span>
                      )}
                      <span className={`mt-auto flex items-center gap-1.5 pt-2 text-[11px] ${dark ? "text-neutral-400" : "text-muted-foreground"}`}>
                        {!coverUrl && (
                          <>
                            <span>{outputLabel}</span>
                            <span>·</span>
                          </>
                        )}
                        {kind !== "preset" && (
                          <>
                            <span>{SKILL_KIND_LABEL[kind]}</span>
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
