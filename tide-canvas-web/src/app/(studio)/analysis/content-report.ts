export interface ContentTakeaway {
  key: "summary" | "hook" | "reuse";
  label: string;
  text: string;
}

export interface ReportMoment {
  start: number;
  end: number;
  time: string;
  title: string;
  text: string;
}

const groups = [
  { key: "summary", label: "一句话看懂", heading: /一句话看懂|核心主题|内容概述|视频概述|作品概述|内容总结/ },
  { key: "hook", label: "开场抓手", heading: /开场钩子|开头.*钩子|开场抓手|视觉焦点|视觉主体/ },
  { key: "reuse", label: "值得借鉴", heading: /值得借鉴|可复用|复用方法|创作建议|下一步建议/ },
] as const;
const timelineHeading = /节奏时间线|叙事结构|镜头节奏|分段拆解|视频结构|时间码分析|开场钩子|开头.*钩子/;
const clockPattern = /(?<![\d:：])\d{1,3}[:：]\d{2}(?:[:：]\d{2})?(?:\.\d{1,3})?(?![\d:：])/g;
const transcriptHeading = /转写|转录|逐字稿|完整文案|文案全文|字幕|台词/;

function plain(value: string): string {
  return value.replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]*>/g, "").replace(/[*_`]/g, "")
    .replace(/^\s*(?:[-+>]\s+|\d+[.)、]\s*)/, "").trim();
}

function seconds(value: string): number | null {
  const parts = value.replaceAll("：", ":").split(":").map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some(n => !Number.isFinite(n) || n < 0)
    || parts.at(-1)! >= 60 || (parts.length === 3 && parts[1] >= 60)) return null;
  const total = parts.reduce((sum, n) => sum * 60 + n, 0);
  return total <= 86400 ? total : null;
}

function paragraphs(lines: string[]): string[] {
  // Soft line breaks still belong to the same conclusion. Preserve the whole
  // compact paragraph so a later "but / cannot confirm" sentence is not lost.
  return lines.join("\n").split(/\n\s*\n/).map(block => block.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean);
}

// This is a local view of existing report sentences, never a second AI call.
// Unknown/old formats remain available in the complete report.
export function parseContentReport(markdown: string, image = false): { takeaways: ContentTakeaway[]; moments: ReportMoment[] } {
  const sections: Array<{ heading: string; title: string; lines: string[] }> = [];
  let heading = "", codeFence = "";
  const headingStack: Array<{ level: number; label: string }> = [];
  for (const raw of markdown.slice(0, 120_000).split(/\r?\n/)) {
    const fence = raw.match(/^\s*(`{3,}|~{3,})/);
    if (fence) { if (!codeFence) codeFence = fence[1][0]; else if (fence[1][0] === codeFence) codeFence = ""; continue; }
    if (codeFence || /^\s*[-=_]{3,}\s*$/.test(raw)) continue;
    const clean = plain(raw).replace(/^#{1,6}\s*/, "");
    if (!clean) { sections.at(-1)?.lines.push(""); continue; }
    const label = clean.replace(/[：:]$/, "");
    const inline = clean.match(/^(一句话看懂|核心主题|内容概述|视频概述|作品概述|开场钩子|开场抓手|视觉焦点|值得借鉴|复用方法|下一步建议)[：:]\s*(.+)$/);
    if (inline) {
      heading = inline[1];
      headingStack.length = 0;
      headingStack.push({ level: 2, label: heading });
      sections.push({ heading, title: heading, lines: [inline[2]] });
      continue;
    }
    const explicitHeading = raw.match(/^\s*(#{1,6})\s+/);
    const shortLabel = /^(?:\d+[.、)）]\s*|[一二三四五六七八九十]+[、.：]\s*)?(一句话看懂|核心主题|内容概述|视频概述|作品概述|内容总结|开场钩子|开头\s*3\s*秒钩子|开场抓手|视觉焦点|视觉主体|值得借鉴|可复用方法|复用方法|创作建议|下一步建议|节奏时间线|叙事结构|镜头节奏|分段拆解|视频结构|时间码分析|完整分析|完整文案|转写|逐字稿|事实|推断)$/.test(label);
    if (explicitHeading || shortLabel) {
      // Retain structural parents for legacy time-range subheads. An unrelated
      // heading at the same level must end that section, not inherit its label.
      const level = explicitHeading ? explicitHeading[1].length : /^(事实|推断)$/.test(label) ? 3 : 2;
      while (headingStack.length && headingStack.at(-1)!.level >= level) headingStack.pop();
      headingStack.push({ level, label });
      heading = headingStack.map(item => item.label).join(" · ");
      sections.push({ heading, title: label, lines: [] });
      continue;
    }
    if (!sections.length) sections.push({ heading, title: "", lines: [] });
    if (/^\s*(?:[-+*]\s+|\d+[.)、]\s*)/.test(raw)) sections.at(-1)!.lines.push("");
    sections.at(-1)!.lines.push(clean);
  }
  const takeaways: ContentTakeaway[] = [];
  const used = new Set<string>();
  for (const group of groups) {
    const candidates = sections.filter(s => group.heading.test(s.heading) && !transcriptHeading.test(s.heading))
      .flatMap(s => paragraphs(s.lines).map(text => ({ text, heading: s.heading })));
    for (const candidate of candidates) {
      if (candidate.text.startsWith("|") || /https?:\/\//.test(candidate.text)) continue;
      // Legacy reports often put uncertainty in the subheading rather than in
      // the sentence. Keep that label when moving its text into the brief.
      const qualification = /待验证|假设/.test(candidate.heading) ? "待验证：" : /推断|推测/.test(candidate.heading) ? "推断：" : "";
      const text = qualification && !/^(?:待验证|假设|推断|推测)[：:]/.test(candidate.text)
        ? qualification + candidate.text : candidate.text;
      if (text.length < 8 || text.length > 200 || used.has(text)) continue;
      takeaways.push({ key: group.key, label: image && group.key === "hook" ? "视觉焦点" : group.label, text });
      used.add(text);
      break;
    }
  }
  const moments: ReportMoment[] = [];
  if (!image) for (const section of sections.filter(s => timelineHeading.test(s.heading) && !transcriptHeading.test(s.heading))) {
    for (const [index, line] of [section.title, ...section.lines].entries()) {
      if (/https?:\/\//.test(line)) continue;
      const times = [...line.matchAll(clockPattern)];
      if (times.length < 2) continue;
      const between = line.slice(times[0].index! + times[0][0].length, times[1].index);
      // Explicit range separators or adjacent table cells only. Two timestamps
      // mentioned independently in prose do not define a continuous segment.
      if (!/^\s*(?:[-—–~～至到]+|\|)\s*$/.test(between) || /[-−]\s*$/.test(line.slice(0, times[0].index))) continue;
      const start = seconds(times[0][0]), end = seconds(times[1][0]);
      if (start === null || end === null || end <= start) continue;
      const suffix = line.slice(times[1].index! + times[1][0].length).replace(/^[\s|\]）)】—–:：-]+/, "");
      const cells = suffix.split("|").map(s => plain(s)).filter(Boolean);
      if (!cells.length) continue;
      const discovery = index === 0 ? paragraphs(section.lines).find(p => !p.startsWith("|") && !/https?:\/\//.test(p)) : "";
      const title = !!discovery || cells.length > 1 ? cells[0] : "片段发现";
      const text = discovery || (cells.length > 1 ? cells.slice(1).join(" · ") : cells[0]);
      if (title.length > 80 || text.length > 400 || !text || moments.some(m => m.start === start && m.end === end)) continue;
      moments.push({ start, end, time: `${times[0][0]} — ${times[1][0]}`, title, text });
    }
  }
  return { takeaways, moments: moments.sort((a, b) => a.start - b.start || a.end - b.end).slice(0, 8) };
}

export const CONTENT_REPORT_FORMAT = "先给普通创作者三个简短板块：## 一句话看懂、## 开场钩子、## 值得借鉴，每个只写一句不超过 70 字的完整结论，保留推测限定语。然后输出 ## 节奏时间线，使用表格：开始时间 | 结束时间 | 片段 | 关键发现，最多 8 行，时间用 MM:SS 或 HH:MM:SS。只记录在真实视频中核实的时间区间，不得从标题、简介或时长猜测镜头和文案；无法核实就说明没有时间码，不填造数据。最后在 ## 完整分析 中保留完整转写、时间码依据与详细方法。不要编造完播率、留存率、评分或情绪数值。";
