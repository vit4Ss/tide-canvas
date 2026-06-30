"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { projectApi } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import type { ProjectVO } from "@/types/canvas";
import {
  Plus,
  Search,
  ArrowUpDown,
  LayoutGrid,
  List as ListIcon,
  User as UserIcon,
  Users,
} from "lucide-react";
import { formatDateTime, displayProjectName } from "@/lib/utils";
import { ProjectCardMenu } from "@/components/project/project-card-menu";

/** 画布缩略图占位（无封面时） */
function ThumbPlaceholder({ className }: { className?: string }) {
  return (
    <div className={`flex h-full items-center justify-center text-neutral-300 dark:text-neutral-600 ${className ?? ""}`}>
      <svg className="h-1/3 w-1/3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
        />
      </svg>
    </div>
  );
}

export default function UserProjectsPage() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<ProjectVO[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"" | "mine" | "team">("");
  const [search, setSearch] = useState("");
  const [sortDesc, setSortDesc] = useState(true);
  const [view, setView] = useState<"grid" | "list">("grid");

  const loadProjects = useCallback(async () => {
    setLoading(true);
    try {
      const res = await projectApi.list({ pageNum: 1, pageSize: 100 });
      if (res.success && res.data) setProjects(res.data.records);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadProjects();
  }, [loadProjects]);

  const isMine = (p: ProjectVO) => p.ownerId == null || p.ownerId === user?.id;

  // 团队成员才需要按归属过滤
  const TABS = user?.inTeam
    ? ([
        { value: "", label: "全部", icon: LayoutGrid },
        { value: "mine", label: "我的", icon: UserIcon },
        { value: "team", label: "团队", icon: Users },
      ] as const)
    : [];

  const shown = useMemo(() => {
    const kw = search.trim().toLowerCase();
    const list = projects.filter((p) => {
      if (filter === "mine" && !isMine(p)) return false;
      if (filter === "team" && isMine(p)) return false;
      if (kw && !displayProjectName(p.name).toLowerCase().includes(kw)) return false;
      return true;
    });
    return [...list].sort((a, b) => {
      const ta = new Date(a.updateTime).getTime();
      const tb = new Date(b.updateTime).getTime();
      return sortDesc ? tb - ta : ta - tb;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, filter, search, sortDesc, user?.id]);

  return (
    <div className="px-6 py-8 lg:px-10">
      <h1 className="text-2xl font-bold">项目</h1>

      {/* 归属 tab + 工具栏 */}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        {TABS.length > 0 ? (
          <div className="flex items-center gap-1 rounded-xl bg-neutral-100 p-1 dark:bg-neutral-800">
            {TABS.map((tb) => (
              <button
                key={tb.value}
                onClick={() => setFilter(tb.value)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors ${
                  filter === tb.value
                    ? "bg-white font-medium text-neutral-900 shadow-sm dark:bg-neutral-900 dark:text-white"
                    : "text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
                }`}
              >
                <tb.icon className="h-4 w-4" />
                {tb.label}
              </button>
            ))}
          </div>
        ) : (
          <div />
        )}

        <div className="flex items-center gap-2">
          <Link
            href="/canvas/new"
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-1.5 rounded-full bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            <Plus className="h-4 w-4" />
            新增
          </Link>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索项目"
              className="w-44 rounded-full border border-neutral-200 bg-white py-2 pl-9 pr-3 text-sm outline-none transition-colors focus:border-neutral-300 dark:border-neutral-700 dark:bg-neutral-900"
            />
          </div>

          <button
            onClick={() => setSortDesc((d) => !d)}
            className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 px-3 py-2 text-sm text-neutral-600 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            <ArrowUpDown className="h-4 w-4" />
            {sortDesc ? "倒序" : "正序"}
          </button>

          <button
            onClick={() => setView((v) => (v === "grid" ? "list" : "grid"))}
            aria-label="切换视图"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-neutral-200 text-neutral-600 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            {view === "grid" ? <ListIcon className="h-4 w-4" /> : <LayoutGrid className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* 内容 */}
      {loading ? (
        <div className="mt-8 grid gap-5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="aspect-video animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <div className="mt-24 text-center text-sm text-neutral-400">暂无项目</div>
      ) : view === "grid" ? (
        <div className="mt-8 grid gap-5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {shown.map((project) => (
            <div key={project.id} className="group flex flex-col gap-2">
              <Link
                href={`/canvas/${project.urlToken}`}
                target="_blank"
                rel="noopener"
                className="relative block w-full overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50 transition-shadow hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900"
              >
                <div className="aspect-video">
                  {project.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={project.thumbnail} alt={project.name} className="h-full w-full object-cover" />
                  ) : (
                    <ThumbPlaceholder />
                  )}
                </div>
                {user?.inTeam && !isMine(project) && (
                  <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
                    <Users className="h-3 w-3" /> 团队
                  </span>
                )}
              </Link>
              <div className="flex items-center justify-between gap-2 px-0.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{displayProjectName(project.name)}</p>
                  <p className="mt-0.5 text-xs text-neutral-400">{formatDateTime(project.updateTime)}</p>
                </div>
                <ProjectCardMenu project={project} onChanged={loadProjects} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-6 divide-y divide-neutral-100 dark:divide-neutral-800">
          {shown.map((project) => (
            <div key={project.id} className="group flex items-center gap-3 py-2.5">
              <Link
                href={`/canvas/${project.urlToken}`}
                target="_blank"
                rel="noopener"
                className="h-12 w-20 shrink-0 overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900"
              >
                {project.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={project.thumbnail} alt={project.name} className="h-full w-full object-cover" />
                ) : (
                  <ThumbPlaceholder />
                )}
              </Link>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                  {displayProjectName(project.name)}
                  {user?.inTeam && !isMine(project) && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                      <Users className="h-3 w-3" /> 团队
                    </span>
                  )}
                </p>
                <p className="text-xs text-neutral-400">{formatDateTime(project.updateTime)}</p>
              </div>
              <ProjectCardMenu project={project} onChanged={loadProjects} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
