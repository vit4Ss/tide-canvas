import { ChevronDown } from "lucide-react";
import { skillToolIcon } from "@/components/skill/skill-tool-icon";
import type { SkillVO } from "@/types/skill";

const MAX_VISIBLE_TOOLS = 3;

export function ToolSkillShortcuts({
  skills,
  failed,
  onPick,
  onRetry,
  onOpenAll,
}: {
  skills: SkillVO[] | null;
  failed: boolean;
  onPick: (skill: SkillVO) => void;
  onRetry: () => void;
  onOpenAll: () => void;
}) {
  const visibleSkills = skills?.slice(0, MAX_VISIBLE_TOOLS) ?? [];

  return (
    <section className="ws-tool-shortcuts" aria-labelledby="ws-tool-shortcuts-title">
      <div className="ws-tool-shortcuts-row">
        <h3 id="ws-tool-shortcuts-title" className="ws-tool-shortcuts-label">为你推荐</h3>

        {skills === null && !failed ? (
          <div className="ws-tool-shortcuts-loading" role="status" aria-label="正在加载快捷工具">
            {Array.from({ length: MAX_VISIBLE_TOOLS }, (_, index) => (
              <span key={index} className="ws-tool-shortcut-skeleton" aria-hidden />
            ))}
          </div>
        ) : failed ? (
          <button type="button" className="ws-tool-shortcuts-state" onClick={onRetry}>
            加载失败，重试
          </button>
        ) : visibleSkills.length ? (
          visibleSkills.map((tool) => {
            const ToolIcon = skillToolIcon(tool.title);
            return (
              <button
                key={tool.id}
                type="button"
                className="ws-tool-shortcut"
                title={tool.description || tool.title}
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

        <button type="button" className="ws-tool-shortcuts-all" onClick={onOpenAll}>
          更多技能 <ChevronDown aria-hidden />
        </button>
      </div>
    </section>
  );
}
