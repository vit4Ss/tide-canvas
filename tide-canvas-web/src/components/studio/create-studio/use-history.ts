/* 创作台生成历史 state hook — 从 create-studio.tsx 抽出（纯移动，无逻辑改动）。
   负责：hist 列表 state、本地插入 pushHistory（id 取自 utils 的模块级计数器）、
   延长/翻唱的原曲候选 clipOptions（历史音频分轨 + 会话内刚登记的上传原曲）。
   历史的拉取（loadHistory）留在组合层：它还要给舞台播种，依赖生成引擎的 setter。 */

import { useCallback, useMemo, useState } from "react";
import type { ClipOption } from "@/lib/music-modes";
import type { HistItem } from "./types";
import { nextHistId } from "./utils";

export function useHistory(extraClips: ClipOption[]) {
  /* history — the user's REAL generation tasks (aiApi.listTasks), newest first.
     Loaded post-mount (see loadHistory); empty until then. No mock seed. */
  const [hist, setHist] = useState<HistItem[]>([]);

  const pushHistory = useCallback((item: Omit<HistItem, "id">) => {
    // Compute the id OUTSIDE the updater: a state updater must be pure, and React
    // dev double-invokes it — mutating histSeq inside produced duplicate keys.
    const id = nextHistId();
    setHist((prev) => [{ id, ...item }, ...prev]);
  }, []);

  /* 延长/翻唱的原曲候选：历史音频里带 clip_id 的分轨(新→旧,按 clip 去重)。
     上游约束:只能引用自己生成的歌,所以候选就是用户的生成历史。
     产出共享 ClipOption 形状喂给 ClipPicker 弹窗:封面/时长/日期 + 同一次
     生成内的「第 N 首」编号(Suno 两首同名靠它与试听区分)。 */
  const clipOptions = useMemo<ClipOption[]>(() => {
    const runCounts = new Map<string, number>();
    for (const h of hist) {
      if (h.type === "audio" && h.clipId) runCounts.set(h.run, (runCounts.get(h.run) ?? 0) + 1);
    }
    const seen = new Set<string>();
    const runSeen = new Map<string, number>();
    const out: ClipOption[] = [];
    for (const h of hist) {
      if (h.type !== "audio" || !h.clipId) continue;
      const trackNo = (runSeen.get(h.run) ?? 0) + 1;
      runSeen.set(h.run, trackNo);
      if (seen.has(h.clipId)) continue;
      seen.add(h.clipId);
      const name = h.trackTitle || h.title || h.model || "未命名";
      out.push({
        clipId: h.clipId,
        label: name.length > 24 ? name.slice(0, 24) + "…" : name,
        // hist 未携带模型行 id,置空走 findClipModel 的名称兜底匹配
        modelId: "",
        modelName: h.model || "",
        url: h.url ?? "",
        coverUrl: h.trackCover ?? "",
        duration: h.trackDur ?? 0,
        createTime: h.ts ?? "",
        trackNo,
        trackCount: runCounts.get(h.run) ?? 1,
        ...(h.clipUpload ? { isUpload: true } : {}),
      });
    }
    // 刚在弹窗里登记完成的上传原曲还没进 hist(历史下次刷新才有),先合并进候选,
    // 否则触发按钮回显成「历史原曲」
    const fresh = extraClips.filter((e) => !out.some((o) => o.clipId === e.clipId));
    return [...fresh, ...out];
  }, [hist, extraClips]);

  return { hist, setHist, pushHistory, clipOptions };
}
