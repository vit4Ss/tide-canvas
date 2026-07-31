/* 资产库选取弹窗（复用整个资产页 UI 作为选择器，按槽类型默认到对应筛选）—
   从 create-studio.tsx 抽出（纯移动，无逻辑改动）。 */

import { AssetsBrowser, type PickedAsset } from "@/components/studio/assets-browser";
import type { SlotType } from "./types";

export function AssetPickerModal({
  kind,
  onPick,
  onClose,
}: {
  kind: SlotType;
  onPick: (a: PickedAsset) => void;
  onClose: () => void;
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
          />
        </div>
      </div>
    </div>
  );
}
