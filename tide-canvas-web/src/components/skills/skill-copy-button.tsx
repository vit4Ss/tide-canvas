"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, Loader2 } from "lucide-react";
import { toast } from "@/components/shared/toast";
import { copySkillSetup, type SkillCopyFormat } from "@/lib/skill-install-copy";
import type { LibrarySkill } from "@/types/skill-library";
import styles from "./skill-library.module.css";

export function SkillCopyButton({ skill, format = "install", className, label = "复制安装指令" }: {
  skill: LibrarySkill; format?: SkillCopyFormat; className?: string; label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => { active.current?.abort(); active.current = null; }, []);
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(false), 2000); return () => clearTimeout(timer); }, [copied]);
  const copy = async () => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    const timer = setTimeout(() => controller.abort(), 20000);
    setCopied(false);
    setBusy(true);
    try {
      const result = await copySkillSetup(skill, window.location.origin, format, controller.signal);
      if (active.current !== controller) return;
      setCopied(true);
      toast.success(result.includesKey ? (result.keyEnabled ? "已复制，已包含当前账号的 API Key" : "已复制，随附 API Key 当前已停用") : "已复制通用安装内容，登录后可自动附带 API Key");
    } catch (error) {
      if (active.current === controller) toast.error(error instanceof Error ? error.message : "复制失败，请重试");
    } finally {
      clearTimeout(timer);
      if (active.current === controller) { active.current = null; setBusy(false); }
    }
  };
  return <button type="button" className={className} disabled={busy || !skill.installable || (format !== "install" && !skill.mcpEndpoint)} aria-busy={busy} title={skill.unavailableReason} onClick={() => void copy()}>
    {busy ? <Loader2 size={15} className={styles.spinner} /> : copied ? <Check size={15} /> : <Copy size={15} />}
    {busy ? "正在准备…" : copied ? "已复制" : !skill.installable ? "安装包暂不可用" : label}
  </button>;
}
