"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Code2, Eye, FileText, Upload } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { confirmDialog } from "@/components/shared/confirm";
import { toast } from "@/components/shared/toast";

export const MAX_OPERATOR_SKILL_DOCUMENT_BYTES = 512 * 1024;

const MARKDOWN_COMPONENTS: Components = {
  a({ node, ...props }) {
    void node;
    return <a {...props} target="_blank" rel="noopener noreferrer" />;
  },
};

function formatKiB(bytes: number): string {
  if (bytes === 0) return "0 KiB";
  return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KiB`;
}

const CONTENT_PLACEHOLDER = `## 做什么
说明这个 Skill 能解决什么问题，以及适合什么创作目标。

## 需要什么输入
说明用户至少需要提供哪些信息，例如主题、风格、时长或参考素材。

## 怎么做
写清关键步骤、专业经验和必须遵守的要求，不需要写程序。

## 产出什么
说明最终交付物及质量标准。

## 什么时候询问
说明信息不足时应向用户确认什么，其余情况由 Skill 自行处理。`;

export function OperatorSkillContentEditor({
  value,
  previewValue,
  onChange,
  onImport,
}: {
  value: string;
  previewValue: string;
  onChange: (value: string) => void;
  onImport: (value: string) => void;
}) {
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const inputRef = useRef<HTMLInputElement>(null);
  const editTabRef = useRef<HTMLButtonElement>(null);
  const previewTabRef = useRef<HTMLButtonElement>(null);
  const readSequenceRef = useRef(0);
  const editTabId = useId();
  const previewTabId = useId();
  const panelId = useId();
  const byteStatusId = useId();
  const documentBytes = useMemo(() => new TextEncoder().encode(value).byteLength, [value]);
  const documentOverLimit = documentBytes > MAX_OPERATOR_SKILL_DOCUMENT_BYTES;

  useEffect(() => () => {
    readSequenceRef.current += 1;
  }, []);

  const readFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const lowerName = file.name.toLowerCase();
    if (!lowerName.endsWith(".md") && !lowerName.endsWith(".txt")) {
      toast.error("仅支持导入 .md 或 .txt 文件");
      return;
    }
    if (file.size <= 0 || file.size > MAX_OPERATOR_SKILL_DOCUMENT_BYTES) {
      toast.error("SKILL.md 文件不能超过 512 KiB");
      return;
    }
    const sequence = ++readSequenceRef.current;
    try {
      const content = await file.text();
      if (sequence !== readSequenceRef.current) return;
      if (value.trim() && content !== value) {
        const confirmed = await confirmDialog({
          title: "覆盖当前 Skill 内容？",
          message: "导入文件会替换编辑器中的全部内容，当前未保存内容将无法恢复。",
          confirmText: "确认覆盖",
          danger: true,
        });
        if (sequence !== readSequenceRef.current || !confirmed) return;
      }
      onImport(content);
      setMode("edit");
      toast.success(`已导入 ${file.name}`);
    } catch {
      if (sequence === readSequenceRef.current) toast.error("SKILL.md 读取失败");
    }
  };

  const activateTab = (nextMode: "edit" | "preview") => {
    setMode(nextMode);
    requestAnimationFrame(() => {
      (nextMode === "edit" ? editTabRef : previewTabRef).current?.focus();
    });
  };

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const nextMode = event.key === "Home"
      ? "edit"
      : event.key === "End"
        ? "preview"
        : mode === "edit"
          ? "preview"
          : "edit";
    activateTab(nextMode);
  };

  return (
    <div className="adm-skill-doc-editor">
      <aside className="adm-skill-doc-tree" aria-label="Skill 文件目录">
        <span>目录</span>
        <div className="adm-skill-doc-file">
          <FileText aria-hidden size={14} />
          <b>SKILL.md</b>
        </div>
      </aside>
      <section className="adm-skill-doc-main">
        <header className="adm-skill-doc-toolbar">
          <div className="adm-skill-doc-tabs" role="tablist" aria-label="Skill 内容显示方式">
            <button
              ref={editTabRef}
              id={editTabId}
              type="button"
              role="tab"
              aria-selected={mode === "edit"}
              aria-controls={panelId}
              tabIndex={mode === "edit" ? 0 : -1}
              className={mode === "edit" ? "selected" : ""}
              onClick={() => setMode("edit")}
              onKeyDown={handleTabKeyDown}
            >
              <Code2 aria-hidden size={13} />编辑
            </button>
            <button
              ref={previewTabRef}
              id={previewTabId}
              type="button"
              role="tab"
              aria-selected={mode === "preview"}
              aria-controls={panelId}
              tabIndex={mode === "preview" ? 0 : -1}
              className={mode === "preview" ? "selected" : ""}
              onClick={() => setMode("preview")}
              onKeyDown={handleTabKeyDown}
            >
              <Eye aria-hidden size={13} />预览
            </button>
          </div>
          <div className="adm-skill-doc-toolbar-meta">
            <span
              id={byteStatusId}
              className={`adm-skill-doc-byte-count${documentOverLimit ? " is-over" : ""}`}
              aria-live={documentOverLimit ? "polite" : undefined}
            >
              {formatKiB(documentBytes)} / 512 KiB{documentOverLimit ? " · 已超限" : ""}
            </span>
            <button
              type="button"
              className="adm-skill-doc-upload"
              onClick={() => inputRef.current?.click()}
            >
              <Upload aria-hidden size={13} />导入 SKILL.md
            </button>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".md,.txt,text/markdown,text/plain"
            hidden
            onChange={(event) => void readFile(event)}
          />
        </header>
        <div
          id={panelId}
          className="adm-skill-doc-panel"
          role="tabpanel"
          aria-labelledby={mode === "edit" ? editTabId : previewTabId}
          tabIndex={mode === "preview" ? 0 : undefined}
        >
          {mode === "edit" ? (
            <textarea
              className="adm-skill-doc-textarea"
              aria-label="Skill 内容"
              aria-describedby={byteStatusId}
              aria-invalid={documentOverLimit}
              value={value}
              placeholder={CONTENT_PLACEHOLDER}
              spellCheck={false}
              onChange={(event) => onChange(event.target.value)}
            />
          ) : (
            <div className="adm-skill-doc-preview">
              {previewValue.trim() ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>{previewValue}</ReactMarkdown>
              ) : (
                <p className="muted">填写 Skill 内容后可在这里预览。</p>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
