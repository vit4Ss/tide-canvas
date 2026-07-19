"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { BlogForm } from "@/components/blog/blog-form";

export default function CreateBlogPage() {
  const router = useRouter();
  const { user } = useAuth();

  if (user && user.isAuthor !== 1) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <Button variant="ghost" onClick={() => router.back()}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          返回
        </Button>
        <div className="mt-8 flex flex-col items-center justify-center py-16 text-neutral-400">
          <p className="text-lg font-medium text-red-500">非签约作者</p>
          <p className="mt-2 text-sm">只有签约作者才能创建博客文章</p>
        </div>
      </div>
    );
  }

  return <BlogForm mode="create" />;
}
