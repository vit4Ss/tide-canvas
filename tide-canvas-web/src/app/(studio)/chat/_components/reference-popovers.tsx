"use client";

/* ── reference-source popovers (extracted verbatim from page.tsx) ──────────────
   渲染在 chat-wrap 顶层（fixed 定位，与创作台同一套 ws-srcmenu/ws-srcmask 结构）。 */

import { AssetsBrowser, type PickedAsset } from "@/components/studio/assets-browser";
import type { RefPolicy } from "./chat-utils";

/** 参考素材来源选择：本地上传 / 资产库（复用 创作台 的来源菜单）。
 *  位置由调用方按锚点钳制后传入（见 useReferences 的 openSrcMenu/layout effect）。 */
export function SourceMenu({
  pos,
  menuRef,
  onClose,
  onPickLocal,
  onOpenAssets,
}: {
  pos: { x: number; y: number };
  menuRef: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
  onPickLocal: () => void;
  onOpenAssets: () => void;
}) {
  return (
    <>
      <div className="ws-srcpop-catch" onClick={onClose} />
      <div
        ref={menuRef}
        className="ws-srcmenu ws-srcmenu-pop"
        style={{ left: pos.x, top: pos.y }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ws-srcmenu-h">选择素材来源</div>
        <button type="button" className="ws-srcopt" onClick={onPickLocal}>
          <span className="ic">⤓</span>
          <span className="tx">
            <b>本地上传</b>
            <i>从你的电脑选择文件</i>
          </span>
        </button>
        <button type="button" className="ws-srcopt" onClick={onOpenAssets}>
          <span className="ic">▦</span>
          <span className="tx">
            <b>从资产库选取</b>
            <i>选择已上传 / 已生成的素材</i>
          </span>
        </button>
      </div>
    </>
  );
}

/** 资产库弹窗：复用整个资产页 UI 作为选择器。 */
export function AssetPickerDialog({
  refPolicy,
  onClose,
  onPick,
}: {
  refPolicy: RefPolicy | undefined;
  onClose: () => void;
  onPick: (a: PickedAsset) => void;
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
            defaultFilter={(refPolicy?.kinds[0] === "file" ? "doc" : refPolicy?.kinds[0]) ?? "image"}
            defaultTab={refPolicy?.kinds[0] === "audio" ? "upload" : "hist"}
          />
        </div>
      </div>
    </div>
  );
}
