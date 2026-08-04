"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { Box, Check, Heart, Loader2, Plus, Search, Sparkles, X } from "lucide-react";
import { styleApi } from "@/lib/api";
import { toast } from "@/components/shared/toast";
import { PopoverSelect } from "@/components/shared/popover-select";
import type { StylePresetSource, StylePresetVO } from "@/types/style";

export interface ImageStylePreset {
  id: string;
  name: string;
  shortName: string;
  description: string;
  prompt: string;
  coverUrl?: string;
  category?: string;
  modelIds?: string[];
  modelPrompts?: Record<string, string>;
  favorited?: boolean;
}

export const DEFAULT_STYLE_PRESET: ImageStylePreset = {
  id: "default",
  name: "默认风格",
  shortName: "风格",
  description: "不追加额外风格要求，完全按提示词生成。",
  prompt: "",
};

interface Props {
  value?: string;
  selectedName?: string;
  selectedPrompt?: string;
  modelId?: string;
  onChange: (preset: ImageStylePreset) => void;
}

const SOURCE_TABS: Array<{ value: StylePresetSource; label: string }> = [
  { value: "gallery", label: "风格广场" },
  { value: "favorite", label: "我的收藏" },
  { value: "recent", label: "最近使用" },
  { value: "mine", label: "我的风格" },
];

const CATEGORY_OPTIONS = [
  "推荐",
  "Midjourney",
  "摄影写真",
  "电商营销",
  "动漫游戏",
  "风格插画",
  "平面设计",
  "建筑及室内设计",
  "创意玩法",
  "文创周边",
  "小说推文",
];

const emptyCustomForm = {
  name: "",
  shortName: "",
  description: "",
  prompt: "",
  category: "推荐",
  publicFlag: false,
};

function getEffectivePrompt(preset: Pick<StylePresetVO, "prompt" | "modelPrompts">, modelId?: string) {
  const modelPrompt = modelId ? preset.modelPrompts?.[modelId]?.trim() : "";
  return modelPrompt || preset.prompt;
}

function toPickerPreset(preset: StylePresetVO, modelId?: string): ImageStylePreset {
  return {
    id: preset.id,
    name: preset.name,
    shortName: preset.shortName || preset.name,
    description: preset.description,
    prompt: getEffectivePrompt(preset, modelId),
    coverUrl: preset.coverUrl,
    category: preset.category,
    modelIds: preset.modelIds,
    modelPrompts: preset.modelPrompts,
    favorited: preset.favorited,
  };
}

function coverFallback(seed: string) {
  const colors = [
    "from-sky-200 via-indigo-100 to-white",
    "from-amber-200 via-orange-100 to-white",
    "from-emerald-200 via-teal-100 to-white",
    "from-rose-200 via-pink-100 to-white",
    "from-neutral-300 via-neutral-100 to-white",
  ];
  const index = Math.abs(seed.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0)) % colors.length;
  return colors[index];
}

export function ImageStylePicker({ value, selectedName, selectedPrompt, modelId, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<StylePresetSource>("gallery");
  const [category, setCategory] = useState("推荐");
  const [keyword, setKeyword] = useState("");
  const [commercialOnly, setCommercialOnly] = useState(false);
  const [styles, setStyles] = useState<StylePresetVO[]>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [customForm, setCustomForm] = useState(emptyCustomForm);
  const [creating, setCreating] = useState(false);
  // 封面图加载失败（404/防盗链）的风格 id：退回到渐变兜底，而不是裂图灰盒
  const [brokenCovers, setBrokenCovers] = useState<ReadonlySet<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);

  const activeStyle = useMemo<ImageStylePreset>(() => {
    if (!value || value === DEFAULT_STYLE_PRESET.id) return DEFAULT_STYLE_PRESET;
    const found = styles.find((item) => item.id === value);
    if (found) return toPickerPreset(found, modelId);
    return {
      id: value,
      name: selectedName || "已选风格",
      shortName: selectedName || "风格",
      description: selectedPrompt ? "已保存到当前节点的风格提示词" : "已选择风格",
      prompt: selectedPrompt || "",
    };
  }, [modelId, selectedName, selectedPrompt, styles, value]);

  const hasStyle = Boolean(value && value !== DEFAULT_STYLE_PRESET.id && activeStyle.prompt.trim());

  const loadStyles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await styleApi.list({
        pageNum: 1,
        pageSize: 80,
        source,
        keyword: keyword.trim() || undefined,
        category,
        modelId: modelId || undefined,
        commercialOnly,
      });
      if (res.success) {
        setStyles(res.data?.records ?? []);
      } else {
        toast.error(res.message || "风格库加载失败");
      }
    } catch {
      toast.error("风格库加载失败");
    } finally {
      setLoading(false);
    }
  }, [category, commercialOnly, keyword, modelId, source]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => { void loadStyles(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadStyles, open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const stop = (event: ReactMouseEvent) => event.stopPropagation();

  const choosePreset = async (preset: ImageStylePreset) => {
    onChange(preset);
    setOpen(false);
    if (preset.id !== DEFAULT_STYLE_PRESET.id) {
      styleApi.recordUse(preset.id).catch(() => undefined);
    }
  };

  const toggleFavorite = async (event: ReactMouseEvent, preset: StylePresetVO) => {
    stop(event);
    const res = await styleApi.toggleFavorite(preset.id);
    if (!res.success) {
      toast.error(res.message || "收藏失败");
      return;
    }
    setStyles((current) => {
      if (source === "favorite" && !res.data?.favorited) {
        return current.filter((item) => item.id !== preset.id);
      }
      return current.map((item) => item.id === preset.id ? { ...item, favorited: !!res.data?.favorited } : item);
    });
  };

  const submitCustomStyle = async () => {
    if (!customForm.name.trim() || !customForm.prompt.trim()) {
      toast.error("请填写风格名称和提示词");
      return;
    }
    setCreating(true);
    try {
      const res = await styleApi.create({
        name: customForm.name.trim(),
        shortName: customForm.shortName.trim() || customForm.name.trim(),
        description: customForm.description.trim(),
        prompt: customForm.prompt.trim(),
        category: customForm.category,
        modelId: modelId || undefined,
        modelIds: modelId ? [modelId] : [],
        modelPrompts: modelId ? { [modelId]: customForm.prompt.trim() } : {},
        publicFlag: customForm.publicFlag ? 1 : 0,
        commercial: 1,
      });
      if (res.success && res.data) {
        toast.success("风格已保存");
        setCustomForm(emptyCustomForm);
        setCreateOpen(false);
        setSource("mine");
        onChange(toPickerPreset(res.data, modelId));
        setOpen(false);
      } else {
        toast.error(res.message || "保存失败");
      }
    } catch {
      // 网络异常时给出反馈,避免静默失败 + 未处理 rejection
      toast.error("保存失败，请检查网络后重试");
    } finally {
      setCreating(false);
    }
  };

  const renderCard = (preset: StylePresetVO) => {
    const active = preset.id === activeStyle.id;
    const fallback = coverFallback(preset.id || preset.name);
    return (
      <button
        key={preset.id}
        type="button"
        onClick={() => choosePreset(toPickerPreset(preset, modelId))}
        className={`group relative overflow-hidden rounded-lg border bg-white text-left transition hover:-translate-y-0.5 hover:shadow-lg ${
          active ? "border-neutral-950 shadow-md" : "border-neutral-200 hover:border-neutral-300"
        }`}
      >
        <div className="relative aspect-[4/5] overflow-hidden bg-neutral-100">
          {preset.coverUrl && !brokenCovers.has(preset.id) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={preset.coverUrl}
              alt={preset.name}
              className="h-full w-full object-cover"
              loading="lazy"
              onError={() => setBrokenCovers((current) => new Set(current).add(preset.id))}
            />
          ) : (
            <div className={`flex h-full w-full items-center justify-center bg-gradient-to-br ${fallback}`}>
              <Sparkles className="h-9 w-9 text-neutral-500/70" />
            </div>
          )}
          <span className="absolute left-2 top-2 rounded-md bg-black/55 px-1.5 py-0.5 text-[11px] text-white backdrop-blur">{preset.category || "推荐"}</span>
          <span className="absolute right-2 top-2 rounded-md bg-white/85 px-1.5 py-0.5 text-[11px] text-neutral-700 backdrop-blur">{preset.commercial ? "商用" : "自用"}</span>
          {active && <span className="absolute left-2 bottom-2 flex h-6 w-6 items-center justify-center rounded-full bg-neutral-950 text-white"><Check className="h-3.5 w-3.5" /></span>}
        </div>
        <div className="space-y-1 p-2.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-[13px] font-semibold text-neutral-950">{preset.name}</div>
              <div className="truncate text-[11px] text-neutral-500">{preset.authorName || "TideCanvas"}</div>
            </div>
            <span
              role="button"
              tabIndex={0}
              onClick={(event) => toggleFavorite(event, preset)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") toggleFavorite(event as unknown as ReactMouseEvent, preset);
              }}
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition ${preset.favorited ? "border-rose-200 bg-rose-50 text-rose-500" : "border-neutral-200 bg-white text-neutral-400 hover:text-neutral-700"}`}
              title={preset.favorited ? "取消收藏" : "收藏"}
            >
              <Heart className={`h-3.5 w-3.5 ${preset.favorited ? "fill-current" : ""}`} />
            </span>
          </div>
          <p className="line-clamp-2 h-8 text-[11px] leading-4 text-neutral-500">{preset.description || preset.prompt}</p>
          <div className="text-[11px] text-neutral-400">使用 {preset.usageCount ?? 0}</div>
        </div>
      </button>
    );
  };

  return (
    <div ref={containerRef} className="relative" onMouseDown={stop}>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        title={hasStyle ? activeStyle.name : "选择风格"}
        onClick={(event) => { stop(event); setOpen(true); }}
        className={`flex h-12 w-12 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg border text-[11px] leading-tight transition-colors ${
          hasStyle
            ? "border-neutral-950 bg-neutral-950 text-white shadow-sm dark:border-white dark:bg-white dark:text-neutral-950"
            : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
        }`}
      >
        <Box className="h-3.5 w-3.5" />
        <span className="max-w-9 truncate text-[10px] leading-none">{activeStyle.shortName || "风格"}</span>
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[240] flex items-center justify-center bg-black/50 p-6 backdrop-blur-[2px]" onMouseDown={() => setOpen(false)}>
          <section
            role="dialog"
            aria-modal="true"
            aria-label="选择风格"
            className="flex h-[min(820px,calc(100vh-56px))] w-[min(1440px,calc(100vw-72px))] flex-col overflow-hidden rounded-xl bg-white shadow-2xl shadow-black/25"
            onMouseDown={stop}
          >
            <header className="flex items-center gap-4 border-b border-neutral-100 px-5 py-3">
              <div className="flex rounded-lg bg-neutral-100 p-1">
                {SOURCE_TABS.map((tab) => (
                  <button
                    key={tab.value}
                    type="button"
                    onClick={() => setSource(tab.value)}
                    className={`rounded-md px-4 py-1.5 text-sm transition ${source === tab.value ? "bg-white text-neutral-950 shadow-sm" : "text-neutral-500 hover:text-neutral-900"}`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <div className="relative w-80 max-w-[32vw]">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                <input
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                  placeholder="搜索风格名称、作者"
                  className="h-9 w-full rounded-lg border border-neutral-200 bg-neutral-50 pl-9 pr-3 text-sm outline-none transition focus:border-neutral-300 focus:bg-white"
                />
              </div>
              <label className="ml-auto flex items-center gap-2 text-sm text-neutral-500">
                <input type="checkbox" checked={commercialOnly} onChange={(event) => setCommercialOnly(event.target.checked)} />
                仅看可商用
              </label>
              <button type="button" onClick={() => setCreateOpen((v) => !v)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-neutral-200 px-3 text-sm text-neutral-800 hover:bg-neutral-50">
                <Plus className="h-4 w-4" /> 自定义
              </button>
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-2 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900">
                <X className="h-5 w-5" />
              </button>
            </header>

            <div className="flex flex-wrap items-center gap-2 border-b border-neutral-100 px-5 py-3">
              {CATEGORY_OPTIONS.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setCategory(item)}
                  className={`rounded-md px-3 py-1.5 text-sm transition ${category === item ? "bg-neutral-950 text-white" : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"}`}
                >
                  {item}
                </button>
              ))}
            </div>

            {createOpen && (
              <div className="grid grid-cols-[1fr_1fr_1.4fr_auto] gap-3 border-b border-neutral-100 bg-neutral-50 px-5 py-3">
                <input value={customForm.name} onChange={(event) => setCustomForm((v) => ({ ...v, name: event.target.value }))} placeholder="风格名称" className="h-10 rounded-lg border border-neutral-200 px-3 text-sm outline-none focus:border-neutral-400" />
                <input value={customForm.shortName} onChange={(event) => setCustomForm((v) => ({ ...v, shortName: event.target.value }))} placeholder="短名称" className="h-10 rounded-lg border border-neutral-200 px-3 text-sm outline-none focus:border-neutral-400" />
                <input value={customForm.description} onChange={(event) => setCustomForm((v) => ({ ...v, description: event.target.value }))} placeholder="一句话描述" className="h-10 rounded-lg border border-neutral-200 px-3 text-sm outline-none focus:border-neutral-400" />
                <PopoverSelect
                  value={customForm.category}
                  options={CATEGORY_OPTIONS.map((item) => ({ value: item, label: item }))}
                  onChange={(item) => setCustomForm((v) => ({ ...v, category: item }))}
                  label="风格分类"
                  className="h-10 w-full border-neutral-200 bg-white px-3 text-sm hover:bg-neutral-50"
                />
                <textarea value={customForm.prompt} onChange={(event) => setCustomForm((v) => ({ ...v, prompt: event.target.value }))} placeholder="风格提示词，例如：电影级布光、真实材质、浅景深、低饱和高级调色" className="col-span-3 min-h-20 resize-none rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400" />
                <div className="flex flex-col justify-between gap-2">
                  <label className="flex items-center gap-2 text-sm text-neutral-600"><input type="checkbox" checked={customForm.publicFlag} onChange={(event) => setCustomForm((v) => ({ ...v, publicFlag: event.target.checked }))} />公开到广场</label>
                  <button type="button" disabled={creating} onClick={submitCustomStyle} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-neutral-950 px-4 text-sm font-medium text-white disabled:opacity-50">
                    {creating && <Loader2 className="h-4 w-4 animate-spin" />} 保存并使用
                  </button>
                </div>
              </div>
            )}

            <main className="min-h-0 flex-1 overflow-y-auto p-5">
              {loading ? (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-4">
                  {Array.from({ length: 16 }).map((_, index) => <div key={index} className="h-72 animate-pulse rounded-lg bg-neutral-100" />)}
                </div>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-4">
                  <button type="button" onClick={() => choosePreset(DEFAULT_STYLE_PRESET)} className={`group relative overflow-hidden rounded-lg border bg-white text-left transition hover:-translate-y-0.5 hover:shadow-lg ${activeStyle.id === DEFAULT_STYLE_PRESET.id ? "border-neutral-950 shadow-md" : "border-neutral-200 hover:border-neutral-300"}`}>
                    <div className="relative aspect-[4/5] overflow-hidden bg-neutral-100">
                      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-neutral-300 via-neutral-100 to-white">
                        <Sparkles className="h-9 w-9 text-neutral-500/70" />
                      </div>
                      <span className="absolute left-2 top-2 rounded-md bg-black/55 px-1.5 py-0.5 text-[11px] text-white backdrop-blur">推荐</span>
                      {activeStyle.id === DEFAULT_STYLE_PRESET.id && <span className="absolute left-2 bottom-2 flex h-6 w-6 items-center justify-center rounded-full bg-neutral-950 text-white"><Check className="h-3.5 w-3.5" /></span>}
                    </div>
                    <div className="space-y-1 p-2.5">
                      <div className="truncate text-[13px] font-semibold text-neutral-950">默认风格</div>
                      <p className="line-clamp-2 h-8 text-[11px] leading-4 text-neutral-500">不追加风格提示词，只使用你输入的内容。</p>
                    </div>
                  </button>
                  {styles.map(renderCard)}
                </div>
              )}
              {!loading && styles.length === 0 && (
                <div className="flex h-48 items-center justify-center text-sm text-neutral-400">当前分类暂无风格</div>
              )}
            </main>
          </section>
        </div>,
        document.body,
      )}
    </div>
  );
}