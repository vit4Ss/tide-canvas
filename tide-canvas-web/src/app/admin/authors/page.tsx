"use client";

import { useEffect, useState, useCallback } from "react";
import {
  UserCheck, UserX, Loader2, UserPlus, Shield,
} from "lucide-react";
import { adminApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import type { AdminUserVO } from "@/types/admin";
import {
  PageHeader,
  SearchBar,
  Pagination,
  EmptyState,
} from "@/components/shared";

const PAGE_SIZE = 20;

export default function AdminAuthorsPage() {
  const [authors, setAuthors] = useState<AdminUserVO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pageNum, setPageNum] = useState(1);
  const [total, setTotal] = useState(0);
  const [keyword, setKeyword] = useState("");
  const [searchInput, setSearchInput] = useState("");

  // Grant dialog
  const [grantOpen, setGrantOpen] = useState(false);
  const [grantUserId, setGrantUserId] = useState("");
  const [granting, setGranting] = useState(false);

  // Revoke state
  const [revokingId, setRevokingId] = useState<number | null>(null);

  const fetchAuthors = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await adminApi.authors.list({
        pageNum,
        pageSize: PAGE_SIZE,
        keyword: keyword || undefined,
      });
      if (res.success) {
        setAuthors(res.data.records);
        setTotal(res.data.total);
      } else {
        setError(res.message || "加载失败");
      }
    } catch {
      setError("加载失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }, [pageNum, keyword]);

  useEffect(() => {
    fetchAuthors();
  }, [fetchAuthors]);

  const handleSearch = () => {
    setKeyword(searchInput);
    setPageNum(1);
  };

  const handleGrant = async () => {
    if (!grantUserId) return;
    setGranting(true);
    setError("");
    try {
      const res = await adminApi.authors.grant(Number(grantUserId));
      if (res.success) {
        setGrantOpen(false);
        setGrantUserId("");
        fetchAuthors();
      } else {
        setError(res.message || "授权失败");
      }
    } catch {
      setError("网络错误，请稍后重试");
    } finally {
      setGranting(false);
    }
  };

  const handleRevoke = async (userId: number) => {
    if (revokingId) return;
    setRevokingId(userId);
    setError("");
    try {
      const res = await adminApi.authors.revoke(userId);
      if (res.success) {
        fetchAuthors();
      } else {
        setError(res.message || "撤销失败");
      }
    } catch {
      setError("网络错误，请稍后重试");
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="作者管理"
        description="管理签约作者的权限"
        actions={
          <Button onClick={() => setGrantOpen(true)}>
            <UserPlus className="mr-1 h-4 w-4" />
            授权作者
          </Button>
        }
      />

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Search */}
      <SearchBar
        value={searchInput}
        onChange={setSearchInput}
        onSearch={handleSearch}
        placeholder="搜索用户名或昵称..."
        className="max-w-sm flex-1"
      />

      {/* Author List */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-xl bg-neutral-200 dark:bg-neutral-800"
            />
          ))}
        </div>
      ) : authors.length === 0 ? (
        <EmptyState
          icon={Shield}
          title="暂无签约作者"
          description="点击上方按钮授权新作者"
          className="h-64"
        />
      ) : (
        <div className="space-y-2">
          {authors.map((author) => (
            <div
              key={author.id}
              className="flex items-center justify-between rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950"
            >
              <div className="flex items-center gap-3">
                <Avatar>
                  {author.avatar && <AvatarImage src={author.avatar} />}
                  <AvatarFallback>{(author.nickname || author.username)?.[0] || "U"}</AvatarFallback>
                </Avatar>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{author.nickname || author.username}</p>
                    <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-600 dark:bg-green-950 dark:text-green-400">
                      <UserCheck className="mr-0.5 h-3 w-3" />
                      签约作者
                    </span>
                  </div>
                  <p className="text-sm text-neutral-500">
                    @{author.username} · ID: {author.id}
                  </p>
                </div>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => handleRevoke(author.id)}
                disabled={revokingId === author.id}
              >
                {revokingId === author.id ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : (
                  <UserX className="mr-1 h-3 w-3" />
                )}
                撤销
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      <Pagination
        pageNum={pageNum}
        pageSize={PAGE_SIZE}
        total={total}
        onChange={setPageNum}
      />

      {/* Grant Author Dialog */}
      <Dialog open={grantOpen} onOpenChange={setGrantOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>授权作者</DialogTitle>
            <DialogDescription>输入用户ID，授予其作者权限</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="grantUserId">用户 ID</Label>
              <Input
                id="grantUserId"
                placeholder="输入用户ID"
                value={grantUserId}
                onChange={(e) => setGrantUserId(e.target.value)}
                type="number"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGrantOpen(false)}>
              取消
            </Button>
            <Button onClick={handleGrant} disabled={!grantUserId || granting}>
              {granting && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              确认授权
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
