"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { projectApi } from "@/lib/api";

export default function NewCanvasPage() {
  const router = useRouter();
  const [creating, setCreating] = useState(true);
  // 防止 React 严格模式(开发环境)下 effect 双调用导致创建两个项目
  const createdRef = useRef(false);

  useEffect(() => {
    if (createdRef.current) return;
    createdRef.current = true;
    const create = async () => {
      try {
        const res = await projectApi.create({
          name: "未命名项目",
        });
        if (res.success) {
          router.replace(`/canvas/${res.data.urlToken}`);
          return;
        }
      } catch {
        // ignore
      }
      setCreating(false);
    };
    create();
  }, [router]);

  if (creating) {
    return (
      <div className="flex h-[calc(100vh-8rem)] items-center justify-center">
        <div className="text-center">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-[3px] border-indigo-100 border-t-indigo-600 dark:border-indigo-500/20 dark:border-t-indigo-400" />
          <p className="mt-4 animate-pulse text-sm text-neutral-500">正在创建项目...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] items-center justify-center">
      <p className="text-neutral-500">创建失败，请重试</p>
    </div>
  );
}
