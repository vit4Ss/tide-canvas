"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowRight, ImageIcon, Plus } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { projectApi } from "@/lib/api";
import type { ProjectVO } from "@/types/canvas";
import { displayProjectName, formatDateTime } from "@/lib/utils";
import { ProjectCardMenu } from "@/components/project/project-card-menu";

export function RecentProjects() {
  const t = useTranslations("recent");
  const { isLoggedIn, initialized } = useAuth();
  const [projects, setProjects] = useState<ProjectVO[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    projectApi
      .list({ pageNum: 1, pageSize: 5 })
      .then((res) => {
        if (res.success && res.data) setProjects(res.data.records);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (isLoggedIn) load();
  }, [isLoggedIn, load]);

  if (!isLoggedIn || !initialized) return null;

  return (
    <section className="relative z-0 pb-10 pt-4">
      <div className="mx-auto max-w-[1040px] px-4 sm:px-6">
        <div className="flex items-center justify-between">
          <h2 className="text-[17px] font-bold tracking-tight text-neutral-950 dark:text-neutral-50">{t("title")}</h2>
          <Link
            href="/user/projects"
            className="flex items-center gap-1 rounded-full px-3 py-1 text-sm font-medium text-neutral-500 transition-colors hover:bg-white/70 hover:text-neutral-950 dark:text-neutral-400 dark:hover:bg-white/10 dark:hover:text-white"
          >
            {t("all")}
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Link
            href="/canvas/new"
            target="_blank"
            rel="noopener"
            className="flex aspect-[16/9] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-neutral-300/80 bg-white/55 text-neutral-500 transition-all hover:border-neutral-400 hover:bg-white hover:text-neutral-950 hover:shadow-sm dark:border-white/10 dark:bg-white/5 dark:text-neutral-400 dark:hover:bg-white/10 dark:hover:text-white"
          >
            <Plus className="h-7 w-7" />
            <span className="text-sm font-medium">{t("create")}</span>
          </Link>

          {loading ? (
            Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="space-y-3">
                <div className="aspect-[16/9] animate-pulse rounded-2xl bg-white/70 dark:bg-white/8" />
                <div className="h-4 w-2/3 animate-pulse rounded bg-white/70 dark:bg-white/8" />
              </div>
            ))
          ) : (
            projects.slice(0, 5).map((project) => (
              <div key={project.id} className="group min-w-0">
                <Link
                  href={`/canvas/${project.urlToken}`}
                  target="_blank"
                  rel="noopener"
                  className="block overflow-hidden rounded-2xl bg-white shadow-[0_10px_35px_rgba(15,23,42,0.07)] ring-1 ring-black/[0.04] transition-all hover:-translate-y-0.5 hover:shadow-[0_16px_45px_rgba(15,23,42,0.12)] dark:bg-white/8 dark:ring-white/10"
                >
                  <div className="aspect-[16/9] bg-neutral-100 dark:bg-white/5">
                    {project.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={project.thumbnail} alt={project.name} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-neutral-300 dark:text-neutral-600">
                        <ImageIcon className="h-10 w-10" />
                      </div>
                    )}
                  </div>
                </Link>
                <div className="mt-2 flex items-start justify-between gap-2 px-1">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">{displayProjectName(project.name)}</p>
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
