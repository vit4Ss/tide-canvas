"use client";

import { ChevronDown } from "lucide-react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { skillToolIcon } from "@/components/skill/skill-tool-icon";
import type { SkillVO } from "@/types/skill";
import { visibleShortcutCount } from "./tool-skill-shortcuts-layout";

const LOADING_SKELETONS = 4;

export function ToolSkillShortcuts({
  skills,
  failed,
  onPick,
  onRetry,
  onOpenAll,
  currentId,
}: {
  skills: SkillVO[] | null;
  failed: boolean;
  onPick: (skill: SkillVO) => void;
  onRetry: () => void;
  onOpenAll: () => void;
  currentId?: string;
}) {
  const [visibleCount, setVisibleCount] = useState(0);
  const rowRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLHeadingElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const toolRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const measure = useCallback(() => {
    const row = rowRef.current;
    const label = labelRef.current;
    const more = moreRef.current;
    if (!row || !label || !more || !skills?.length) {
      setVisibleCount(0);
      return;
    }
    const styles = getComputedStyle(row);
    const gap = Number.parseFloat(styles.columnGap || styles.gap) || 0;
    const next = visibleShortcutCount(
      row.clientWidth,
      label.offsetWidth,
      more.offsetWidth,
      skills.map((_, index) => toolRefs.current[index]?.offsetWidth ?? 0),
      gap,
    );
    setVisibleCount((current) => current === next ? current : next);
  }, [skills]);

  useLayoutEffect(() => {
    toolRefs.current.length = skills?.length ?? 0;
    measure();
    const row = rowRef.current;
    if (!row || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    if (labelRef.current) observer.observe(labelRef.current);
    if (moreRef.current) observer.observe(moreRef.current);
    for (const button of toolRefs.current) if (button) observer.observe(button);
    return () => observer.disconnect();
  }, [measure, skills]);

  return (
    <section className="ws-tool-shortcuts" aria-labelledby="ws-tool-shortcuts-title">
      <div ref={rowRef} className="ws-tool-shortcuts-row">
        <h3 ref={labelRef} id="ws-tool-shortcuts-title" className="ws-tool-shortcuts-label">为你推荐</h3>

        {skills === null && !failed ? (
          <div className="ws-tool-shortcuts-loading" role="status" aria-label="正在加载快捷工具">
            {Array.from({ length: LOADING_SKELETONS }, (_, index) => (
              <span key={index} className="ws-tool-shortcut-skeleton" aria-hidden />
            ))}
          </div>
        ) : failed ? (
          <button type="button" className="ws-tool-shortcuts-state" onClick={onRetry}>
            加载失败，重试
          </button>
        ) : skills?.length ? (
          skills.map((tool, index) => {
            const ToolIcon = skillToolIcon(tool.title);
            const hidden = index >= visibleCount;
            return (
              <button
                ref={(element) => { toolRefs.current[index] = element; }}
                key={tool.id}
                type="button"
                className={`ws-tool-shortcut${currentId === tool.id ? " on" : ""}${hidden ? " measure-only" : ""}`}
                title={tool.description || tool.title}
                aria-pressed={currentId === tool.id}
                aria-hidden={hidden || undefined}
                tabIndex={hidden ? -1 : undefined}
                onClick={() => onPick(tool)}
              >
                <ToolIcon aria-hidden />
                <span>{tool.title}</span>
              </button>
            );
          })
        ) : (
          <span className="ws-tool-shortcuts-empty">暂无快捷工具</span>
        )}

        <button ref={moreRef} type="button" className="ws-tool-shortcuts-all" onClick={onOpenAll}>
          更多技能 <ChevronDown aria-hidden />
        </button>
      </div>
    </section>
  );
}
