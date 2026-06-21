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
   use (best-effort, authed via ensureSession), stashes the model name in
   sessionStorage and jumps to /studio.
   ========================================================================== */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { marketApi } from "@/lib/market-api";
import { useAuthStore } from "@/stores/use-auth-store";
import { mesh } from "@/lib/mesh";
import { useReveal } from "@/components/site/use-reveal";
import type { ModelCategoryVO, MarketModelVO } from "@/types/market";

type SortKey = "runs" | "new" | "name";

/** "全部" sentinel slug — the backend treats base="all"/"全部" as no filter. */
const ALL_SLUG = "all";

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
      if (res.success && res.data) setModels(res.data.records);
      else setModels([]);
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

  // "立即生成": record the use (best-effort), stash the model, jump to studio.
  const generate = useCallback(
    async (m: MarketModelVO) => {
      const name = m.nameCn || m.nameEn;
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
      router.push("/studio");
    },
    [router],
  );

  return (
    <>
      <header className="page-hero">
        <div className="ph-scrim" />
        <div className="wrap">
          <div className="live-chip reveal">
            <span className="live-dot" />
            <b>312</b> 个模型 · 每周更新
          </div>
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
            <select
              className="select"
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
            >
              <option value="runs">运行最多</option>
              <option value="new">最新发布</option>
              <option value="name">名称</option>
            </select>
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
                      <span className="mcard-use">立即生成 →</span>
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
