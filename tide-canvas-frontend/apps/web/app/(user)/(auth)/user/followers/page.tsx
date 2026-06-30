"use client";

import { followApi } from "@/lib/api";
import { FollowList } from "@/components/user/follow-list";

export default function FollowersPage() {
  return (
    <FollowList
      title="我的粉丝"
      emptyText="还没有粉丝"
      fetcher={(q) => followApi.followers(q)}
    />
  );
}
