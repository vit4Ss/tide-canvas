"use client";

import { useRef, useState } from "react";
import {
  Bold, Italic, Heading, Link2, Image as ImageIcon, Code, List, Quote, Loader2,
} from "lucide-react";
import { fileApi } from "@/lib/api";
import { Markdown } from "@/components/shared/markdown";
import { cn } from "@/lib/utils";

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  rows?: number;
  placeholder?: string;
  /** Tailwind 最小高度类，编辑区与预览区共用 */
  minHeight?: string;
  required?: boolean;
}

/**
 * 带工具栏（加粗/斜体/标题/列表/引用/代码/链接/插入图片）和「编辑 / 预览」切换的
 * Markdown 编辑器。图片按钮会上传文件并插入 `![](url)`。
 */
export function MarkdownEditor({
  value,
  onChange,
  id,
  rows = 12,
  placeholder = "输入内容…（支持 Markdown）",
  minHeight = "min-h-[18rem]",
  required,
}: MarkdownEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState(false);
  const [uploading, setUploading] = useState(false);

  // 包裹选区（无选区时插入占位文字并选中）
  const surround = (before: string, after: string, ph: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = value.slice(start, end) || ph;
    const next = value.slice(0, start) + before + selected + after + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      ta.focus();
      const s = start + before.length;
      ta.setSelectionRange(s, s + selected.length);
    });
  };

  // 在当前行首插入前缀（标题/列表/引用）
  const linePrefix = (prefix: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const next = value.slice(0, lineStart) + prefix + value.slice(lineStart);
    onChange(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + prefix.length, start + prefix.length);
    });
  };

  const insertAtCursor = (text: string) => {
    const ta = textareaRef.current;
    const pos = ta ? ta.selectionStart : value.length;
    const next = value.slice(0, pos) + text + value.slice(pos);
    onChange(next);
    requestAnimationFrame(() => {
      if (!ta) return;
      ta.focus();
      const p = pos + text.length;
      ta.setSelectionRange(p, p);
    });
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const res = await fileApi.upload(file);
      if (res.success) {
        insertAtCursor(`![${file.name}](${res.data.fileUrl})`);
      }
    } finally {
      setUploading(false);
    }
  };

  const tools = [
    { icon: Bold, title: "粗体", run: () => surround("**", "**", "粗体") },
    { icon: Italic, title: "斜体", run: () => surround("*", "*", "斜体") },
    { icon: Heading, title: "标题", run: () => linePrefix("## ") },
    { icon: List, title: "列表", run: () => linePrefix("- ") },
    { icon: Quote, title: "引用", run: () => linePrefix("> ") },
    { icon: Code, title: "行内代码", run: () => surround("`", "`", "code") },
    { icon: Link2, title: "链接", run: () => surround("[", "](https://)", "链接文字") },
  ];

  return (
    <div>
      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-0.5 rounded-t-lg border border-b-0 border-neutral-300 bg-neutral-50 px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900/50">
        {!preview && (
          <>
            {tools.map((t) => (
              <button
                key={t.title}
                type="button"
                title={t.title}
                onClick={t.run}
                className="rounded p-1.5 text-neutral-500 transition-colors hover:bg-neutral-200 hover:text-neutral-800 dark:hover:bg-neutral-700 dark:hover:text-neutral-100"
              >
                <t.icon className="h-4 w-4" />
              </button>
            ))}
            <button
              type="button"
              title="插入图片"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="rounded p-1.5 text-neutral-500 transition-colors hover:bg-neutral-200 hover:text-neutral-800 disabled:opacity-50 dark:hover:bg-neutral-700 dark:hover:text-neutral-100"
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
            </button>
          </>
        )}
        <input ref={fileInputRef} type="file" accept="image/*" onChange={handleUpload} className="hidden" />

        <div className="ml-auto flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => setPreview(false)}
            className={preview ? "text-neutral-400 hover:text-neutral-600" : "font-semibold text-neutral-900 dark:text-white"}
          >
            编辑
          </button>
          <span className="text-neutral-300 dark:text-neutral-600">/</span>
          <button
            type="button"
            onClick={() => setPreview(true)}
            className={preview ? "font-semibold text-neutral-900 dark:text-white" : "text-neutral-400 hover:text-neutral-600"}
          >
            预览
          </button>
        </div>
      </div>

      {/* 编辑区 / 预览区 */}
      {preview ? (
        <div className={cn("overflow-auto rounded-b-lg border border-neutral-300 bg-white px-4 py-3 dark:border-neutral-700 dark:bg-neutral-900", minHeight)}>
          {value.trim() ? <Markdown content={value} /> : <p className="text-sm text-neutral-400">预览区为空</p>}
        </div>
      ) : (
        <textarea
          ref={textareaRef}
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={rows}
          required={required}
          placeholder={placeholder}
          className={cn(
            "w-full rounded-b-lg border border-neutral-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900 dark:border-neutral-700 dark:bg-neutral-900",
            minHeight,
          )}
        />
      )}
      <p className="mt-1 text-xs text-neutral-400">
        支持 Markdown 语法（粗体、标题、列表、代码块、表格、链接、图片等），代码块支持语法高亮
      </p>
    </div>
  );
}
