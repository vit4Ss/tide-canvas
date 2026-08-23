"use client";

/* ── reference-source popovers (extracted verbatim from page.tsx) ──────────────
   渲染在 chat-wrap 顶层（fixed 定位，与创作台同一套 ws-srcmenu/ws-srcmask 结构）。 */

import { useMemo, useState } from "react";
import { AssetsBrowser, type PickedAsset } from "@/components/studio/assets-browser";
import type { AssetFilterKey } from "@/components/studio/assets-browser-policy";
import { toast } from "@/components/shared/toast";
import type { RefPolicy } from "./chat-utils";

const FILTERS_BY_KIND: Record<RefPolicy["kinds"][number], readonly AssetFilterKey[]> = {
  image: ["image", "character", "scene"],
  video: ["video"],
  audio: ["audio"],
  file: ["doc"],
};

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
  existingUrls,
  existingCount,
  onClose,
  onPick,
}: {
  refPolicy: RefPolicy | undefined;
  existingUrls: readonly string[];
  existingCount: number;
  onClose: () => void;
  onPick: (assets: PickedAsset[]) => void;
}) {
  const allowedFilters = refPolicy?.kinds.flatMap((kind) => FILTERS_BY_KIND[kind]) ?? [];
  const existing = useMemo(() => new Set(existingUrls.filter(Boolean)), [existingUrls]);
  const [selected, setSelected] = useState<Map<string, PickedAsset>>(() => new Map());
  const pickedUrls = useMemo(() => new Set(selected.keys()), [selected]);
  const remaining = Math.max(0, (refPolicy?.max ?? 0) - existingCount);
  const toggleAsset = (asset: PickedAsset) => {
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
  if (!refPolicy?.kinds.length) return null;
  return (
    <div className="ws-srcmask" onClick={onClose}>
      <div className="ws-assetbox" onClick={(e) => e.stopPropagation()}>
        <div className="ws-assetbox-h">
          <span>从资产库选取 · 可多选</span>
          <button type="button" aria-label="关闭" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="ws-assetbox-body">
          <AssetsBrowser
            pickMode
            multiPick
            onPick={toggleAsset}
            pickedUrls={pickedUrls}
            disabledPickUrls={existing}
            defaultFilter={(refPolicy?.kinds[0] === "file" ? "doc" : refPolicy?.kinds[0]) ?? "image"}
            defaultTab={refPolicy?.kinds[0] === "audio" ? "upload" : "hist"}
            allowedFilters={allowedFilters}
          />
        </div>
        <div className="ws-assetbox-f">
          <span>{remaining > 0 ? `已选择 ${selected.size} / ${remaining}` : "已达到素材数量上限"}</span>
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
      </div>
    </div>
  );
}
