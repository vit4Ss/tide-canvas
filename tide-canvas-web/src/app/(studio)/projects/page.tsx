"use client";

/* ============================================================================
   画布 · CANVAS — project library, ported from design-ref/画布.html's
   <div class="cv-lib"> + the library behaviors in design-ref/liuguang/canvas.js
   (libCardHTML / renderLib / search filter / sort), rendered inside the
   (studio) ws-rail layout.

   ONLY the project-library skin is ported here. The design's mockup editor
   (.cv-editor / canvas.js editor+viewport+wires+zoom) is intentionally NOT
   ported — opening a project goes into the EXISTING real node editor at
   /canvas/[urlToken], and "新建" goes to /canvas/new.

   The 104px rail, the dark flux background, and the liuguang flux/pages/studio
   CSS all come from the (studio) layout; canvas.css (imported below) supplies
   the .cv / .cv-lib / .cv-grid / .cv-card skin using its exact class names.

   Data is real: projectApi.list({pageNum:1,pageSize:50}) → ProjectVO[]. Cards
   show the project thumbnail when set, else a deterministic mesh-gradient
   fallback (one .cv-cell, .g1). Search filters loaded projects by name; the
   sort pill toggles 最近修改 / 最早修改 by updateTime — faithful to canvas.js's
   library behavior but over real data.
   ========================================================================== */

import "@/styles/liuguang/canvas.css";
import "./projects.css";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { projectApi } from "@/lib/api";
import { useAuthStore } from "@/stores/use-auth-store";
import type { ProjectVO } from "@/types/canvas";
import { mesh } from "@/lib/mesh";
import { formatDateTime, displayProjectName } from "@/lib/utils";
import { ProjectCardMenu } from "@/components/project/project-card-menu";

type SortOrder = "recent" | "oldest";

/** Deterministic mesh fallback cover for a project without a thumbnail.
 *  Seeded from the project id so a given project always gets the same cover. */
function fallbackCover(id: number): string {
  const h = ((id * 47) % 360 + 360) % 360;
  return mesh(h, (h + 132) % 360, (h + 248) % 360);
}

/** updateTime/createTime arrive as "YYYY-MM-DD HH:MM:SS" / ISO strings; turn
 *  them into a comparable epoch for sorting (missing → 0 so they sink). */
function timeKey(s: string | undefined): number {
  if (!s) return 0;
  const t = Date.parse(s.replace(" ", "T"));
  return Number.isNaN(t) ? 0 : t;
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectVO[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortOrder>("recent");

  const ensureSession = useAuthStore((s) => s.ensureSession);

  const loadProjects = useCallback(async () => {
    try {
      await ensureSession(); // 登录流程暂未做:无 token 时静默登录默认账号
      const res = await projectApi.list({ pageNum: 1, pageSize: 50 });
      if (res.success && res.data) {
        setProjects(res.data.records);
      }
    } finally {
      setLoading(false);
    }
  }, [ensureSession]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  // client-side filter (by name) + sort (by updateTime) — canvas.js library behavior
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? projects.filter((p) => displayProjectName(p.name).toLowerCase().includes(q))
      : projects.slice();
    filtered.sort((a, b) => {
      const ka = timeKey(a.updateTime);
      const kb = timeKey(b.updateTime);
      return sort === "recent" ? kb - ka : ka - kb;
    });
    return filtered;
  }, [projects, query, sort]);

  return (
    <main className="cv">
      <div className="cv-lib" id="cvLib">
        <div className="cv-lib-glow" />
        <div className="cv-lib-in">
          <div className="cv-lib-top">
            <div>
              <div className="cv-crumb">
                <span className="d" />
                画布 · CANVAS
              </div>
              <h1 className="cv-lib-title">在无限画布上自由创作</h1>
              <p className="cv-lib-sub">
                把提示词、图片与视频铺在同一张画布上，拖拽、连线、衍生——让每个想法自然生长。
              </p>
            </div>
            <div className="cv-lib-tools">
              <div className="cv-search">
                <span className="ic">⌕</span>
                <input
                  placeholder="搜索项目…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <button
                className="cv-sort"
                type="button"
                onClick={() => setSort((s) => (s === "recent" ? "oldest" : "recent"))}
              >
                ⇅ {sort === "recent" ? "最近修改" : "最早修改"}
              </button>
            </div>
          </div>

          <div className="cv-secline">
            <h2>最近项目</h2>
            <span className="n" id="cvCount">
              {shown.length}
            </span>
          </div>

          <div className="cv-grid" id="cvGrid">
            {/* new-project card → real editor's blank-canvas route */}
            <Link className="cv-card cv-new" href="/canvas/new">
              <div className="cv-thumb">
                <div className="np">
                  <span className="plus">+</span>
                  <b>新建项目</b>
                  <small>从空白画布开始</small>
                </div>
              </div>
              <div className="cv-meta">
                <div className="cv-name">新建项目</div>
                <div className="cv-subtle">
                  <span>开启一段全新创作</span>
                </div>
              </div>
            </Link>

            {!loading &&
              shown.map((p) => {
                const cover = p.thumbnail
                  ? `center / cover no-repeat url("${p.thumbnail}")`
                  : fallbackCover(p.id);
                return (
                  <div key={p.id} className="cv-card" data-id={p.id}>
                    <Link href={`/canvas/${p.urlToken}`} className="cv-thumb-link">
                      <div className="cv-thumb">
                        <div className="cv-cells g1">
                          <div className="cv-cell" style={{ background: cover }} />
                        </div>
                        <div className="cv-open">
                          <span className="go">打开 →</span>
                        </div>
                      </div>
                    </Link>
                    <div className="cv-meta">
                      <div className="cv-name">
                        <span className="cv-name-txt">{displayProjectName(p.name)}</span>
                        <span className="cv-card-menu">
                          <ProjectCardMenu project={p} onChanged={loadProjects} />
                        </span>
                      </div>
                      <div className="cv-subtle">
                        <span className="chip">
                          <svg viewBox="0 0 24 24">
                            <rect x="3" y="3" width="18" height="18" rx="3" />
                            <path d="M3 9h18M9 3v18" />
                          </svg>
                          画布
                        </span>
                        <span>·</span>
                        <span>{formatDateTime(p.updateTime)}修改</span>
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>

          {!loading && projects.length === 0 && (
            <p className="cv-lib-sub" style={{ marginTop: 28 }}>
              还没有项目，点击「新建项目」从空白画布开始。
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
