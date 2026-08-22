import { ChevronRight } from "lucide-react";
import { skillToolIcon } from "@/components/skill/skill-tool-icon";
import type { SkillVO } from "@/types/skill";

const MAX_VISIBLE_TOOLS = 8;

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
      <div className="ws-tool-shortcuts-head">
        <div>
          <strong id="ws-tool-shortcuts-title">创作与分析</strong>
          <span>生成文件或分析内容</span>
        </div>
        <button type="button" className="ws-tool-shortcuts-all" onClick={onOpenAll}>
          全部工具 <ChevronRight aria-hidden />
        </button>
      </div>

      {skills === null && !failed ? (
        <div className="ws-tool-shortcuts-grid" role="status" aria-label="正在加载快捷工具">
          {Array.from({ length: 8 }, (_, index) => (
            <span key={index} className="ws-tool-shortcut-skeleton" aria-hidden />
          ))}
        </div>
      ) : failed ? (
        <div className="ws-tool-shortcuts-state">
          <span>快捷工具暂未加载</span>
          <button type="button" onClick={onRetry}>重试</button>
        </div>
      ) : visibleSkills.length ? (
        <div className="ws-tool-shortcuts-grid">
          {visibleSkills.map((tool) => {
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
          })}
        </div>
      ) : (
        <div className="ws-tool-shortcuts-state"><span>暂无已启用的快捷工具</span></div>
      )}
    </section>
  );
}
