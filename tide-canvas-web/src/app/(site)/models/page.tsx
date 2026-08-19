"use client";

/* ============================================================================
   /models — 模型市场 Model Market.
   React port of design-ref/模型市场.html + design-ref/liuguang/models.js.

   The (site) layout already renders the fixed WebGL field, nav and footer and
   imports flux.css + pages.css — this page renders ONLY the content and reuses
   the canonical liuguang class names so those styles apply.

   Data is REAL: marketApi.categories() drives the base-filter chips and
   marketApi.list({base,sort,keyword,...}) drives the grid. Filtering, sorting
   and search are done server-side (the backend's ListQuery), mirroring the
   original models.js `apply()` (filter base → search → sort). Covers fall back
   to a deterministic mesh gradient when the cover URL is empty.

   Catalog reads are public, so no session is required. "立即生成" records the
   use (best-effort, authed via ensureSession), stashes the model name and jumps
   to the workspace for its canonical mediaType. Types without a workspace do
   not fall through to an unrelated generator.
   ========================================================================== */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { marketApi } from "@/lib/market-api";
import { useAuthStore } from "@/stores/use-auth-store";
import { mesh } from "@/lib/mesh";
import { toast } from "@/components/shared/toast";
import SortSelect from "@/components/site/sort-select";
import { useReveal } from "@/components/site/use-reveal";
import type { ModelCategoryVO, MarketModelVO } from "@/types/market";

type SortKey = "runs" | "new" | "name";

/** "全部" sentinel slug — the backend treats base="all"/"全部" as no filter. */
const ALL_SLUG = "all";

/** 已上架但生成工作台尚未接入的类目 → 点击提示文案。卡片按钮文案与点击拦截
 *  都以本表为准,接入后删一处即可(避免三处判断改不一致)。 */
const PENDING_WORKSPACE_NOTICE: Record<string, string> = {
  "3d": "3D 模型已上架，生成入口尚未接入",
};

/** 已接入独立工作台的类目 → 目标路由（不再走「待接入」拦截）。 */
const WORKSPACE_ROUTE: Record<string, string> = {
  upscale: "/tools/vupscale",
};

/** Compact count formatter (4820 -> "4.8k", 12400 -> "12k", 980 -> "980").
 *  Mirrors the design's `fmt`; kept local so we don't import mock data. */
function fmt(n: number): string {
  if (n >= 10000) return (n / 1000).toFixed(0) + "k";
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return "" + n;
}

/** Deterministic mesh fallback for a model without a cover URL, seeded from id
 *  so a given model always gets the same gradient. */
function fallbackCover(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return mesh(h, (h + 132) % 360, (h + 248) % 360);
}

/** CSS background for a card cover: the real image when set, else a gradient. */
function coverFor(m: MarketModelVO): string {
  return m.cover
    ? `center / cover no-repeat url("${m.cover}")`
    : fallbackCover(m.id);
}

export default function ModelsPage() {
  const router = useRouter();

  const [cats, setCats] = useState<ModelCategoryVO[]>([]);
  const [models, setModels] = useState<MarketModelVO[]>([]);
  const [total, setTotal] = useState(0); // 真实在库总数（接口 PageData.total）
  const [loading, setLoading] = useState(true);

  // active base = category slug ("all" = 全部); q = free-text; sort key
  const [baseSlug, setBaseSlug] = useState<string>(ALL_SLUG);
  const [q, setQ] = useState<string>("");
  const [sort, setSort] = useState<SortKey>("runs");

  // load the base-filter chips once (public read, no session)
  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await marketApi.categories();
      if (alive && res.success && res.data) setCats(res.data);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // load models whenever a filter changes. Keyword is debounced so typing
  // doesn't refetch on every keystroke. Public read → no session.
  useEffect(() => {
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- filter changes immediately mark the current model result as stale while the debounced request starts.
    setLoading(true);
    const t = window.setTimeout(async () => {
      const res = await marketApi.list({
        base: baseSlug,
        sort,
        keyword: q.trim() || undefined,
        pageNum: 1,
        pageSize: 60,
      });
      if (!alive) return;
      if (res.success && res.data) {
        setModels(res.data.records);
        setTotal(res.data.total);
      } else {
        setModels([]);
        setTotal(0);
      }
      setLoading(false);
    }, q ? 280 : 0);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [baseSlug, sort, q]);

  // re-run the scroll-reveal scan when the rendered set changes
  useReveal([models, baseSlug, q, sort, loading]);

  // chips: 全部 first (from the "all" category if present), then the rest.
  const chips = useMemo(() => {
    if (cats.length) return cats;
    // fallback chip set before categories load / if the call fails
    return [{ id: ALL_SLUG, name: "全部", slug: ALL_SLUG, icon: "", sortOrder: 0 }];
  }, [cats]);

  // "立即生成": route by canonical media type. 3D/超分 are managed/listed now,
  // but their dedicated submit/poll/result workspaces are separate integrations;
  // do not silently send them to the image studio while those routes are
  // unavailable. 接入某类工作台时从此表删除对应项,卡片文案与点击行为同步恢复。
  const generate = useCallback(
    async (m: MarketModelVO) => {
      const name = m.nameCn || m.nameEn;
      const pending = PENDING_WORKSPACE_NOTICE[m.mediaType];
      if (pending) {
        toast.info(pending);
        return;
      }
      const target = WORKSPACE_ROUTE[m.mediaType]
        ?? (m.mediaType === "text"
          ? "/chat"
          : m.mediaType === "image" || m.mediaType === "video" || m.mediaType === "audio"
            ? `/studio?type=${m.mediaType}&model=${encodeURIComponent(name)}`
            : "/studio");
      try {
        sessionStorage.setItem("flux_model", name);
      } catch {
        /* storage unavailable — proceed without the stash */
      }
      // record-use is authed; ensure a session then fire-and-forget so a failed
      // metric never blocks navigation.
      (async () => {
        try {
          const ok = await useAuthStore.getState().ensureSession();
          if (ok) await marketApi.use(m.id);
        } catch {
          /* ignore metric failure */
        }
      })();
      router.push(target);
    },
    [router],
  );

  return (
    <>
      <header className="page-hero">
        <div className="ph-scrim" />
        <div className="wrap">
          {/* 真实在库数（原硬编码"312 · 每周更新"为假数据） */}
          {total > 0 && (
            <div className="live-chip reveal">
              <span className="live-dot" />
              <b>{total}</b> 个模型在库
            </div>
          )}
          <div className="page-head">
            <span className="eyebrow reveal">
              <span className="d" />
              模型市场 · MODELS
            </span>
            <h1 className="reveal">
              一个入口，<span className="gtext">接入所有顶级模型</span>
            </h1>
            <p className="reveal">
              大模型、LoRA 与工作流，社区精选、即点即用。挑一个，立刻开始创作。
            </p>
          </div>
        </div>
      </header>

      <section className="block" style={{ paddingTop: 30 }}>
        <div className="wrap">
          <div className="explore-bar reveal">
            <label className="search">
              <span style={{ color: "var(--text-faint)" }}>⌕</span>
              <input
                type="text"
                placeholder="搜索模型、风格或基础模型…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </label>
            <SortSelect
              value={sort}
              options={[
                { value: "runs", label: "运行最多" },
                { value: "new", label: "最新发布" },
                { value: "name", label: "名称" },
              ]}
              onChange={(v) => setSort(v as SortKey)}
            />
          </div>

          <div className="filters">
            {chips.map((c) => (
              <button
                key={c.id}
                className={`f${c.slug === baseSlug ? " on" : ""}`}
                onClick={() => setBaseSlug(c.slug)}
              >
                {c.name}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="empty">正在加载模型… ✦</div>
          ) : models.length ? (
            <div className="mgrid">
              {models.map((m, i) => {
                const badge = m.badge.trim().toLowerCase();
                const name = m.nameCn || m.nameEn;
                return (
                  <article
                    key={m.id}
                    className="mcard reveal"
                    style={{ ["--rd" as string]: `${(i % 4) * 0.04}s` }}
                    onClick={() => generate(m)}
                  >
                    <div className="mcard-cover" style={{ background: coverFor(m) }}>
                      {badge === "new" ? (
                        <span className="mbadge new">NEW</span>
                      ) : (
                        badge && <span className="mbadge hot">{m.badge.toUpperCase()}</span>
                      )}
                      <span className="mcard-use">
                        {PENDING_WORKSPACE_NOTICE[m.mediaType] ? "生成入口待接入" : "立即生成 →"}
                      </span>
                    </div>
                    <div className="mcard-body">
                      <div className="mrow">
                        <span className="mname">{name}</span>
                        <span className="mver mono">{m.ver}</span>
                      </div>
                      <div className="mtags">
                        {m.tags.map((t) => (
                          <span key={t}>{t}</span>
                        ))}
                      </div>
                      <div className="mfoot">
                        <span className="mbase mono">{m.base}</span>
                        <span className="mruns">{fmt(m.runs)} 次运行</span>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="empty">没有匹配的模型，换个关键词试试 ✦</div>
          )}
        </div>
      </section>
    </>
  );
}
