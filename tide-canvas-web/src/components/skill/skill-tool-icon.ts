import {
  AudioLines,
  Braces,
  FileText,
  Globe2,
  Presentation,
  Table2,
  Video,
  WandSparkles,
  type LucideIcon,
} from "lucide-react";

/** Keep tool icons consistent between the creation panel and the full tools hub. */
export function skillToolIcon(title: string): LucideIcon {
  if (title.includes("PPT")) return Presentation;
  if (title.includes("XLSX") || title.includes("Excel")) return Table2;
  if (title.includes("Word")) return FileText;
  if (title.includes("Markdown")) return Braces;
  if (title.includes("视频")) return Video;
  if (title.includes("音频")) return AudioLines;
  if (title.includes("网页")) return Globe2;
  return WandSparkles;
}
