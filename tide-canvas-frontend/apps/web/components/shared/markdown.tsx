"use client";

import { useRef, useState, type ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

interface MarkdownProps {
  content: string;
  className?: string;
  colorMode?: "auto" | "light";
}

/**
 * 渲染 Markdown 文本（支持 GFM：表格、删除线、任务列表、自动链接等）。
 * 基于 react-markdown，默认不渲染裸 HTML，对用户生成内容是 XSS 安全的。
 */
export function Markdown({ content, className, colorMode = "auto" }: MarkdownProps) {
  return (
    <div
      className={cn(
        "prose prose-neutral max-w-none",
        colorMode === "auto" && "dark:prose-invert",
        "prose-a:text-blue-600 dark:prose-a:text-blue-400",
        "prose-code:before:content-none prose-code:after:content-none",
        "prose-img:rounded-lg",
        // 代码块由 highlight.js 主题着色：清掉 prose 的 pre 背景/内边距，交给 .hljs
        "prose-pre:overflow-hidden prose-pre:rounded-lg prose-pre:bg-transparent prose-pre:p-0",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex, rehypeHighlight]}
        components={{ pre: CodeBlock }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function CodeBlock({ node, children, ...props }: ComponentPropsWithoutRef<"pre"> & { node?: unknown }) {
  void node;
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    const code = preRef.current?.querySelector("code")?.textContent ?? preRef.current?.textContent ?? "";
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="group/code relative my-4 overflow-hidden rounded-lg">
      <button
        type="button"
        onClick={() => void copy()}
        className="absolute right-2 top-2 z-10 inline-flex h-7 items-center gap-1 rounded-md bg-black/55 px-2 text-[12px] font-medium text-white opacity-0 backdrop-blur transition-opacity group-hover/code:opacity-100 focus-visible:opacity-100"
        aria-label="复制代码"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? "已复制" : "复制"}
      </button>
      <pre ref={preRef} {...props}>{children}</pre>
    </div>
  );
}
