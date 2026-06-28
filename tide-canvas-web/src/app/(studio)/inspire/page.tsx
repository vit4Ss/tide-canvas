"use client";

/* ============================================================================
   灵感 · Inspire — a curated PROMPT + THEME library (distinct from 作品广场).

   Where 作品广场 (/explore) shows finished community works with social features,
   灵感 is about SPARKING creation: reusable prompts and themes the team curates in
   the admin 灵感 screens. Each card shows an example cover + the prompt text +
   tags + how many times it was 套用; the primary action carries the prompt into
   the 创作台 (and bumps its adoption counter).

   Data: GET /api/inspiration/prompts (sort hot|new, keyword) + /collections
   (theme chips). All public reads. Rendered inside the (studio) ws-rail layout.
   ========================================================================== */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { inspirationApi } from "@/lib/inspiration-api";
import { parseTags, type PromptVO, type CollectionVO } from "@/types/inspiration";
import { useReveal } from "@/components/site/use-reveal";
import { toast } from "@/components/shared/toast";
import { mesh } from "@/lib/mesh";
import { fmt } from "@/mock";
import styles from "./inspire.module.css";

type SortKey = "hot" | "new";

const SORTS: { t: SortKey; label: string }[] = [
  { t: "hot", label: "✦ 热门" },
  { t: "new", label: "最新" },
];

const ALL = "__all__";

/** Deterministic gradient fallback from an id (when a card has no cover). */
function fallback(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return mesh(h, (h + 132) % 360, (h + 248) % 360);
}

export default function InspirePage() {
  const router = useRouter();

  const [sort, setSort] = useState<SortKey>("hot");
  const [q, setQ] = useState("");
  const [theme, setTheme] = useState<string>(ALL); // selected collection id (or ALL)

  const [prompts, setPrompts] = useState<PromptVO[]>([]);
  const [collections, setCollections] = useState<CollectionVO[]>([]);
  const [loading, setLoading] = useState(true);

  // debounce the keyword
  const [debouncedQ, setDebouncedQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);

  // load the theme collections once
  useEffect(() => {
    let cancelled = false;
    inspirationApi.collections({ pageSize: 24 }).then((res) => {
      if (cancelled) return;
      if (res.success && res.data) setCollections(res.data.records);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // selected theme → its first tag, used as an extra keyword filter.
  const themeTag = useMemo(() => {
    if (theme === ALL) return "";
    const c = collections.find((x) => x.id === theme);
    return c ? parseTags(c.tags)[0] ?? c.title : "";
  }, [theme, collections]);

  // effective keyword: an explicit search overrides the theme filter.
  const keyword = debouncedQ || themeTag;
  // chip highlight reflects what's ACTUALLY filtering — a manual search overrides
  // the theme, so no theme chip should look active while searching.
  const activeTheme = q.trim() ? ALL : theme;

  const reqId = useRef(0);
  const load = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true);
    const res = await inspirationApi.prompts({
      pageNum: 1,
      pageSize: 60,
      sort,
      keyword: keyword || undefined,
    });
    if (id !== reqId.current) return; // superseded
    if (res.success && res.data) setPrompts(res.data.records);
    else setPrompts([]);
    setLoading(false);
  }, [sort, keyword]);

  useEffect(() => {
    load();
  }, [load]);

  useReveal([sort, theme, debouncedQ, loading]);

  // 套用: carry the prompt into the studio + bump its adoption counter.
  const apply = useCallback(
    (p: PromptVO) => {
      try {
        sessionStorage.setItem("flux_prompt", p.text);
      } catch {
        /* sessionStorage may be unavailable */
      }
      // optimistic local bump; fire-and-forget the server counter (ignore errors —
      // it's a non-critical metric and we're navigating away).
      setPrompts((prev) => prev.map((x) => (x.id === p.id ? { ...x, adoptions: x.adoptions + 1 } : x)));
      void inspirationApi.adopt(p.id).catch(() => {});
      toast.info("已带入提示词 · 正在前往创作台");
      router.push("/studio");
    },
    [router],
  );

  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard?.writeText(text);
      toast.success("提示词已复制");
    } catch {
      toast.info(text);
    }
  }, []);

  return (
    <main className={`insp ${styles.fill}`}>
      <div className="insp-glow" aria-hidden="true" />
      <div className="insp-in">
        <h1>灵感</h1>
        <p className={styles.sub}>精选提示词与主题，一键套用进创作台,从灵感到成片。</p>

        <label className="insp-search">
          <span className="ic">⌕</span>
          <input
            type="text"
            placeholder="搜提示词、风格或主题，试试「国风」「赛博」"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>

        {/* theme chips (collections) */}
        {collections.length > 0 && (
          <div className={styles.themes}>
            <button
              type="button"
              className={`${styles.theme} ${activeTheme === ALL ? styles.themeOn : ""}`}
              onClick={() => {
                setTheme(ALL);
                setQ("");
              }}
            >
              全部
            </button>
            {collections.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`${styles.theme} ${activeTheme === c.id ? styles.themeOn : ""}`}
                onClick={() => {
                  setTheme(c.id);
                  setQ(""); // a theme drives the filter; clear the manual search
                }}
                title={c.description}
              >
                {c.title}
              </button>
            ))}
          </div>
        )}

        <div className="insp-tabs">
          {SORTS.map((s) => (
            <button
              key={s.t}
              type="button"
              className={sort === s.t ? "on" : undefined}
              onClick={() => setSort(s.t)}
            >
              {s.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="empty" style={{ display: "block" }}>
            正在加载灵感… ✦
          </div>
        ) : (
          <>
            <div className={styles.grid}>
              {prompts.map((p, i) => (
                <PromptCard
                  key={p.id}
                  prompt={p}
                  delay={(i % 6) * 0.03}
                  onApply={() => apply(p)}
                  onCopy={() => copy(p.text)}
                />
              ))}
            </div>
            <div className="empty" style={{ display: prompts.length ? "none" : "block" }}>
              没有匹配的提示词，换个关键词或主题试试 ✦
            </div>
          </>
        )}
      </div>
    </main>
  );
}

/* ── PromptCard — example cover + prompt text + tags + 套用/复制 ──────────────── */

function PromptCard({
  prompt,
  delay,
  onApply,
  onCopy,
}: {
  prompt: PromptVO;
  delay: number;
  onApply: () => void;
  onCopy: () => void;
}) {
  const cover = prompt.coverUrl
    ? `center / cover no-repeat url("${prompt.coverUrl}")`
    : fallback(prompt.id);
  const tags = parseTags(prompt.tags);

  return (
    <article
      className={`${styles.card} reveal in`}
      style={{ ["--rd" as string]: `${delay}s` }}
    >
      <div className={styles.cardCover} style={{ background: cover }}>
        <button type="button" className={styles.copy} title="复制提示词" onClick={onCopy}>
          ⧉
        </button>
      </div>
      <div className={styles.cardBody}>
        <p className={styles.cardText}>{prompt.text}</p>
        {tags.length > 0 && (
          <div className={styles.tags}>
            {tags.map((t) => (
              <span key={t} className={styles.tag}>
                #{t}
              </span>
            ))}
          </div>
        )}
        <div className={styles.cardFoot}>
          <span className={styles.adopt}>✦ {fmt(prompt.adoptions)} 次套用</span>
          <button type="button" className={styles.apply} onClick={onApply}>
            套用 →
          </button>
        </div>
      </div>
    </article>
  );
}
