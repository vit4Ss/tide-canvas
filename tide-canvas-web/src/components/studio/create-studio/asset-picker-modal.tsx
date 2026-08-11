/* 资产库选取弹窗（复用整个资产页 UI 作为选择器，按槽类型默认到对应筛选）—
   从 create-studio.tsx 抽出（纯移动，无逻辑改动）。 */

import { AssetsBrowser, type PickedAsset } from "@/components/studio/assets-browser";
import type { AssetFilterKey } from "@/components/studio/assets-browser-policy";
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
}: {
  kind: SlotType;
  onPick: (a: PickedAsset) => void;
  onClose: () => void;
  /** 只允许选 kind 这一种素材(智能工具:图片工具只收图、视频工具只收视频)。
      创作台的槽位选取不设限，保持原行为。 */
  lockKind?: boolean;
}) {
  return (
    <div className="ws-srcmask" onClick={onClose}>
      <div className="ws-assetbox" onClick={(e) => e.stopPropagation()}>
        <div className="ws-assetbox-h">
          <span>从资产库选取</span>
          <button type="button" aria-label="关闭" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="ws-assetbox-body">
          <AssetsBrowser
            pickMode
            onPick={onPick}
            defaultFilter={kind}
            defaultTab={kind === "audio" ? "upload" : "hist"}
            allowedFilters={lockKind ? ALLOWED_BY_KIND[kind] : undefined}
          />
        </div>
      </div>
    </div>
  );
}
