"use client";

/* ── reference media lifecycle (P2, extracted verbatim from page.tsx) ──────────
   参考素材：本地挑选 / 拖放 / 粘贴 / 资产库 → blob 预览 → 上传回填托管 url。
   blob URL 生命周期（三处 revoke：移除 / 送出或策略收敛 / 卸载与切对话）、
   race-guard、同 url 去重、@ 引用候选编号都在这里。 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { uploadFileSmart } from "@/lib/api";
import { toast } from "@/components/shared/toast";
import { type PickedAsset } from "@/components/studio/assets-browser";
import { buildMentionRefs } from "@/components/studio/mention-prompt-editor";
import {
  extOf,
  fileKind,
  fileNameFromUrl,
  type RefItem,
  type RefKind,
  type RefPolicy,
} from "../_components/chat-utils";

export function useReferences({ refPolicy }: { refPolicy: RefPolicy | undefined }) {
  // reference media (P2): attached refs + drag state. refsRef mirrors refs for
  // race-guards (upload callbacks) and unmount revoke without stale closures.
  const [refs, setRefs] = useState<RefItem[]>([]);
  const refsRef = useRef<RefItem[]>([]);
  // synchronous count of accepted refs — authoritative across same-tick attaches
  // (refsRef only catches up via an effect). Re-synced from refs on every commit.
  const refCountRef = useRef(0);
  const refSeq = useRef(0);
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // reference-source flow: a 来源 menu (本地上传 / 资产库) anchored to the ＋ button,
  // plus the 资产库 picker dialog. Mirrors 创作台 create-studio's source flow.
  const [srcMenuPos, setSrcMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [assetPickOpen, setAssetPickOpen] = useState(false);

  // keep refsRef + the synchronous count in sync for stale-closure-free access
  // in callbacks/cleanup (re-syncs the count after adds/removals/dedup drops).
  useEffect(() => {
    refsRef.current = refs;
    refCountRef.current = refs.length;
  }, [refs]);

  // dismiss the 来源 menu / 资产库 dialog if the model stops supporting uploads
  // (switched to a no-upload model while one was open).
  useEffect(() => {
    if (!refPolicy) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 关闭浮层是对 refPolicy 消失的收敛动作，一次性且无级联
      setSrcMenuPos(null);
      setAssetPickOpen(false);
    }
  }, [refPolicy]);

  // Escape closes the 来源 menu (parity with the other popovers in this view).
  useEffect(() => {
    if (!srcMenuPos) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setSrcMenuPos(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [srcMenuPos]);

  // revoke every blob preview on unmount (avoid leaking object URLs).
  useEffect(() => {
    return () => {
      for (const r of refsRef.current) URL.revokeObjectURL(r.blobUrl);
    };
  }, []);

  // drop references that the current mode no longer accepts (e.g. switching from
  // an image-ref mode to t2v); revoke their blobs.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 按新策略收敛已挂素材，函数式更新且带 no-op 短路，无级联
    setRefs((prev) => {
      if (!prev.length) return prev;
      const keep = refPolicy ? prev.filter((r) => refPolicy.kinds.includes(r.kind)) : [];
      if (keep.length === prev.length) return prev;
      for (const r of prev) if (!keep.includes(r)) URL.revokeObjectURL(r.blobUrl);
      return keep;
    });
  }, [refPolicy]);

  // upload one reference: hosted URL replaces the blob on success; race-guard
  // drops the result if the ref was removed mid-flight; dedup collapses same-url.
  const uploadRef = useCallback(async (key: string, file: File, blobUrl: string) => {
    const res = await uploadFileSmart(file).catch(() => null);
    setRefs((cur) => {
      const idx = cur.findIndex((r) => r.key === key);
      if (idx < 0) {
        URL.revokeObjectURL(blobUrl); // removed while uploading
        return cur;
      }
      const url = res?.success ? res.data?.fileUrl : undefined;
      if (url && cur.some((r) => r.key !== key && r.url === url)) {
        URL.revokeObjectURL(blobUrl); // same bytes already attached → dedup
        return cur.filter((r) => r.key !== key);
      }
      const next = cur.slice();
      next[idx] = url
        ? { ...next[idx], uploading: false, url }
        : { ...next[idx], uploading: false, failed: true };
      return next;
    });
  }, []);

  // route picked/dropped/pasted files into the current mode's reference slots.
  const attachFiles = useCallback(
    (files: FileList | File[]) => {
      const policy = refPolicy;
      if (!policy) {
        toast.info("当前模式不支持参考素材");
        return;
      }
      const fresh: { item: RefItem; file: File }[] = [];
      // use the synchronous counter (not the effect-lagged refsRef) so two attaches
      // in the same tick can't both read a stale length and exceed policy.max.
      let count = refCountRef.current;
      const sizeCap = policy.maxSizeMB && policy.maxSizeMB > 0 ? policy.maxSizeMB : 0;
      for (const file of Array.from(files)) {
        const kind = fileKind(file);
        if (!policy.kinds.includes(kind)) continue;
        // 后台配置了格式白名单 → 扩展名不在列直接拒收并提示
        if (policy.exts && !policy.exts.includes(extOf(file.name))) {
          toast.info(`「${file.name}」格式不支持，允许：${policy.exts.join(" / ")}`);
          continue;
        }
        if (count >= policy.max) {
          toast.info(`最多添加 ${policy.max} 个文件`);
          break;
        }
        if (sizeCap && file.size > sizeCap * 1024 * 1024) {
          toast.info(`「${file.name}」超过 ${sizeCap}MB 上限`);
          continue;
        }
        const blobUrl = URL.createObjectURL(file);
        fresh.push({ item: { key: `r${refSeq.current++}`, kind, blobUrl, name: file.name, uploading: true }, file });
        count++;
      }
      if (!fresh.length) return;
      refCountRef.current = count; // commit synchronously before the next call reads it
      setRefs((prev) => [...prev, ...fresh.map((f) => f.item)]);
      for (const { item, file } of fresh) void uploadRef(item.key, file, item.blobUrl);
    },
    [refPolicy, uploadRef],
  );

  const removeRef = useCallback((key: string) => {
    setRefs((prev) => {
      const r = prev.find((x) => x.key === key);
      if (r) URL.revokeObjectURL(r.blobUrl);
      return prev.filter((x) => x.key !== key);
    });
  }, []);

  const clearRefs = useCallback(() => {
    setRefs((prev) => {
      for (const r of prev) URL.revokeObjectURL(r.blobUrl);
      return [];
    });
  }, []);

  /** Clear only the exact set consumed by a completed request. Users may start
   * preparing the next prompt while a request is in flight; a blanket clear at
   * completion would otherwise delete newly-added references. */
  const clearRefsIfUnchanged = useCallback(
    (snapshot: readonly Pick<RefItem, "key" | "kind" | "url">[]) => {
      setRefs((prev) => {
        const unchanged =
          prev.length === snapshot.length &&
          prev.every((ref, index) => {
            const expected = snapshot[index];
            return ref.key === expected.key && ref.kind === expected.kind && ref.url === expected.url;
          });
        if (!unchanged) return prev;
        for (const ref of prev) URL.revokeObjectURL(ref.blobUrl);
        return [];
      });
    },
    [],
  );

  /** Restore a retry journal's hosted references only when the composer is
   * still empty. This is used after a definitive text-turn rejection following
   * a reload; it never replaces files the user has since attached. */
  const restoreRefsIfEmpty = useCallback(
    (snapshot: readonly Pick<RefItem, "key" | "kind" | "url" | "name">[]) => {
      setRefs((prev) => {
        if (prev.length) return prev;
        const restored = snapshot
          .filter((ref): ref is typeof ref & { url: string } => typeof ref.url === "string" && !!ref.url)
          .map((ref) => ({
            key: ref.key,
            kind: ref.kind,
            blobUrl: "",
            url: ref.url,
            name: ref.name,
            uploading: false,
          }));
        if (!restored.length) return prev;
        // Avoid colliding with restored rN keys when the user attaches another
        // file in this tab after recovery.
        for (const ref of restored) {
          const match = /^r(\d+)$/.exec(ref.key);
          if (match) refSeq.current = Math.max(refSeq.current, Number(match[1]) + 1);
        }
        return restored;
      });
    },
    [],
  );

  // add an already-hosted asset (picked from 资产库) directly as a reference — no
  // upload needed; honors the policy kinds/max and dedups by url.
  const addAssetRef = useCallback(
    (url: string, kind: RefKind) => {
      const policy = refPolicy;
      if (!policy) return;
      if (!policy.kinds.includes(kind)) {
        toast.info("当前模式不支持该类型素材");
        return;
      }
      // 与本地上传同口径:后台配置了格式白名单则校验扩展名
      if (policy.exts && !policy.exts.includes(extOf(fileNameFromUrl(url)))) {
        toast.info(`该素材格式不支持，允许：${policy.exts.join(" / ")}`);
        return;
      }
      if (refsRef.current.some((r) => r.url === url)) {
        toast.info("该素材已添加");
        return;
      }
      if (refCountRef.current >= policy.max) {
        toast.info(`最多添加 ${policy.max} 个文件`);
        return;
      }
      refCountRef.current += 1; // commit synchronously before any follow-up add
      setRefs((prev) => [
        ...prev,
        { key: `r${refSeq.current++}`, kind, blobUrl: "", url, name: fileNameFromUrl(url), uploading: false },
      ]);
    },
    [refPolicy],
  );

  // open the 来源 menu (本地上传 / 资产库) anchored above the ＋ button. Flips to
  // below if there isn't room above; clamps within the viewport.
  const srcAnchorRef = useRef<DOMRect | null>(null);
  const srcMenuElRef = useRef<HTMLDivElement>(null);
  const openSrcMenu = useCallback(
    (e: React.MouseEvent) => {
      if (!refPolicy) return;
      if (refCountRef.current >= refPolicy.max) {
        toast.info(`最多添加 ${refPolicy.max} 个文件`);
        return;
      }
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      srcAnchorRef.current = r; // 渲染后按菜单实测尺寸重钳制（见下方 layout effect）
      const W = 300;
      const H = 168;
      const gap = 8;
      let x = r.left;
      if (x + W > window.innerWidth - 12) x = Math.max(12, window.innerWidth - 12 - W);
      let y = r.top - H - gap;
      if (y < 12) y = r.bottom + gap; // not enough room above → drop below
      setSrcMenuPos({ x, y });
    },
    [refPolicy],
  );

  // 首次定位用的是估算高度（H=168），实际菜单 ~200px，会盖住 ＋ 按钮/越出视口底；
  // 渲染后按真实尺寸对着锚点矩形重新钳制一次（值不变则不重渲染）。
  useLayoutEffect(() => {
    if (!srcMenuPos) return;
    const el = srcMenuElRef.current;
    const a = srcAnchorRef.current;
    if (!el || !a) return;
    const gap = 8;
    const H = el.offsetHeight;
    const W = el.offsetWidth;
    let x = a.left;
    if (x + W > window.innerWidth - 12) x = Math.max(12, window.innerWidth - 12 - W);
    let y = a.top - H - gap;
    if (y < 12) y = Math.min(a.bottom + gap, window.innerHeight - H - 12); // 翻转后也不许越出底缘
    if (x !== srcMenuPos.x || y !== srcMenuPos.y) setSrcMenuPos({ x, y });
  }, [srcMenuPos]);

  // 本地上传: close the menu and open the OS file picker (onChange → attachFiles).
  const pickLocal = useCallback(() => {
    setSrcMenuPos(null);
    fileInputRef.current?.click();
  }, []);

  // 资产库: close the menu and open the assets picker dialog.
  const openAssets = useCallback(() => {
    setSrcMenuPos(null);
    setAssetPickOpen(true);
  }, []);

  // an asset chosen from 资产库 → add it as a hosted reference. 文档("doc")映射为
  // RefKind "file"：文本模型（kinds 含 file）可挂文档附件；媒体生成模式仍会被
  // addAssetRef 的 kinds 校验拒绝，不会把文档 URL 当图片发给模型。
  const chooseAsset = useCallback(
    (a: PickedAsset) => {
      setAssetPickOpen(false);
      const kind: RefKind | null =
        a.kind === "image" || a.kind === "video" || a.kind === "audio" ? a.kind : a.kind === "doc" ? "file" : null;
      if (!kind) {
        toast.info("当前模式不支持该类型素材");
        return;
      }
      addAssetRef(a.url, kind);
    },
    [addAssetRef],
  );

  // drag-and-drop onto the composer (dragDepth counter avoids overlay flicker
  // from nested dragenter/leave) + paste of files.
  const onDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (!refPolicy) return;
      e.preventDefault();
      dragDepth.current++;
      setDragOver(true);
    },
    [refPolicy],
  );
  const onDragOver = useCallback(
    (e: React.DragEvent) => {
      if (refPolicy) e.preventDefault();
    },
    [refPolicy],
  );
  const onDragLeave = useCallback(
    (e: React.DragEvent) => {
      if (!refPolicy) return;
      e.preventDefault();
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragOver(false);
    },
    [refPolicy],
  );
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      if (!refPolicy) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragOver(false);
      if (e.dataTransfer.files?.length) attachFiles(e.dataTransfer.files);
    },
    [refPolicy, attachFiles],
  );

  // restore reference media as url-only items (the originals are hosted; no
  // local blob/file is recreated). Lets 再次生成 work on a reference turn.
  const restoreRefs = useCallback(
    (raw: unknown) => {
      clearRefs();
      if (Array.isArray(raw)) {
        const restored: RefItem[] = [];
        for (const r of raw) {
          const url = r && typeof r === "object" ? (r as { url?: unknown }).url : undefined;
          if (typeof url !== "string" || !url) continue;
          const k = (r as { kind?: unknown }).kind;
          const kind: RefKind = k === "video" ? "video" : k === "audio" ? "audio" : k === "file" ? "file" : "image";
          restored.push({ key: `r${refSeq.current++}`, kind, blobUrl: "", url, uploading: false });
        }
        if (restored.length) setRefs(restored);
      }
    },
    [clearRefs],
  );

  // ── @ 引用（富文本 pill 版，与创作台共用 MentionPromptEditor）────────────────
  // 输入 @ 弹出已挂参考素材的候选菜单，选中在光标处插入带缩略图的内联 pill，
  // 序列化为「图片N/视频N/音频N」——N 按 kind 编号，与 send() 组装
  // imageList / videoReferences / audioReferences 的顺序严格一致。
  // 编号必须覆盖「全部」已挂素材（含上传中的）再过滤出可选项：若只给传完的
  // 编号，先传完的那张会被编成图片1，等前面的传完后整体位移，已插入正文的
  // pill 会静默换绑到另一张图。send() 发送时按 refs 全序组装，编号天然对齐。
  const mentionRefs = useMemo(() => {
    if (!refPolicy) return [];
    // 文档类("file")不参与 @ 引用：模型侧只接收图片，@文件N 无意义。
    // 先过滤再编号，编号与过滤后的数组对齐（buildMentionRefs 按 kind 分别计数，
    // 剔除 file 不影响 图片N/视频N/音频N 的序号）。
    const mentionable = refs.filter((r) => r.kind !== "file");
    return buildMentionRefs(
      mentionable.map((r) => ({ key: r.key, kind: r.kind as Exclude<RefKind, "file">, thumb: r.url || r.blobUrl })),
    ).filter((_, i) => !!mentionable[i].url);
  }, [refPolicy, refs]);

  return {
    refs,
    attachFiles,
    removeRef,
    clearRefs,
    clearRefsIfUnchanged,
    restoreRefsIfEmpty,
    addAssetRef,
    restoreRefs,
    mentionRefs,
    dragOver,
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
    fileInputRef,
    srcMenuPos,
    setSrcMenuPos,
    srcMenuElRef,
    openSrcMenu,
    pickLocal,
    openAssets,
    assetPickOpen,
    setAssetPickOpen,
    chooseAsset,
  };
}

export type ReferencesApi = ReturnType<typeof useReferences>;
