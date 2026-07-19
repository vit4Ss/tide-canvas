"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, X, ImagePlus, Save, Send } from "lucide-react";
import { blogApi, fileApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { MarkdownEditor } from "@/components/shared/markdown-editor";

const CATEGORIES = ["技术", "设计", "产品", "教程", "经验"];

export interface BlogFormValues {
  title: string;
  summary: string;
  content: string;
  coverImage: string;
  category: string;
  tags: string[];
  pointsRequired: number;
}

const EMPTY_VALUES: BlogFormValues = {
  title: "",
  summary: "",
  content: "",
  coverImage: "",
  category: "",
  tags: [],
  pointsRequired: 0,
};

interface BlogFormProps {
  mode: "create" | "edit";
  blogId?: number | string;
  initialValues?: BlogFormValues;
}

export function BlogForm({ mode, blogId, initialValues }: BlogFormProps) {
  const router = useRouter();
  const init = initialValues ?? EMPTY_VALUES;
  const isEdit = mode === "edit";

  const [title, setTitle] = useState(init.title);
  const [summary, setSummary] = useState(init.summary);
  const [content, setContent] = useState(init.content);
  const [coverImage, setCoverImage] = useState(init.coverImage);
  const [category, setCategory] = useState(init.category);
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>(init.tags);
  const [pointsRequired, setPointsRequired] = useState(init.pointsRequired);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [error, setError] = useState("");

  const handleAddTag = () => {
    const tag = tagInput.trim();
    if (tag && !tags.includes(tag) && tags.length < 5) {
      setTags([...tags, tag]);
      setTagInput("");
    }
  };

  const handleRemoveTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag));
  };

  const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingCover(true);
    try {
      const res = await fileApi.upload(file);
      if (res.success) {
        setCoverImage(res.data.fileUrl);
      } else {
        setError(res.message || "封面上传失败");
      }
    } catch {
      setError("封面上传失败");
    } finally {
      setUploadingCover(false);
    }
  };

  const handleSubmit = async () => {
    if (!title.trim()) {
      setError("请输入标题");
      return;
    }
    if (!content.trim()) {
      setError("请输入内容");
      return;
    }

    setSubmitting(true);
    setError("");
    const payload = {
      title: title.trim(),
      content: content.trim(),
      summary: summary.trim() || undefined,
      coverImage: coverImage || undefined,
      category: category || undefined,
      tags: tags.length > 0 ? tags : undefined,
      pointsRequired: pointsRequired > 0 ? pointsRequired : 0,
    };

    try {
      if (isEdit && blogId) {
        const res = await blogApi.update(blogId, payload);
        if (res.success) {
          router.push(`/blogs/${blogId}`);
          return;
        }
        setError(res.message || "保存失败");
      } else {
        const res = await blogApi.create(payload);
        if (res.success) {
          router.push(res.data?.id ? `/blogs/${res.data.id}` : "/blogs");
          return;
        }
        setError(res.message || "发布失败");
      }
    } catch {
      setError("网络错误，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <Button variant="ghost" onClick={() => router.back()}>
        <ArrowLeft className="mr-1 h-4 w-4" />
        返回
      </Button>

      <h1 className="mt-4 text-2xl font-bold">{isEdit ? "编辑博客" : "撰写博客"}</h1>
      <p className="mt-1 text-sm text-neutral-500">
        {isEdit ? "更新你的文章内容" : "分享你的知识和经验"}
      </p>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
          {error}
        </div>
      )}

      <div className="mt-6 space-y-5">
        {/* Title */}
        <div className="space-y-2">
          <Label htmlFor="title">标题</Label>
          <Input
            id="title"
            placeholder="请输入博客标题"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
          />
        </div>

        {/* Summary */}
        <div className="space-y-2">
          <Label htmlFor="summary">摘要（可选）</Label>
          <Textarea
            id="summary"
            placeholder="简短描述文章内容，吸引读者点击"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={3}
          />
        </div>

        {/* Cover Image */}
        <div className="space-y-2">
          <Label>封面图片（可选）</Label>
          {coverImage ? (
            <div className="relative overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800">
              <img src={coverImage} alt="封面" className="h-48 w-full object-cover" />
              <button
                onClick={() => setCoverImage("")}
                className="absolute top-2 right-2 rounded-full bg-black/50 p-1 text-white hover:bg-black/70"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <label className="flex h-40 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-neutral-300 bg-neutral-50 transition-colors hover:border-neutral-400 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:border-neutral-600">
              {uploadingCover ? (
                <Loader2 className="h-8 w-8 animate-spin text-neutral-400" />
              ) : (
                <>
                  <ImagePlus className="h-8 w-8 text-neutral-400" />
                  <span className="mt-2 text-sm text-neutral-500">点击上传封面图片</span>
                </>
              )}
              <input
                type="file"
                accept="image/*"
                onChange={handleCoverUpload}
                className="hidden"
                disabled={uploadingCover}
              />
            </label>
          )}
        </div>

        {/* Category */}
        <div className="space-y-2">
          <Label>分类</Label>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((cat) => (
              <Button
                key={cat}
                type="button"
                variant={category === cat ? "default" : "outline"}
                size="sm"
                onClick={() => setCategory(category === cat ? "" : cat)}
              >
                {cat}
              </Button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="space-y-2">
          <Label htmlFor="content">正文</Label>
          <MarkdownEditor id="content" value={content} onChange={setContent} rows={20} minHeight="min-h-[360px]" placeholder="请输入博客正文…（支持 Markdown）" />
        </div>

        {/* Tags */}
        <div className="space-y-2">
          <Label>标签（最多5个）</Label>
          <div className="flex gap-2">
            <Input
              placeholder="输入标签后按回车"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddTag();
                }
              }}
              className="max-w-xs"
            />
            <Button type="button" variant="outline" onClick={handleAddTag}>
              添加
            </Button>
          </div>
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs dark:bg-neutral-800"
                >
                  {tag}
                  <button
                    onClick={() => handleRemoveTag(tag)}
                    className="text-neutral-400 hover:text-neutral-600"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Points Required */}
        <div className="space-y-2">
          <Label htmlFor="pointsRequired">积分定价</Label>
          <div className="flex items-center gap-3">
            <Input
              id="pointsRequired"
              type="number"
              placeholder="0"
              value={pointsRequired || ""}
              onChange={(e) => setPointsRequired(Math.max(0, Number(e.target.value) || 0))}
              min={0}
              className="max-w-32"
            />
            <span className="text-sm text-neutral-500">
              {pointsRequired === 0 ? "免费公开" : `读者需支付 ${pointsRequired} 积分`}
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 border-t border-neutral-200 pt-6 dark:border-neutral-800">
          <Button variant="outline" onClick={() => router.back()}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : isEdit ? (
              <Save className="mr-1 h-4 w-4" />
            ) : (
              <Send className="mr-1 h-4 w-4" />
            )}
            {isEdit ? "保存修改" : "发布博客"}
          </Button>
        </div>
      </div>
    </div>
  );
}
