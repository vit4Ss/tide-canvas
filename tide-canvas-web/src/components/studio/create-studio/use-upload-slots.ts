/* 参考素材上传槽位 hook。
   负责：槽位文件的增删换（本地上传带进度占位 / 资产库选取）、模型级大小与
   数量限制、来源选择菜单（srcMenu）与资产库弹窗（assetPick）的开合。
   slotData 本身由组合层持有（生成引擎 / @ 引用 / 参数恢复都要读），这里只收
   setter 与当前值。 */

import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { fileApi, uploadFileSmart } from "@/lib/api";
import { validateKnownFileSize } from "@/lib/upload-limits";
import { measureImageSize, videoReferenceImageAspectIssue } from "@/lib/aspect-ratio";
import { ossDisplayUrl } from "@/lib/oss-display";
import type { ModelConfig } from "@/types/admin-models";
import type { PickedAsset } from "@/components/studio/assets-browser";
import { toast } from "@/components/shared/toast";
import type { SlotData, SlotDef, ToolKey, UploadFile } from "./types";
import { refLimitFor, slotMax, threeDMultiViewLimit } from "./utils";

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

  // 3D 的单图大小是硬限制（模型配置 max3DImageSizeMB），未知大小不能放行。
  const needsKnownSize = tool === "i2_3d" || tool === "mv2_3d";

  const totalUploadedCount = (data: SlotData): number =>
    (slots ?? []).reduce((sum, slot) => sum + (data[slot.k] || []).length, 0);

  const capacityIssue = (data: SlotData, slot: SlotDef): string | null => {
    const perSlotLimit = slotMax(mCfg, tool, slot);
    if ((data[slot.k] || []).length >= perSlotLimit) {
      return tool === "mv2_3d"
        ? `${slot.label}仅支持上传 ${perSlotLimit} 张图片`
        : `${slot.label}最多 ${perSlotLimit} 个`;
    }
    if (tool === "mv2_3d") {
      const totalLimit = threeDMultiViewLimit(mCfg);
      if (totalUploadedCount(data) >= totalLimit) return `多视图最多上传 ${totalLimit} 张图片`;
    }
    return null;
  };

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
    const issue = capacityIssue(slotData, slot);
    if (issue) {
      toast.info(issue);
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

  type RealFile = {
    url: string;
    name?: string;
    size?: string;
    sizeBytes?: number;
    width?: number;
    height?: number;
  };

  const toUploadFile = (slot: SlotDef, file: RealFile): UploadFile =>
    slot.type === "image"
      ? {
          g: file.url,
          url: file.url,
          n: file.name || "参考图",
          s: file.size || "",
          sizeBytes: file.sizeBytes,
          width: file.width,
          height: file.height,
        }
      : { n: file.name || (slot.type === "video" ? "video.mp4" : "audio.mp3"), d: "", url: file.url };

  /** 只有视频生成的图片参考槽位使用供应商 0.4–2.5 比例限制。 */
  const needsVideoImageAspect = (slot: SlotDef) =>
    slot.type === "image" && (tool === "i2v" || tool === "flf" || tool === "ref");

  /** 槽位还能再放几个：本槽上限与（多视图的）总上限取小。 */
  const roomFor = (data: SlotData, slot: SlotDef): number => {
    const perSlot = slotMax(mCfg, tool, slot) - (data[slot.k] || []).length;
    const total = tool === "mv2_3d" ? threeDMultiViewLimit(mCfg) - totalUploadedCount(data) : Infinity;
    return Math.max(0, Math.min(perSlot, total));
  };

  // push real assets (uploaded or picked from 资产库) into a slot, honoring its max.
  // 一次收一批：多选确认后逐个 setSlotData 会各自读到旧的 prev 长度，容量判定
  // 只有合到同一次更新里才准。
  const addRealFiles = (k: string, files: RealFile[]): number => {
    const slot = slots?.find((s) => s.k === k);
    if (!slot || files.length === 0) return 0;
    const issue = capacityIssue(slotData, slot);
    if (issue) {
      toast.info(issue);
      return 0;
    }
    const sizeMB = refLimitFor(mCfg, tool, slot).size;
    const passed: RealFile[] = [];
    let unknownSize = 0;
    let sizeIssue: string | null = null;
    for (const file of files) {
      if (needsKnownSize && (!Number.isFinite(file.sizeBytes) || !file.sizeBytes || file.sizeBytes <= 0)) {
        unknownSize += 1;
        continue;
      }
      const tooLarge = validateKnownFileSize(file.sizeBytes, file.name, {
        maxBytes: sizeMB > 0 ? sizeMB * 1024 * 1024 : undefined,
        label: slot.label,
      });
      if (tooLarge) {
        sizeIssue ??= tooLarge;
        continue;
      }
      passed.push(file);
    }
    if (unknownSize > 0) {
      toast.info(
        unknownSize > 1
          ? `有 ${unknownSize} 个素材无法确认文件大小，请下载后通过本地上传添加`
          : "无法确认该素材的文件大小，请下载后通过本地上传添加",
      );
    }
    if (sizeIssue) toast.info(sizeIssue);

    const accepted = passed.slice(0, roomFor(slotData, slot));
    if (accepted.length === 0) return 0;
    if (accepted.length < passed.length) {
      toast.info(`已添加 ${accepted.length} 个，其余超出${slot.label}数量上限`);
    }
    setSlotData((prev) => {
      // 以 prev 复算余量：与上面基于闭包 slotData 的切片一致（弹窗期间没有
      // 并发写入），重算只是把 StrictMode 下的重复调用做成幂等。
      const take = accepted.slice(0, roomFor(prev, slot));
      if (take.length === 0) return prev;
      return { ...prev, [k]: [...(prev[k] || []), ...take.map((f) => toUploadFile(slot, f))] };
    });
    return accepted.length;
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
    if (!(await ensureSession())) {
      e.target.value = "";
      return;
    }
    // slotData 上某个占位项打补丁的小工具(按 key 定位;找不到=已被移除,静默跳过)
    const patch = (key: string, fn: (f: UploadFile) => UploadFile) =>
      setSlotData((prev) => ({ ...prev, [k]: (prev[k] || []).map((f) => (f.key === key ? fn(f) : f)) }));
    const drop = (key: string) =>
      setSlotData((prev) => ({ ...prev, [k]: (prev[k] || []).filter((f) => f.key !== key) }));

    // 上限用本地计数判定:不能依赖 setSlotData 更新函数里的标志(那是异步/渲染期
    // 执行的,同步读取拿不到结果)。以当前 slotData 长度起算,每加一个自增。
    const perSlotCap = slotMax(mCfg, tool, slot);
    const totalCap = tool === "mv2_3d" ? threeDMultiViewLimit(mCfg) : Infinity;
    let currentSlotCount = (slotData[k] || []).length;
    let currentTotalCount = tool === "mv2_3d" ? totalUploadedCount(slotData) : currentSlotCount;
    const sizeMB = refLimitFor(mCfg, tool, slot).size;
    for (const file of Array.from(list)) {
      if (currentSlotCount >= perSlotCap) {
        toast.info(tool === "mv2_3d" ? `${slot.label}仅支持上传 ${perSlotCap} 张图片` : `${slot.label}最多 ${perSlotCap} 个`);
        break;
      }
      if (currentTotalCount >= totalCap) {
        toast.info(`多视图最多上传 ${totalCap} 张图片`);
        break;
      }
      const sizeIssue = validateKnownFileSize(file.size, file.name, {
        maxBytes: sizeMB > 0 ? sizeMB * 1024 * 1024 : undefined,
        label: slot.label,
      });
      if (sizeIssue) {
        toast.info(sizeIssue);
        continue;
      }
      const sizeLabel = (file.size / 1024 / 1024).toFixed(1) + " MB";
      const blobUrl = isImg ? URL.createObjectURL(file) : "";
      let dimensions: { width: number; height: number } | null = null;
      if (isImg && needsVideoImageAspect(slot)) {
        dimensions = await measureImageSize(blobUrl);
        const aspectIssue = dimensions
          ? videoReferenceImageAspectIssue(dimensions.width, dimensions.height, file.name || "参考图")
          : `${file.name || "参考图"}：无法读取有效尺寸，请重新选择图片`;
        if (aspectIssue) {
          if (blobUrl) URL.revokeObjectURL(blobUrl);
          toast.error(aspectIssue);
          continue;
        }
      }
      currentSlotCount++;
      currentTotalCount++;
      const tkey = `up_${uploadSeqRef.current++}`;
      // 立刻插入「上传中」占位:图片带本地预览,让用户马上有反馈,不再以为没传上
      setSlotData((prev) => {
        const uf: UploadFile = isImg
          ? {
              key: tkey,
              g: blobUrl,
              n: file.name,
              s: sizeLabel,
              sizeBytes: file.size,
              width: dimensions?.width,
              height: dimensions?.height,
              uploading: true,
              progress: 0,
            }
          : { key: tkey, n: file.name, d: "", uploading: true, progress: 0 };
        return { ...prev, [k]: [...(prev[k] || []), uf] };
      });
      try {
        const res = await uploadFileSmart(
          file,
          (pct) => patch(tkey, (f) => ({ ...f, progress: Math.max(0, Math.min(100, Math.round(pct))) })),
          {
            maxBytes: sizeMB > 0 ? sizeMB * 1024 * 1024 : undefined,
            label: slot.label,
          },
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

  // 资产库选取(可多选):生成历史的结果直接写在对象存储里、没有 files 行,
  // PickedAsset 因此不带 sizeBytes。3D 必须按模型配置卡单图大小(refLimitFor),
  // 未知大小只能拒收,而「生成一张图 → 转 3D」恰恰是最常见的用法。这里先并发
  // 问一次存储把大小补齐,查不到才落回本地上传的提示。
  const chooseAssets = async (assets: PickedAsset[]) => {
    const k = assetPick;
    if (!k || assets.length === 0) return;
    const slot = slots?.find((candidate) => candidate.k === k);
    if (!slot) return;
    // 先收起弹窗再做 3D 素材大小查询。网络查询可能需要数秒，不能让用户
    // 留在仍可点击的选择器里误以为卡死、反复提交同一批素材。
    setAssetPick(null);
    const files = await Promise.all(
      assets.map(async (a, index) => {
        let sizeBytes = a.sizeBytes;
        const [sizeResult, dimensions] = await Promise.all([
          needsKnownSize && (!Number.isFinite(sizeBytes) || !sizeBytes || sizeBytes <= 0)
            ? fileApi.assetSize(a.url).catch(() => null)
            : Promise.resolve(null),
          needsVideoImageAspect(slot)
            ? measureImageSize(ossDisplayUrl(a.url, 96) ?? a.url)
            : Promise.resolve(null),
        ]);
        const resolved = sizeResult?.success ? sizeResult.data?.sizeBytes : undefined;
        if (Number.isFinite(resolved) && (resolved ?? 0) > 0) sizeBytes = resolved;
        const label = assets.length > 1 ? `第 ${index + 1} 张参考图（${a.name || "未命名"}）` : (a.name || "参考图");
        const aspectIssue = needsVideoImageAspect(slot)
          ? dimensions
            ? videoReferenceImageAspectIssue(dimensions.width, dimensions.height, label)
            : `${label}：无法读取有效尺寸，请重新选择图片`
          : null;
        return {
          url: a.url,
          name: a.name,
          sizeBytes,
          width: dimensions?.width,
          height: dimensions?.height,
          aspectIssue,
        };
      }),
    );
    const rejected = files.filter((file) => file.aspectIssue);
    if (rejected.length > 0) {
      const first = rejected[0].aspectIssue!;
      toast.error(rejected.length > 1 ? `${first}；另有 ${rejected.length - 1} 张图片比例不符合要求` : first);
    }
    addRealFiles(k, files.filter((file) => !file.aspectIssue));
  };

  /** 弹窗需要的槽位余量与去重信息（当前打开的槽位；未打开时为空）。
      memo 住数组身份：弹窗开着时父层每次重渲染（输入提示词等）都新建数组，
      会让资产库整张网格跟着重渲染。 */
  const assetPickExistingUrls = useMemo(() => {
    const slot = slots?.find((s) => s.k === assetPick);
    if (!slot) return [];
    return (slotData[slot.k] || []).map((f) => f.url || f.g || "").filter(Boolean);
  }, [assetPick, slotData, slots]);
  const assetPickSlot = slots?.find((s) => s.k === assetPick);
  const assetPickRemaining = assetPickSlot ? roomFor(slotData, assetPickSlot) : 0;

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
    assetPickRemaining,
    assetPickExistingUrls,
    fileInputRef,
    addFile,
    pickLocal,
    onLocalFiles,
    openAssets,
    chooseAssets,
    removeFile,
    swapFlf,
  };
}
