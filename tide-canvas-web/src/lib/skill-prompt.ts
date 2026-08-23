import type { SkillVO } from "@/types/skill";

function toolStarterPrompt(title: string): string {
  if (title.includes("PPT")) {
    return "制作一份关于【主题】的商业级 PPT，面向【目标受众】，希望受众最终【理解、相信或决定什么】，约 10 页。请结合我上传的参考图和资料，提炼具体内容、构图与配色。";
  }
  if (title.includes("XLSX") || title.includes("Excel")) {
    return "制作一份用于【业务用途】的 Excel 工作簿，包含【字段与数据】，按照【统计口径】计算，并提供【需要的汇总或公式】。请结合我上传的表格和资料。";
  }
  if (title.includes("Word")) {
    return "撰写一份关于【主题】的专业 Word 文档，面向【阅读对象】，用于【阅读后要理解或决定什么】，包含【必须覆盖的事实、结构和结论】。请结合我上传的资料。";
  }
  if (title.includes("Markdown")) {
    return "生成一份可直接发布的【文档类型】Markdown，主题是【主题】，面向【读者】，包含【章节、步骤、示例或代码要求】。请结合我上传的资料。";
  }
  if (title.includes("视频")) {
    return "分析这段视频，提供带时间码的转写与关键帧证据，并重点评估【内容主题、叙事结构、镜头节奏和改进方向】。";
  }
  if (title.includes("音频")) {
    return "分析这段音频，提供带时间码和说话人标签的转写，并提取【主题、决定、负责人、期限和待复核内容】。";
  }
  if (title.includes("网页")) {
    return "分析这个网页：【粘贴公开网页地址】，围绕【具体问题】整理页面主张、证据、含义、风险和缺失信息。";
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
