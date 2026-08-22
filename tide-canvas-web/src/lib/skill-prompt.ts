import type { SkillVO } from "@/types/skill";

function toolStarterPrompt(title: string): string {
  if (title.includes("PPT")) {
    return "制作一份【主题】PPT，面向【目标受众】，重点介绍【主要内容】，约 10 页。";
  }
  if (title.includes("XLSX") || title.includes("Excel")) {
    return "制作一份【用途】Excel 表格，包含【字段和数据】，并按照【统计口径】整理。";
  }
  if (title.includes("Word")) {
    return "撰写一份【主题】Word 文档，面向【阅读对象】，包含【结构和重点内容】。";
  }
  if (title.includes("Markdown")) {
    return "生成一份【主题】Markdown 文档，包含【章节结构和重点内容】。";
  }
  if (title.includes("视频")) {
    return "分析这段视频，完成内容转写，并总结【主题、叙事结构和关键信息】。";
  }
  if (title.includes("音频")) {
    return "分析这段音频，完成内容转写，并提取【主题、说话人和行动项】。";
  }
  if (title.includes("网页")) {
    return "分析这个网页：【粘贴公开网页地址】，重点总结【核心观点、论据和风险】。";
  }
  return "请描述需要完成的任务：【目标、素材和具体要求】";
}

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

  if (skill.kind === "tool") return toolStarterPrompt(skill.title);

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
