"use client";

import Link from "next/link";
import { useEffect, useState, useRef } from "react";
import { projectApi } from "@/lib/api";
import type { ProjectVO } from "@/types/canvas";
import { Plus, MoreHorizontal, Trash2, ExternalLink, ArrowLeft, FolderPlus } from "lucide-react";
import { formatDateTime, displayProjectName } from "@/lib/utils";

export default function UserProjectsPage() {
  const [projects, setProjects] = useState<ProjectVO[]>([]);
  const [loading, setLoading] = useState(true);
  const [menuOpenId, setMenuOpenId] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadProjects();
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpenId(null);
      }
    };
    if (menuOpenId !== null) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [menuOpenId]);

  const loadProjects = async () => {
    setLoading(true);
    try {
      const res = await projectApi.list({ pageNum: 1, pageSize: 50 });
      if (res.success && res.data) {
        setProjects(res.data.records);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: number) => {
    setMenuOpenId(null);
    if (!confirm("确定要删除该项目吗？")) return;
    const res = await projectApi.delete(id);
    if (res.success) {
      setProjects((prev) => prev.filter((p) => p.id !== id));
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/user" className="rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="text-xl font-bold">全部项目</h1>
        </div>
        <button className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800">
          <FolderPlus className="h-4 w-4" />
          新建文件夹
        </button>
      </div>

      <div className="mt-8 grid grid-cols-2 gap-x-5 gap-y-7 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {/* 开始创作 */}
        <Link href="/canvas/new" className="flex flex-col gap-2">
          <div className="flex aspect-[4/3] flex-col items-center justify-center gap-3 rounded-2xl border border-cyan-200 bg-gradient-to-br from-cyan-50 to-blue-50 transition-all hover:shadow-md dark:border-cyan-900 dark:from-cyan-950/40 dark:to-blue-950/40">
            <Plus className="h-7 w-7 text-cyan-600 dark:text-cyan-400" />
            <span className="text-sm font-medium text-cyan-700 dark:text-cyan-300">开始创作</span>
          </div>
          <div className="px-1">
            <p className="text-sm font-medium">创建新的项目</p>
            <p className="mt-0.5 text-xs text-neutral-400">&nbsp;</p>
          </div>
        </Link>

        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-2">
              <div className="aspect-[4/3] animate-pulse rounded-2xl bg-neutral-100 dark:bg-neutral-800/50" />
              <div className="space-y-1.5 px-1">
                <div className="h-4 w-3/4 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800/50" />
                <div className="h-3 w-1/3 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800/50" />
              </div>
            </div>
          ))
        ) : (
          projects.map((project) => (
            <div key={project.id} className="group flex flex-col gap-2">
              <Link
                href={`/canvas/${project.urlToken}`}
                className="overflow-hidden rounded-2xl bg-neutral-100 transition-all hover:shadow-md dark:bg-neutral-800"
              >
                <div className="aspect-[4/3]">
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
              <div className="flex items-start justify-between gap-2 px-1">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{displayProjectName(project.name)}</p>
                  <p className="mt-0.5 text-xs text-neutral-400">{formatDateTime(project.updateTime)}</p>
                </div>
                <div className="relative" ref={menuOpenId === project.id ? menuRef : null}>
                  <button
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMenuOpenId(menuOpenId === project.id ? null : project.id); }}
                    className="rounded-md p-1 text-neutral-400 opacity-0 transition-opacity hover:bg-neutral-100 hover:text-neutral-600 group-hover:opacity-100 dark:hover:bg-neutral-800"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                  {menuOpenId === project.id && (
                    <div className="absolute right-0 top-7 z-10 w-32 rounded-lg border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
                      <Link href={`/canvas/${project.urlToken}`} className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-800">
                        <ExternalLink className="h-3.5 w-3.5" />
                        打开
                      </Link>
                      <button onClick={() => handleDelete(project.id)} className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30">
                        <Trash2 className="h-3.5 w-3.5" />
                        删除
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {!loading && projects.length === 0 && (
        <div className="mt-20 text-center">
          <p className="text-neutral-400">还没有项目，点击「开始创作」创建第一个</p>
        </div>
      )}
    </div>
  );
}
