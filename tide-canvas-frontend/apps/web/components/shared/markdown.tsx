"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { cn } from "@/lib/utils";

interface MarkdownProps {
  content: string;
  className?: string;
}

/**
 * 渲染 Markdown 文本（支持 GFM：表格、删除线、任务列表、自动链接等）。
 * 基于 react-markdown，默认不渲染裸 HTML，对用户生成内容是 XSS 安全的。
 */
export function Markdown({ content, className }: MarkdownProps) {
  return (
    <div
      className={cn(
        "prose prose-neutral max-w-none dark:prose-invert",
        "prose-a:text-blue-600 dark:prose-a:text-blue-400",
        "prose-code:before:content-none prose-code:after:content-none",
        "prose-img:rounded-lg",
        // 代码块由 highlight.js 主题着色：清掉 prose 的 pre 背景/内边距，交给 .hljs
        "prose-pre:overflow-hidden prose-pre:rounded-lg prose-pre:bg-transparent prose-pre:p-0",
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
