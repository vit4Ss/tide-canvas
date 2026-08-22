import { skillKindOf, type SkillVO } from "@/types/skill";

const BUILTIN_TOOL_COVERS: Readonly<Record<string, string>> = {
  "生成 PPT": "/skill-covers/tool-pptx.webp",
  "生成 XLSX": "/skill-covers/tool-xlsx.webp",
  "生成 Word": "/skill-covers/tool-docx.webp",
  "生成 Markdown": "/skill-covers/tool-markdown.webp",
  "视频分析": "/skill-covers/tool-video-analysis.webp",
  "音频分析": "/skill-covers/tool-audio-analysis.webp",
  "网页分析": "/skill-covers/tool-web-analysis.webp",
};

/** Admin-configured covers always win. Built-in bitmap fallbacks only fill the
 * seven official tool seeds whose catalog rows predate cover generation. */
export function skillCoverUrl(skill: Pick<SkillVO, "coverUrl" | "kind" | "title">): string {
  const configured = skill.coverUrl?.trim();
  if (configured) return configured;
  if (skillKindOf(skill) !== "tool") return "";
  return BUILTIN_TOOL_COVERS[skill.title] ?? "";
}
