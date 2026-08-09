/* 提示词区（字数标签 + 技能 chip + @ 引用编辑器 + AI 优化/技能入口 + 灵感提示词）—
   从 create-studio.tsx 抽出（纯移动，无逻辑改动）。父组件负责外层显隐条件
   （自定义歌词/延长/翻唱模式下整块隐藏）。 */

import type { RefObject } from "react";
import {
  MentionPromptEditor,
  buildMentionRefs,
  type MentionEditorHandle,
} from "@/components/studio/mention-prompt-editor";
import { SkillPromptChip } from "@/components/skill/skill-prompt-chip";
import type { SkillVO } from "@/types/skill";

export function PromptSection({
  prompt,
  onPromptChange,
  promptRef,
  mentionRefs,
  placeholder,
  skill,
  onRemoveSkill,
  optimizing,
  optCost,
  onOptimize,
  onOpenSkillPicker,
  ideaOpts,
  allowSkills = true,
  label = "提示词",
}: {
  prompt: string;
  onPromptChange: (v: string) => void;
  promptRef: RefObject<MentionEditorHandle | null>;
  mentionRefs: ReturnType<typeof buildMentionRefs>;
  placeholder: string;
  skill: SkillVO | null;
  onRemoveSkill: () => void;
  optimizing: boolean;
  optCost: number;
  onOptimize: () => void;
  onOpenSkillPicker: () => void;
  ideaOpts: string[];
  allowSkills?: boolean;
  label?: string;
}) {
  return (
    <>
      <div className="ws-seclabel">
        {label}{" "}
        <span className="ws-pcount">
          <b id="pLen">{prompt.length}</b> 字
        </span>
      </div>
      <div className="ws-promptbox">
        <div className="ws-prompt-main">
          {skill && (
            <SkillPromptChip
              skill={skill}
              onRemove={onRemoveSkill}
              className="ws-inline-skill"
            />
          )}
          {/* 富文本提示词框：有参考素材时输入 @ 引用（图片N pill），Enter 保持换行 */}
          <MentionPromptEditor
            ref={promptRef}
            id="prompt"
            className="ws-prompt"
            value={prompt}
            onChange={onPromptChange}
            refs={mentionRefs}
            placeholder={placeholder}
            submitOnEnter={false}
          />
        </div>
        <div className="ws-prompt-foot">
          <button className="ws-aiopt" type="button" onClick={onOptimize} disabled={optimizing}>
            <span className="spark">✦</span>{" "}
            {optimizing ? "优化中…" : optCost > 0 ? `AI 优化 · ${optCost} 积分` : "AI 优化"}
          </button>
          {allowSkills && (
            <button className="ws-aiopt" type="button" onClick={onOpenSkillPicker}>
              <span className="spark">✧</span> {skill ? "更多技能 · 1" : "使用技能"}
            </button>
          )}
          {/* 提示词「清空」按钮已按用户要求移除（2026-07-08）：全选删除足够 */}
        </div>
      </div>

      {/* idea chips (only when the model configures 灵感提示词) */}
      {ideaOpts.length > 0 && (
        <>
          <div className="ws-chips-head">灵感提示词 · 点击填入</div>
          <div className="ws-chips" id="ideas">
            {ideaOpts.map((t) => (
              <button key={t} type="button" onClick={() => onPromptChange(t)}>
                {t.length > 10 ? t.slice(0, 10) + "…" : t}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}
