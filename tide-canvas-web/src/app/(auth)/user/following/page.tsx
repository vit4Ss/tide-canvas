"use client";

import { followApi } from "@/lib/api";
import { FollowList } from "@/components/user/follow-list";

export default function FollowingPage() {
  return (
    <FollowList
      title="我的关注"
      emptyText="还没有关注任何人"
      fetcher={(q) => followApi.following(q)}
    />
  );
}
