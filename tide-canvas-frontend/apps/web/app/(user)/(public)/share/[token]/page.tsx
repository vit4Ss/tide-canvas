"use client";

import { useParams } from "next/navigation";
import { Eye } from "lucide-react";
import { BrandMark } from "@/components/shared/brand-mark";
import Link from "next/link";

export default function SharePage() {
  const params = useParams();
  const token = params.token as string;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2">
            <BrandMark className="h-8 w-8" />
            <span className="text-lg font-bold">TideCanvas</span>
          </Link>
          <span className="text-sm text-neutral-400">|</span>
          <div className="flex items-center gap-1.5 text-sm text-neutral-500">
            <Eye className="h-4 w-4" />
            只读模式
          </div>
        </div>
        <Link
          href="/register"
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900"
        >
          免费注册
        </Link>
      </div>

      <div className="mt-8 flex h-[70vh] items-center justify-center rounded-2xl border-2 border-dashed border-neutral-300 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900">
        <div className="text-center">
          <p className="text-neutral-400">分享画布查看器</p>
          <p className="mt-2 text-sm text-neutral-400">Token: {token}</p>
          <p className="mt-4 text-xs text-neutral-400">后端接通后将展示画布内容</p>
        </div>
      </div>
    </div>
  );
}
