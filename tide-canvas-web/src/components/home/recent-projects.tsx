"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/hooks/use-auth";
import { projectApi } from "@/lib/api";
import type { ProjectVO } from "@/types/canvas";
import { Plus, ArrowRight } from "lucide-react";
import { formatDateTime, displayProjectName } from "@/lib/utils";
import { ProjectCardMenu } from "@/components/project/project-card-menu";

export function RecentProjects() {
  const t = useTranslations("recent");
  const { isLoggedIn, initialized } = useAuth();
  const [projects, setProjects] = useState<ProjectVO[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    projectApi.list({ pageNum: 1, pageSize: 4 }).then((res) => {
      if (res.success && res.data) setProjects(res.data.records);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (isLoggedIn) load();
  }, [isLoggedIn, load]);

  if (!isLoggedIn || !initialized) return null;

  return (
    <section className="py-12">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold">{t("title")}</h2>
          <Link
            href="/user/projects"
            className="flex items-center gap-1 text-sm font-medium text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white"
          >
            {t("all")}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="mt-6 grid gap-5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
          {/* 开始创作卡片 */}
          <Link
            href="/canvas/new"
            className="flex aspect-video flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 text-neutral-500 transition-colors hover:border-violet-300 hover:bg-violet-50 hover:text-violet-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:border-violet-500/40 dark:hover:bg-violet-500/10"
          >
            <Plus className="h-7 w-7" />
            <span className="text-sm font-medium">{t("create")}</span>
          </Link>

          {loading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex flex-col gap-3">
                <div className="aspect-video animate-pulse rounded-2xl bg-neutral-100 dark:bg-neutral-800/50" />
                <div className="space-y-1.5">
                  <div className="h-4 w-3/4 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800/50" />
                  <div className="h-3 w-1/3 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800/50" />
                </div>
              </div>
            ))
          ) : (
            projects.map((project) => (
              <div key={project.id} className="group flex flex-col gap-3">
                <Link
                  href={`/canvas/${project.urlToken}`}
                  className="overflow-hidden rounded-2xl bg-neutral-100 transition-all hover:shadow-md dark:bg-neutral-800"
                >
                  <div className="aspect-video">
                    {project.thumbnail ? (
                      <img src={project.thumbnail} alt={project.name} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-neutral-300 dark:text-neutral-600">
                        <svg className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                      </div>
                    )}
                  </div>
                </Link>
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{displayProjectName(project.name)}</p>
                    <p className="mt-0.5 text-xs text-neutral-400">{formatDateTime(project.updateTime)}</p>
                  </div>
                  <ProjectCardMenu project={project} onChanged={load} />
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
