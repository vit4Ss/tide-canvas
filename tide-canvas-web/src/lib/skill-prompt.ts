import type { SkillVO } from "@/types/skill";

/**
 * Public, user-editable copy shown after a skill is selected.
 *
 * The executable skill template deliberately stays server-side. `howTo` is
 * public catalog guidance, so it is safe to surface in the composer without
 * exposing or duplicating the runtime prompt resolved from `skillId`.
 */
export function visibleSkillPrompt(skill: SkillVO | null | undefined): string {
  if (!skill) return "";
  const howTo = skill.howTo?.replace(/\r\n?/g, "\n").trim() ?? "";
  if (howTo) return howTo;

  // 旧预设通常只有一句话介绍；它是目录营销文案，不应冒充用户任务。
  // 缺少「如何使用」时给出可直接填写的中性骨架，执行模板仍只在服务端解析。
  if (skill.kind === "agent" || skill.outputType === "text" || skill.outputType === "file") {
    return "请描述需要完成的任务：【在这里补充目标、素材和要求】";
  }
  if (skill.outputType === "audio") {
    return "请描述想生成的声音内容：【主题、情绪和声音要求】";
  }
  return "请描述想生成的画面内容：【主体、场景和关键细节】";
}

/**
 * Fill an empty composer when a skill is picked. If the user is switching
 * skills and has not changed the previous skill's starter copy, replace it;
 * otherwise preserve the user's draft.
 */
export function promptAfterSkillPick(
  currentPrompt: string,
  nextSkill: SkillVO,
  previousSkill?: SkillVO | null,
): string {
  const current = currentPrompt.replace(/\r\n?/g, "\n");
  const nextStarter = visibleSkillPrompt(nextSkill);
  if (!nextStarter) return current;

  const previousStarter = visibleSkillPrompt(previousSkill);
  const trimmed = current.trim();
  if (!trimmed || (previousStarter && trimmed === previousStarter)) {
    return nextStarter;
  }
  return current;
}
