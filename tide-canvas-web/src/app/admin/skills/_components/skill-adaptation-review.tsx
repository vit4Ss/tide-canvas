"use client";

import { AdminAlert } from "@/components/admin";
import type { AdminSkillImportSource } from "@/types/admin-skill";

export function SkillAdaptationReview({ source, document, onReview, disabled = false }: {
  source: AdminSkillImportSource;
  document?: string;
  onReview?: (reviewed: boolean) => void;
  disabled?: boolean;
}) {
  const { report } = source;
  return <div className="adm-skill-adaptation-review">
    <AdminAlert tone={report.status === "partial" ? "warning" : "info"} title={report.status === "partial" ? "部分适配 · 请确认能力变化" : "本站适配方案"}>
      <p style={{ margin: 0 }}>{report.summary}</p>
      {report.replacements.length > 0 && <>
        <p><strong>已改接本站</strong></p>
        <ul>{report.replacements.map((item, index) => <li key={index}>{item.from} → {item.to} <code>{item.handler}</code></li>)}</ul>
      </>}
      {report.removed.length > 0 && <>
        <p><strong>不再提供</strong></p>
        <ul>{report.removed.map((item, index) => <li key={index}><strong>{item.feature}</strong>：{item.reason}</li>)}</ul>
      </>}
      {report.limitations.length > 0 && <>
        <p><strong>使用限制</strong></p>
        <ul>{report.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul>
      </>}
    </AdminAlert>
    <div style={{ display: "grid", gap: 8, marginTop: 12, overflowWrap: "anywhere" }}>
      {document && <details>
        <summary>查看实际执行的适配版 SKILL.md</summary>
        <textarea aria-label="适配版 Skill 正文" readOnly rows={12} value={document} style={{ width: "100%", marginTop: 8 }} />
      </details>}
      <details>
        <summary>原始文本文件留档（{source.files.length} 个，不参与执行）</summary>
        {source.files.map(file => <details key={file.path} style={{ marginTop: 8 }}>
          <summary>{file.path}</summary>
          <textarea aria-label={`原始文件 ${file.path}`} readOnly rows={8} value={file.content} style={{ width: "100%", marginTop: 8 }} />
        </details>)}
      </details>
      {onReview && <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 8 }}>
        <input type="checkbox" checked={source.reviewed} disabled={disabled} onChange={event => onReview(event.target.checked)} />
        <span>我已核对适配版内容、替换项和移除项，按此能力导入</span>
      </label>}
    </div>
  </div>;
}
