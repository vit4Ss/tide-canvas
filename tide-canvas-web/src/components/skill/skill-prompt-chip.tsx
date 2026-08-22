"use client";

import clsx from "clsx";
import { Sparkles, X } from "lucide-react";
import { SkillToolGlyph } from "@/components/skill/skill-tool-icon";
import type { SkillVO } from "@/types/skill";
import styles from "./skill-prompt-chip.module.css";

export function SkillPromptChip({
  skill,
  onRemove,
  className,
}: {
  skill: SkillVO;
  onRemove: () => void;
  className?: string;
}) {
  return (
    <span className={clsx(styles.root, className)} title={skill.description || skill.title}>
      {skill.kind === "tool"
        ? <SkillToolGlyph title={skill.title} aria-hidden className={styles.icon} />
        : <Sparkles aria-hidden className={styles.icon} />}
      <span className={styles.label}>{skill.title}</span>
      <button
        type="button"
        className={styles.remove}
        onClick={onRemove}
        aria-label={`移除技能：${skill.title}`}
        title="移除技能"
      >
        <X aria-hidden />
      </button>
    </span>
  );
}
