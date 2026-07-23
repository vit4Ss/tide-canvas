"use client";

/* ============================================================================
   NodeSkillButton — 画布节点(图片/视频)的技能入口。

   形态对齐 ImageStylePicker 的触发按钮(12×12 方钮,图标+短名回显);点开
   共享 SkillPicker(按节点模态过滤),选中把 skillId/skillName/skillPrompt
   写回节点(随画布持久化,重开项目仍生效);已选时角标 × 可移除。
   参数/模型应用交由节点回调(各节点自己的状态形态不同)。
   ========================================================================== */

import { useState } from "react";
import { Sparkles, X } from "lucide-react";
import { useCanvasStore, type CanvasNode } from "@/stores/use-canvas-store";
import { SkillPicker } from "@/components/skill/skill-picker";
import type { SkillVO } from "@/types/skill";

interface Props {
  node: CanvasNode;
  /** 节点模态(image/video),技能广场按此过滤 */
  outputType: string;
  /** 选中后的附加应用(切模型/回填参数),由节点实现 */
  onPicked?: (skill: SkillVO) => void;
}

export function NodeSkillButton({ node, outputType, onPicked }: Props) {
  const updateNode = useCanvasStore((s) => s.updateNode);
  const [open, setOpen] = useState(false);
  const hasSkill = !!node.skillId;

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  const pick = (s: SkillVO) => {
    updateNode(node.id, { skillId: s.id, skillName: s.title, skillPrompt: s.promptTemplate });
    setOpen(false);
    onPicked?.(s);
  };

  const clear = (e: React.MouseEvent) => {
    stop(e);
    updateNode(node.id, { skillId: undefined, skillName: undefined, skillPrompt: undefined });
  };

  return (
    <div className="relative" onMouseDown={stop}>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        title={hasSkill ? `技能：${node.skillName}` : "使用技能"}
        onClick={(e) => { stop(e); setOpen(true); }}
        className={`flex h-12 w-12 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg border text-[11px] leading-tight transition-colors ${
          hasSkill
            ? "border-neutral-950 bg-neutral-950 text-white shadow-sm dark:border-white dark:bg-white dark:text-neutral-950"
            : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
        }`}
      >
        <Sparkles className="h-3.5 w-3.5" />
        <span className="max-w-9 truncate text-[10px] leading-none">{hasSkill ? node.skillName : "技能"}</span>
      </button>
      {/* 已选:角标移除(不打开弹层直接摘除) */}
      {hasSkill && (
        <button
          type="button"
          aria-label="移除技能"
          title="移除技能"
          onMouseDown={stop}
          onClick={clear}
          className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-500 shadow-sm transition-colors hover:text-neutral-900 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
        >
          <X className="h-2.5 w-2.5" />
        </button>
      )}
      <SkillPicker
        open={open}
        onClose={() => setOpen(false)}
        onPick={pick}
        outputType={outputType}
        currentId={node.skillId}
      />
    </div>
  );
}
