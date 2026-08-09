/* 模型标签（后台模型管理可配）：模型选择列表名称旁的小徽标。
   hot 红底 / new 青底 / info 灰字说明；文本为空的条目直接跳过，
   未配置时不渲染任何东西（默认视觉与配置前完全一致）。 */

import type { ModelBadge } from "@/types/admin-models";

export function ModelBadges({ badges }: { badges?: ModelBadge[] | null }) {
  const list = (badges ?? []).filter(
    (b) => typeof b?.text === "string" && b.text.trim().length > 0,
  );
  if (!list.length) return null;
  return (
    <>
      {list.map((b, i) => (
        <span
          key={`${b.text}-${i}`}
          className={`mlabel ${b.tone === "new" ? "new" : b.tone === "info" ? "info" : "hot"}`}
        >
          {b.text.trim()}
        </span>
      ))}
    </>
  );
}
