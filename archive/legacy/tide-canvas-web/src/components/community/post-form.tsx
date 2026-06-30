"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { communityApi } from "@/lib/api";
import { ArrowLeft, Loader2, Send, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MarkdownEditor } from "@/components/shared/markdown-editor";

const categories = ["问答", "分享", "教程"];
const TITLE_MAX = 80;

export interface PostFormValues {
  title: string;
  content: string;
  category: string;
}

const EMPTY_VALUES: PostFormValues = { title: "", content: "", category: "" };

interface PostFormProps {
  mode: "create" | "edit";
  postId?: number | string;
  initialValues?: PostFormValues;
}

export function PostForm({ mode, postId, initialValues }: PostFormProps) {
  const router = useRouter();
  const init = initialValues ?? EMPTY_VALUES;
  const isEdit = mode === "edit";

  const [title, setTitle] = useState(init.title);
  const [content, setContent] = useState(init.content);
  const [category, setCategory] = useState(init.category);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;
    setSubmitting(true);
    setError("");
    try {
      if (isEdit && postId) {
        const res = await communityApi.update(postId, {
          title: title.trim(),
          content: content.trim(),
          category: category || undefined,
        });
        if (res.success) {
          router.push(`/community/${postId}`);
          return;
        }
        setError(res.message || "保存失败");
      } else {
        const res = await communityApi.create({
          title: title.trim(),
          content: content.trim(),
          category: category || undefined,
        });
        if (res.success) {
          router.push(res.data?.id ? `/community/${res.data.id}` : "/community");
          return;
        }
        setError(res.message || "发布失败");
      }
    } catch {
      setError(isEdit ? "保存失败，请重试" : "发布失败，请重试");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
        <button
          type="button"
          onClick={() => router.back()}
          className="mb-4 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-200"
        >
          <ArrowLeft className="h-4 w-4" /> {isEdit ? "返回" : "返回社区"}
        </button>

        <div className="rounded-xl border border-neutral-200 bg-white p-5 sm:p-7 dark:border-neutral-800 dark:bg-neutral-900">
          <h1 className="text-xl font-bold">{isEdit ? "编辑帖子" : "发布帖子"}</h1>
          <p className="mt-1 text-sm text-neutral-500">分享你的想法，支持 Markdown 排版与配图</p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-5">
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
                {error}
              </div>
            )}

            {/* Title */}
            <div>
              <div className="flex items-center justify-between">
                <label htmlFor="post-title" className="text-sm font-medium">
                  标题
                </label>
                <span className="text-xs text-neutral-400">
                  {title.length}/{TITLE_MAX}
                </span>
              </div>
              <input
                id="post-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                maxLength={TITLE_MAX}
                placeholder="填写标题"
                className="mt-1.5 w-full rounded-lg border border-neutral-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900 dark:border-neutral-700 dark:bg-neutral-900"
              />
            </div>

            {/* Category pills */}
            <div>
              <label className="text-sm font-medium">分类</label>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {categories.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCategory(category === c ? "" : c)}
                    className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                      category === c
                        ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900"
                        : "border-neutral-300 text-neutral-600 hover:border-neutral-400 dark:border-neutral-700 dark:text-neutral-300 dark:hover:border-neutral-600"
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>

            {/* Content */}
            <div>
              <label className="mb-1.5 block text-sm font-medium">正文</label>
              <MarkdownEditor
                value={content}
                onChange={setContent}
                required
                rows={12}
                placeholder="正文文案…（支持 Markdown，可插入图片）"
              />
            </div>

            {/* Footer actions */}
            <div className="flex justify-end gap-3 border-t border-neutral-200 pt-5 dark:border-neutral-800">
              <Button type="button" variant="outline" onClick={() => router.back()}>
                取消
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : isEdit ? (
                  <Save className="mr-1 h-4 w-4" />
                ) : (
                  <Send className="mr-1 h-4 w-4" />
                )}
                {isEdit ? "保存修改" : "发布帖子"}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
