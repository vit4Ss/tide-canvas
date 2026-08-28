/* 资产库选取弹窗（复用整个资产页 UI 作为选择器，按槽类型默认到对应筛选）。

   多选：与对话侧的 AssetPickerDialog 同一套交互——卡片切换勾选、底栏显示
   「已选 n / 还能选 m」并集中确认。参考图往往是一组（多视图、多参考），
   一次一张地开关弹窗是纯粹的重复劳动。remaining 由调用方按槽位余量给出，
   超额在勾选时就挡住，而不是确认后再默默丢弃。 */

import { useMemo, useState } from "react";
import { AssetsBrowser, type PickedAsset } from "@/components/studio/assets-browser";
import type { AssetFilterKey } from "@/components/studio/assets-browser-policy";
import { toast } from "@/components/shared/toast";
import type { SlotType } from "./types";

/** lockKind 时允许的筛选项。角色/场景是生成历史里图片的细分类目——同样是图片，
    锁成单一 "image" 会把它们挡在外面，用户就选不到自己生成的角色图了。 */
const ALLOWED_BY_KIND: Record<SlotType, readonly AssetFilterKey[]> = {
  image: ["image", "character", "scene"],
  video: ["video"],
  audio: ["audio"],
};

export function AssetPickerModal({
  kind,
  onPick,
  onClose,
  lockKind = false,
  remaining = 1,
  existingUrls,
}: {
  kind: SlotType;
  onPick: (assets: PickedAsset[]) => void;
  onClose: () => void;
  /** 只允许选 kind 这一种素材(智能工具:图片工具只收图、视频工具只收视频)。
      创作台的槽位选取不设限，保持原行为。 */
  lockKind?: boolean;
  /** 本次最多还能选几个（槽位上限 − 已有数量）。≤1 时退回单选直接添加。 */
  remaining?: number;
  /** 槽位里已有的素材 URL：置灰，避免重复添加同一张。 */
  existingUrls?: readonly string[];
}) {
  const multi = remaining > 1;
  const existing = useMemo(() => new Set((existingUrls ?? []).filter(Boolean)), [existingUrls]);
  const [selected, setSelected] = useState<Map<string, PickedAsset>>(() => new Map());
  const pickedUrls = useMemo(() => new Set(selected.keys()), [selected]);

  const toggleAsset = (asset: PickedAsset) => {
    if (!multi) {
      onPick([asset]);
      return;
    }
    setSelected((current) => {
      const next = new Map(current);
      if (next.has(asset.url)) {
        next.delete(asset.url);
        return next;
      }
      if (next.size >= remaining) {
        toast.info(`本次最多还能选择 ${remaining} 个素材`);
        return current;
      }
      next.set(asset.url, asset);
      return next;
    });
  };

  return (
    <div className="ws-srcmask" onClick={onClose}>
      <div className="ws-assetbox" onClick={(e) => e.stopPropagation()}>
        <div className="ws-assetbox-h">
          <span>从资产库选取{multi ? " · 可多选" : ""}</span>
          <button type="button" aria-label="关闭" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="ws-assetbox-body">
          <AssetsBrowser
            pickMode
            multiPick={multi}
            onPick={toggleAsset}
            pickedUrls={multi ? pickedUrls : undefined}
            disabledPickUrls={existing}
            defaultFilter={kind}
            defaultTab={kind === "audio" ? "upload" : "hist"}
            allowedFilters={lockKind ? ALLOWED_BY_KIND[kind] : undefined}
          />
        </div>
        {multi ? (
          <div className="ws-assetbox-f">
            <span>已选择 {selected.size} / {remaining}</span>
            <div>
              <button type="button" className="ghost" onClick={onClose}>取消</button>
              <button
                type="button"
                className="primary"
                disabled={selected.size === 0}
                onClick={() => onPick([...selected.values()])}
              >
                添加{selected.size > 0 ? ` ${selected.size} 项` : ""}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
