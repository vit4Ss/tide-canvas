/* 参考素材上传槽位 hook — 从 create-studio.tsx 抽出（纯移动，无逻辑改动）。
   负责：槽位文件的增删换（本地上传带进度占位 / 资产库选取）、来源选择菜单
   （srcMenu）与资产库弹窗（assetPick）的开合。slotData 本身由组合层持有
   （生成引擎 / @ 引用 / 参数恢复都要读），这里只收 setter 与当前值。 */

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { uploadFileSmart } from "@/lib/api";
import type { ModelConfig } from "@/types/admin-models";
import type { PickedAsset } from "@/components/studio/assets-browser";
import { toast } from "@/components/shared/toast";
import type { SlotData, SlotDef, ToolKey, UploadFile } from "./types";
import { slotMax } from "./utils";

export function useUploadSlots({
  slots,
  tool,
  mCfg,
  slotData,
  setSlotData,
  ensureSession,
}: {
  slots: SlotDef[] | null;
  tool: ToolKey;
  mCfg: ModelConfig | null;
  slotData: SlotData;
  setSlotData: Dispatch<SetStateAction<SlotData>>;
  ensureSession: () => Promise<boolean>;
}) {
  /* reference-image source flow: 来源选择菜单 / 资产库弹窗 / 本地上传 */
  const [srcMenu, setSrcMenu] = useState<string | null>(null); // slot key whose 来源 menu is open
  const [srcMenuPos, setSrcMenuPos] = useState<{ x: number; y: number } | null>(null); // anchor (right of trigger)

  // 来源菜单是 fixed 定位、坐标一次性采集：页面/面板一滚动就会与触发槽位脱锚
  // （移动端可滚动布局下悬浮在错误位置），滚动时直接收起。
  useEffect(() => {
    if (!srcMenu) return;
    const close = () => {
      setSrcMenu(null);
      setSrcMenuPos(null);
    };
    window.addEventListener("scroll", close, true);
    return () => window.removeEventListener("scroll", close, true);
  }, [srcMenu]);
  const [assetPick, setAssetPick] = useState<string | null>(null); // slot key the asset picker fills
  const fileInputRef = useRef<HTMLInputElement>(null);
  const localTargetRef = useRef<string | null>(null); // slot key awaiting a local file pick
  const uploadSeqRef = useRef(0); // 上传中占位的唯一 key 计数

  // A model switch can remove a slot while its source menu/file picker is open.
  // Close stale entry points so a disabled media kind cannot still be uploaded.
  useEffect(() => {
    const supportsSlot = (key: string | null) => !!key && !!slots?.some((slot) => slot.k === key);
    if (srcMenu && !supportsSlot(srcMenu)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- capability changes close stale upload UI
      setSrcMenu(null);
      setSrcMenuPos(null);
    }
    if (assetPick && !supportsSlot(assetPick)) {
      setAssetPick(null);
    }
    if (localTargetRef.current && !supportsSlot(localTargetRef.current)) {
      localTargetRef.current = null;
    }
  }, [assetPick, slots, srcMenu]);

  /* ── typed reference uploads (create.js addFile / removeFile / swap) ──── */

  // adding a reference asset: every slot offers a source choice (本地上传 / 资产库).
  const addFile = (k: string, e?: React.MouseEvent) => {
    const slot = slots?.find((s) => s.k === k);
    if (!slot) return;
    if ((slotData[k] || []).length >= slotMax(mCfg, tool, slot)) {
      toast.info(slot.label + "最多 " + slotMax(mCfg, tool, slot) + " 个");
      return;
    }
    // anchor the 来源 menu just to the right of the clicked trigger (flips left if it would overflow)
    if (e) {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const W = 300;
      const gap = 8;
      let x = r.right + gap;
      if (x + W > window.innerWidth - 12) x = Math.max(12, r.left - W - gap);
      const y = Math.min(r.top, Math.max(12, window.innerHeight - 200));
      setSrcMenuPos({ x, y });
    } else {
      setSrcMenuPos(null);
    }
    setSrcMenu(k);
  };

  // push a real asset (uploaded or picked from 资产库) into a slot, honoring its max.
  const addRealFile = (k: string, file: { url: string; name?: string; size?: string }) => {
    const slot = slots?.find((s) => s.k === k);
    if (!slot) return;
    setSlotData((prev) => {
      const arr = prev[k] || [];
      if (arr.length >= slotMax(mCfg, tool, slot)) return prev; // silently cap (already warned on open)
      const uf: UploadFile =
        slot.type === "image"
          ? { g: file.url, url: file.url, n: file.name || "参考图", s: file.size || "" }
          : { n: file.name || (slot.type === "video" ? "video.mp4" : "audio.mp3"), d: "", url: file.url };
      return { ...prev, [k]: [...arr, uf] };
    });
  };

  // 本地上传: open the OS file picker for the slot, then upload each chosen file.
  const pickLocal = (k: string) => {
    setSrcMenu(null);
    localTargetRef.current = k;
    const slot = slots?.find((s) => s.k === k);
    const el = fileInputRef.current;
    if (!el) return;
    el.accept = slot?.type === "video" ? "video/*" : slot?.type === "audio" ? "audio/*" : "image/*";
    el.value = "";
    el.click();
  };

  const onLocalFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const k = localTargetRef.current;
    const list = e.target.files;
    if (!k || !list || list.length === 0) return;
    const slot = slots?.find((s) => s.k === k);
    if (!slot) {
      e.target.value = "";
      return;
    }
    const isImg = slot?.type === "image";
    await ensureSession();
    // slotData 上某个占位项打补丁的小工具(按 key 定位;找不到=已被移除,静默跳过)
    const patch = (key: string, fn: (f: UploadFile) => UploadFile) =>
      setSlotData((prev) => ({ ...prev, [k]: (prev[k] || []).map((f) => (f.key === key ? fn(f) : f)) }));
    const drop = (key: string) =>
      setSlotData((prev) => ({ ...prev, [k]: (prev[k] || []).filter((f) => f.key !== key) }));

    // 上限用本地计数判定:不能依赖 setSlotData 更新函数里的标志(那是异步/渲染期
    // 执行的,同步读取拿不到结果)。以当前 slotData 长度起算,每加一个自增。
    const cap = slot ? slotMax(mCfg, tool, slot) : Infinity;
    let curCount = (slotData[k] || []).length;
    for (const file of Array.from(list)) {
      if (curCount >= cap) {
        toast.info(slot ? `${slot.label}最多 ${cap} 个` : "已达上限");
        break;
      }
      curCount++;
      const sizeLabel = (file.size / 1024 / 1024).toFixed(1) + " MB";
      const blobUrl = isImg ? URL.createObjectURL(file) : "";
      const tkey = `up_${uploadSeqRef.current++}`;
      // 立刻插入「上传中」占位:图片带本地预览,让用户马上有反馈,不再以为没传上
      setSlotData((prev) => {
        const uf: UploadFile = isImg
          ? { key: tkey, g: blobUrl, n: file.name, s: sizeLabel, uploading: true, progress: 0 }
          : { key: tkey, n: file.name, d: "", uploading: true, progress: 0 };
        return { ...prev, [k]: [...(prev[k] || []), uf] };
      });
      try {
        const res = await uploadFileSmart(file, (pct) =>
          patch(tkey, (f) => ({ ...f, progress: Math.max(0, Math.min(100, Math.round(pct))) })),
        );
        if (res.success && res.data?.fileUrl) {
          const url = res.data.fileUrl;
          patch(tkey, (f) => ({
            ...f,
            uploading: false,
            progress: 100,
            url,
            ...(isImg ? { g: url } : {}),
          }));
          if (blobUrl) URL.revokeObjectURL(blobUrl); // 换成远程地址后释放本地预览
        } else {
          drop(tkey);
          if (blobUrl) URL.revokeObjectURL(blobUrl);
          toast.error("上传失败：" + (res.message || file.name));
        }
      } catch {
        drop(tkey);
        if (blobUrl) URL.revokeObjectURL(blobUrl);
        toast.error("上传失败：" + file.name);
      }
    }
    e.target.value = "";
  };

  // 资产库: open the full assets browser as a picker dialog for this slot.
  const openAssets = (k: string) => {
    setSrcMenu(null);
    setAssetPick(k);
  };

  const chooseAsset = (a: PickedAsset) => {
    const k = assetPick;
    setAssetPick(null);
    if (k) addRealFile(k, { url: a.url, name: a.name });
  };

  const removeFile = (k: string, i: number) =>
    setSlotData((prev) => {
      const arr = (prev[k] || []).slice();
      arr.splice(i, 1);
      return { ...prev, [k]: arr };
    });

  const swapFlf = () =>
    setSlotData((prev) => {
      if (!(prev.first || prev.last)) return prev;
      toast.success("已交换首尾帧");
      return { ...prev, first: prev.last, last: prev.first };
    });

  return {
    srcMenu,
    setSrcMenu,
    srcMenuPos,
    assetPick,
    setAssetPick,
    fileInputRef,
    addFile,
    pickLocal,
    onLocalFiles,
    openAssets,
    chooseAsset,
    removeFile,
    swapFlf,
  };
}
