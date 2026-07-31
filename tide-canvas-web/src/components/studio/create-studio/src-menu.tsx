/* 参考素材来源选择浮层（本地上传 / 从资产库选取，按槽类型适配文案）— 从
   create-studio.tsx 抽出（纯移动，无逻辑改动）。 */

import type { SlotType } from "./types";

export function SrcMenu({
  slotKey,
  pos,
  kind,
  onClose,
  onPickLocal,
  onOpenAssets,
}: {
  slotKey: string;
  pos: { x: number; y: number } | null;
  kind: SlotType;
  onClose: () => void;
  onPickLocal: (k: string) => void;
  onOpenAssets: (k: string) => void;
}) {
  const lb = kind === "video" ? "视频" : kind === "audio" ? "音频" : "图片";
  return (
    <>
      <div className="ws-srcpop-catch" onClick={onClose} />
      <div
        className="ws-srcmenu ws-srcmenu-pop"
        style={pos ? { left: pos.x, top: pos.y } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ws-srcmenu-h">选择{lb}来源</div>
        <button type="button" className="ws-srcopt" onClick={() => onPickLocal(slotKey)}>
          <span className="ic">⤓</span>
          <span className="tx">
            <b>本地上传</b>
            <i>从你的电脑选择{lb}</i>
          </span>
        </button>
        <button type="button" className="ws-srcopt" onClick={() => onOpenAssets(slotKey)}>
          <span className="ic">▦</span>
          <span className="tx">
            <b>从资产库选取</b>
            <i>选择已上传 / 已生成的{lb}</i>
          </span>
        </button>
      </div>
    </>
  );
}
