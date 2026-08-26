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
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { projectApi } from "@/lib/api";
import {
  clearCanvasLaunchJournal,
  createCanvasLaunchJournal,
  dismissActiveCanvasLaunchJournal,
  readActiveCanvasLaunchJournal,
  storeCanvasLaunchJournal,
  updateCanvasLaunchJournal,
  type CanvasLaunchJournal,
  type CanvasLaunchPlan,
} from "@/lib/canvas-launch";
import { useAuthStore } from "@/stores/use-auth-store";
import type { ProjectVO } from "@/types/canvas";
import { mesh } from "@/lib/mesh";
import { formatDateTime, displayProjectName } from "@/lib/utils";
import { CanvasQuickStart } from "@/components/canvas/canvas-quick-start";
import { ProjectCardMenu } from "@/components/project/project-card-menu";
import { toast } from "@/components/shared/toast";

type SortOrder = "recent" | "oldest";

const CANVAS_PROMPT_EXAMPLES = [
  {
    label: "极光雪原电影感肖像",
    prompt: "一位身穿厚重皮毛服饰的探险者站在极光下的雪原，电影感近景肖像，真实摄影，冷冽自然光，细节清晰",
  },
  {
    label: "极简产品发布海报",
    prompt: "为一副哑光黑色无线耳机创作极简产品发布海报，深色背景，克制排版，商业摄影质感",
  },
  {
    label: "东方未来角色三视图",
    prompt: "设计一位东方未来城市快递员的角色三视图，正面、侧面和背面，服装细节统一，干净的专业设定稿",
  },
  {
    label: "黏土风品牌吉祥物",
    prompt: "设计一个友好、简洁的黏土风品牌吉祥物，柔和棚拍光线，纯色背景，完整角色与清晰材质细节",
  },
] as const;

/** Deterministic mesh fallback cover for a project without a thumbnail.
 *  Seeded from the project id so a given project always gets the same cover. */
function fallbackCover(id: string): string {
  // 雪花 ID 是字符串：逐字符哈希（与全站其它 coverFallback 一致）
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return mesh(h, (h + 132) % 360, (h + 248) % 360);
}

/** updateTime/createTime arrive as "YYYY-MM-DD HH:MM:SS" / ISO strings; turn
 *  them into a comparable epoch for sorting (missing → 0 so they sink). */
function timeKey(s: string | undefined): number {
  if (!s) return 0;
  const t = Date.parse(s.replace(" ", "T"));
  return Number.isNaN(t) ? 0 : t;
}

function projectNameFromPrompt(prompt: string): string {
  const oneLine = prompt.replace(/\s+/g, " ").trim();
  const shortened = Array.from(oneLine).slice(0, 28).join("");
  return shortened || "未命名项目";
}

function isAmbiguousCreate(code: number | undefined) {
  return code === 0 || code === 408 || code === 429 || (typeof code === "number" && code >= 500);
}

export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectVO[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortOrder>("recent");
  const [recoverableLaunch, setRecoverableLaunch] = useState<CanvasLaunchJournal | null>(null);
  const [recoverableOwnerConfirmed, setRecoverableOwnerConfirmed] = useState(false);
  const [resumePending, setResumePending] = useState(false);
  const [launchRecoveryReady, setLaunchRecoveryReady] = useState(false);
  const [promptFillRequest, setPromptFillRequest] = useState<{ id: number; text: string } | null>(null);
  const [filledExampleAnnouncement, setFilledExampleAnnouncement] = useState<{ id: number; label: string } | null>(null);
  const promptFillSequenceRef = useRef(0);
  const pendingPromptFillRef = useRef<{ id: number; label: string } | null>(null);

  const ensureSession = useAuthStore((s) => s.ensureSession);

  const loadProjects = useCallback(async () => {
    try {
      if (!await ensureSession()) return;
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

  const createAndOpen = useCallback(async (journal: CanvasLaunchJournal) => {
    const request = {
      name: projectNameFromPrompt(journal.prompt),
      clientRequestId: journal.clientRequestId,
    };
    let result = await projectApi.create(request);
    if (!result.success && isAmbiguousCreate(result.code)) {
      await new Promise((resolve) => window.setTimeout(resolve, 700));
      result = await projectApi.create(request);
    }
    if (!result.success || !result.data?.id || !result.data.urlToken) {
      if (isAmbiguousCreate(result.code)) {
        toast.info("创建结果暂未确认，已保留草稿；请先检查项目列表或刷新后继续");
        setRecoverableLaunch(journal);
        void loadProjects();
        return false;
      }
      clearCanvasLaunchJournal(journal.id);
      setRecoverableLaunch((current) => current?.id === journal.id ? null : current);
      toast.error(result.message || "创建画布失败，请重试");
      return false;
    }

    const linked = updateCanvasLaunchJournal(journal.id, {
      state: "created",
      projectId: String(result.data.id),
      urlToken: result.data.urlToken,
    });
    if (!linked) {
      toast.info("画布已创建，但创作草稿未能交接；已打开画布供你继续编辑");
      clearCanvasLaunchJournal(journal.id);
      setRecoverableLaunch((current) => current?.id === journal.id ? null : current);
      router.push(`/canvas/${encodeURIComponent(result.data.urlToken)}`);
      return true;
    }

    setRecoverableLaunch((current) => current?.id === journal.id ? null : current);
    router.push(`/canvas/${encodeURIComponent(result.data.urlToken)}?handoff=${encodeURIComponent(journal.id)}`);
    return true;
  }, [loadProjects, router]);

  useEffect(() => {
    let activeEffect = true;
    void (async () => {
      try {
        if (!await ensureSession()) return;
        const active = readActiveCanvasLaunchJournal();
        if (!active) return;
        const currentUserId = useAuthStore.getState().user?.id;
        if (!currentUserId) {
          // `/me` 的瞬时失败不等于换号：保留 journal 及原幂等键，等用户
          // 主动继续时再次确认身份，绝不能在身份未知时删除恢复依据。
          if (activeEffect) {
            setRecoverableLaunch(active);
            setRecoverableOwnerConfirmed(false);
          }
          return;
        }
        if (active.creatorUserId !== String(currentUserId)) {
          clearCanvasLaunchJournal(active.id);
          return;
        }
        if (activeEffect) {
          setRecoverableLaunch(active);
          setRecoverableOwnerConfirmed(true);
        }
      } finally {
        if (activeEffect) setLaunchRecoveryReady(true);
      }
    })();
    return () => {
      activeEffect = false;
    };
  }, [ensureSession]);

  const handleLaunch = useCallback(async (plan: CanvasLaunchPlan) => {
    if (!launchRecoveryReady) {
      toast.info("正在检查未完成的创作，请稍候");
      return false;
    }
    if (recoverableLaunch) {
      toast.info("请先继续或暂不继续上次创作");
      return false;
    }
    if (!await ensureSession()) return false;
    const user = useAuthStore.getState().user;
    if (!user?.id) {
      toast.error("登录信息尚未加载完成，请稍后重试");
      return false;
    }

    const journal = createCanvasLaunchJournal(plan, String(user.id));
    if (!storeCanvasLaunchJournal(journal)) {
      toast.error("浏览器无法保存创作草稿，请检查隐私设置后重试");
      return false;
    }
    return createAndOpen(journal);
  }, [createAndOpen, ensureSession, launchRecoveryReady, recoverableLaunch]);

  const continueRecoverableLaunch = useCallback(async () => {
    if (!recoverableLaunch || resumePending) return;
    setResumePending(true);
    if (!recoverableOwnerConfirmed) {
      await useAuthStore.getState().fetchUser();
      const currentUserId = useAuthStore.getState().user?.id;
      if (!currentUserId) {
        toast.info("登录信息暂未确认，网络恢复后可继续");
        setResumePending(false);
        return;
      }
      if (recoverableLaunch.creatorUserId !== String(currentUserId)) {
        clearCanvasLaunchJournal(recoverableLaunch.id);
        setRecoverableLaunch(null);
        setResumePending(false);
        toast.info("检测到账号已切换，已停止恢复上次创作");
        return;
      }
      setRecoverableOwnerConfirmed(true);
    }
    if (recoverableLaunch.state === "prepared") {
      try {
        const opened = await createAndOpen(recoverableLaunch);
        if (!opened) setResumePending(false);
      } catch {
        toast.error("继续创建失败，请检查网络后重试");
        setResumePending(false);
      }
      return;
    }
    if (recoverableLaunch.projectId && recoverableLaunch.urlToken) {
      router.push(`/canvas/${encodeURIComponent(recoverableLaunch.urlToken)}?handoff=${encodeURIComponent(recoverableLaunch.id)}`);
      return;
    }
    setResumePending(false);
  }, [createAndOpen, recoverableLaunch, recoverableOwnerConfirmed, resumePending, router]);

  const dismissRecoverableLaunch = useCallback(() => {
    if (!recoverableLaunch || resumePending) return;
    dismissActiveCanvasLaunchJournal(recoverableLaunch.id);
    setRecoverableLaunch(null);
    setRecoverableOwnerConfirmed(false);
  }, [recoverableLaunch, resumePending]);

  const fillPromptExample = useCallback((example: (typeof CANVAS_PROMPT_EXAMPLES)[number]) => {
    promptFillSequenceRef.current += 1;
    const id = promptFillSequenceRef.current;
    pendingPromptFillRef.current = { id, label: example.label };
    setPromptFillRequest({ id, text: example.prompt });
  }, []);

  const confirmPromptExampleFilled = useCallback((id: number) => {
    const pending = pendingPromptFillRef.current;
    if (!pending || pending.id !== id) return;
    pendingPromptFillRef.current = null;
    setFilledExampleAnnouncement(pending);
  }, []);

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
        <div className="cv-lib-in cv-lib-in--quick-start">
          <section className="cv-create-hero" aria-labelledby="canvas-projects-title">
            <div className="cv-create-intro">
              <div className="cv-crumb">
                <span className="d" />
                画布 · CANVAS
              </div>
              <h1 id="canvas-projects-title" className="cv-lib-title">在无限画布上自由创作</h1>
              <p className="cv-lib-sub">
                描述一个画面、故事或产品创意，运行后会自动创建新画布并立即开始生成。
              </p>
            </div>

            <div className="cv-quick-start-slot">
              {recoverableLaunch && (
                <div className="cv-launch-resume">
                  <span aria-live="polite">
                    <strong>{recoverableLaunch.state === "prepared" ? "上次创建尚未完成" : "上次创作尚未完成"}</strong>
                    <small>{projectNameFromPrompt(recoverableLaunch.prompt)}</small>
                  </span>
                  <button type="button" onClick={() => { void continueRecoverableLaunch(); }} disabled={resumePending}>
                    {resumePending
                      ? "正在继续…"
                      : !recoverableOwnerConfirmed
                        ? "确认身份并继续"
                        : recoverableLaunch.state === "prepared" ? "继续创建" : "打开画布"}
                  </button>
                  <button type="button" className="cv-launch-dismiss" onClick={dismissRecoverableLaunch} disabled={resumePending}>
                    暂不继续
                  </button>
                </div>
              )}
              <CanvasQuickStart
                variant="launcher"
                promptFillRequest={promptFillRequest}
                onPromptFillApplied={confirmPromptExampleFilled}
                launchBlocked={!launchRecoveryReady || !!recoverableLaunch}
                launchBlockedReason={!launchRecoveryReady ? "正在检查未完成的创作" : "请先处理上次未完成的创作"}
                onLaunch={handleLaunch}
              />
            </div>

            <div className="cv-create-after">
              <div className="cv-prompt-examples" role="group" aria-label="示例提示词">
                <span className="cv-prompt-examples-label">试试这些灵感</span>
                <div className="cv-prompt-example-list">
                  {CANVAS_PROMPT_EXAMPLES.map((example) => (
                    <button
                      key={example.label}
                      type="button"
                      onClick={() => fillPromptExample(example)}
                      disabled={!launchRecoveryReady || !!recoverableLaunch}
                      aria-label={`填入示例：${example.label}`}
                    >
                      {example.label}
                    </button>
                  ))}
                </div>
              </div>
              <Link className="cv-create-blank" href="/canvas/new">
                <span aria-hidden className="plus">+</span>
                从空白画布开始
                <span aria-hidden className="arr">→</span>
              </Link>
              <span className="sr-only" aria-live="polite" aria-atomic="true">
                {filledExampleAnnouncement && (
                  <span key={filledExampleAnnouncement.id}>
                    已填入示例：{filledExampleAnnouncement.label}，可继续编辑
                  </span>
                )}
              </span>
            </div>
          </section>

          <div className="cv-projects-head">
            <div className="cv-secline">
              <h2>最近项目</h2>
              <span className="n" id="cvCount">
                {shown.length}
              </span>
            </div>
            <div className="cv-lib-tools">
              <div className="cv-search">
                <span className="ic">⌕</span>
                <input
                  aria-label="搜索项目"
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

          <div className="cv-grid" id="cvGrid">
            {!loading && (
              <Link href="/canvas/new" className="cv-card cv-new" aria-label="开启新画布">
                <div className="cv-thumb">
                  <span className="np">
                    <span className="plus" aria-hidden>+</span>
                    <b>开启新画布</b>
                    <small>从空白画布开始创作</small>
                  </span>
                </div>
              </Link>
            )}
            {!loading &&
              shown.map((p) => {
                const cover = p.thumbnail
                  ? `center / cover no-repeat url("${p.thumbnail}")`
                  : fallbackCover(p.id);
                return (
                  <div key={p.id} className="cv-card" data-id={p.id}>
                    <Link
                      href={`/canvas/${p.urlToken}`}
                      className="cv-thumb-link"
                      aria-label={`打开项目：${displayProjectName(p.name)}`}
                    >
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
              还没有项目。在上方描述想法开始创作，或从空白画布开始。
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
