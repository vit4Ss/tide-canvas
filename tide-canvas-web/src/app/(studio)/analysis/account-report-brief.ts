export interface AccountReportBrief {
  key: "position" | "strength" | "action";
  label: string;
  text: string;
}

const GROUPS = [
  { key: "position", label: "一句话定位", headings: /一句话定位|核心定位|账号定位|价值主张|定位总结/, preferred: /一句话定位|价值主张|推断/ },
  { key: "strength", label: "值得借鉴", headings: /值得借鉴|内容特点|内容支柱|爆款差异|优势|值得研究|表现差异|可复用/, preferred: /值得借鉴|内容特点|可复用/ },
  { key: "action", label: "下一步建议", headings: /下一步|下一轮|行动建议|创作建议|测试建议|选题建议|内容建议|测试计划|优先行动/, preferred: /下一步|下一轮|优先行动/ },
] as const;

const PLAIN_HEADING = /^(?:\d+[.、]\s*)?(?:一句话定位|核心定位|账号定位|定位总结|值得借鉴|内容特点|内容支柱|爆款差异|优势|表现差异|可复用方法|下一步建议|下一轮内容建议|行动建议|创作建议|测试建议|选题建议|内容建议|测试计划|优先行动|事实|推断|事实依据|推断受众|价值主张|目标受众|待验证假设)$/;

function plainText(value: string): string {
  return value.replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]*>/g, "").replace(/[*_`]/g, "")
    .replace(/^\s*(?:[-+>]\s+|\d+[.)、]\s*)/, "").trim();
}

// Extract existing sentences rather than inventing a second AI interpretation.
// New reports use these three headings; legacy reports retain their qualifiers.
export function extractAccountReportBrief(markdown: string): AccountReportBrief[] {
  const sections: Array<{ heading: string; lines: string[] }> = [];
  let context = "", heading = "", inCode = false;
  for (const raw of markdown.slice(0, 120_000).split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(raw)) { inCode = !inCode; continue; }
    if (inCode || /^\s*\|/.test(raw) || /^\s*[-=_]{3,}\s*$/.test(raw)) continue;
    const clean = plainText(raw).replace(/^#{1,6}\s*/, "").replace(/[：:]$/, "");
    if (!clean) continue;
    const inline = clean.match(/^([^：:]{2,24})[：:]\s*(.+)$/);
    // Only strip a real section label. A sentence such as “下一步不建议…：”
    // carries meaning before the colon and must not lose that qualification.
    if (inline && PLAIN_HEADING.test(inline[1]) && GROUPS.some(group => group.headings.test(inline[1]))) {
      context = inline[1]; heading = context;
      sections.push({ heading, lines: [inline[2]] });
      continue;
    }
    // AI reports often emphasize an entire conclusion in bold. Formatting
    // alone does not make it a heading, even when the sentence has no full stop.
    const boldHeading = /^\s*\*\*[^*\n]+\*\*\s*[:：]?\s*$/.test(raw)
      && clean.length <= 40 && !/[。！？!?，,；;]/.test(clean)
      && (/^\s*\*\*\d+[.)、]/.test(raw) || /(?:定位|支柱|优势|差异|方法|建议|受众|节奏|依据|假设|方向|策略|计划|分析|总结|作品)$/.test(clean));
    const isHeading = /^\s*#{1,6}\s+/.test(raw) || boldHeading
      || PLAIN_HEADING.test(clean);
    if (isHeading) {
      if (/^(事实|推断|事实依据|推断受众|价值主张|待验证假设)$/.test(clean)) heading = `${context} · ${clean}`;
      else if (context && /^\s*(?:#{3,}\s+|\*\*\d+[.)、])/.test(raw) && !GROUPS.some(group => group.headings.test(clean))) heading = `${context} · ${clean}`;
      else { context = clean; heading = clean; }
      sections.push({ heading, lines: [] });
      continue;
    }
    if (!sections.length) sections.push({ heading, lines: [] });
    const text = plainText(raw);
    if (text) sections.at(-1)!.lines.push(text);
  }
  const used = new Set<string>();
  return GROUPS.flatMap(group => {
    const candidates = sections.filter(section => group.headings.test(section.heading) && section.lines.length)
      .sort((a, b) => Number(group.preferred.test(b.heading)) - Number(group.preferred.test(a.heading)));
    for (const candidate of candidates) {
      for (const line of candidate.lines) {
        if (/^(?:代表作品|示例|例如)[：:]|https?:\/\//.test(line)) continue;
        // A whole opening sentence keeps negation and uncertainty intact. Very
        // long passages remain available in the full report instead of a cut-off claim.
        const sentence = line.match(/^[\s\S]*?[。！？!?](?:[”」])?/)?.[0] || line;
        if (sentence.length < 8 || sentence.length > 200 || used.has(sentence)) continue;
        used.add(sentence);
        return [{ key: group.key, label: group.label, text: sentence }];
      }
    }
    return [];
  });
}
