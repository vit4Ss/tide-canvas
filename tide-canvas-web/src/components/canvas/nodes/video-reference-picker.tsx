"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Popover } from "@mantine/core";
import { ArrowUpRight, AudioLines, FileText, Image as ImageIcon, Layers, Search, UserRound, Video, X } from "lucide-react";
import { useCanvasStore, type CanvasNode } from "@/stores/use-canvas-store";
import { canvasVideoReferences, type CanvasVideoReferenceKind } from "@/lib/canvas-video-references";
import { ossDisplayUrl } from "@/lib/oss-display";

interface Props {
  nodeId: string;
  allowedKinds?: readonly CanvasVideoReferenceKind[];
  characterOnly?: boolean;
  onPick: (source: CanvasNode) => void;
  disabled?: boolean;
  label?: string;
  onOpenLibrary?: () => void;
}

const KIND_LABELS = { image: "图片", video: "视频", audio: "音频", text: "文本" } as const;
const KIND_ICONS = { image: ImageIcon, video: Video, audio: AudioLines, text: FileText } as const;

/** Presents available canvas sources. The caller owns model validation and graph mutations. */
export function CanvasReferencePicker({ nodeId, allowedKinds, characterOnly = false, onPick, disabled = false, label, onOpenLibrary }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const title = label || (characterOnly ? "画布角色" : "画布参考");
  const nodes = useCanvasStore((state) => state.nodes);
  const connections = useCanvasStore((state) => state.connections);
  const candidates = useMemo(
    () => canvasVideoReferences(nodes, connections, nodeId, { allowedKinds, characterOnly }),
    [nodes, connections, nodeId, allowedKinds, characterOnly],
  );
  const search = query.trim().toLocaleLowerCase();
  const visible = candidates.filter(({ node, kind, settingOnly }) =>
    `${node.title || ""} ${settingOnly ? node.type === "scene" ? "场景设定" : "角色设定" : KIND_LABELS[kind]}`.toLocaleLowerCase().includes(search),
  );
  const opened = open && !disabled;
  useEffect(() => {
    if (!opened) return;
    const closeOnOutsideWheel = (event: WheelEvent) => {
      if (event.target instanceof Node && (panelRef.current?.contains(event.target) || triggerRef.current?.contains(event.target))) return;
      setOpen(false);
    };
    document.addEventListener("wheel", closeOnOutsideWheel, { capture: true, passive: true });
    return () => document.removeEventListener("wheel", closeOnOutsideWheel, true);
  }, [opened]);

  return <Popover opened={opened} onChange={setOpen} position="top-start" width={320}
    withinPortal floatingStrategy="fixed" zIndex={130} trapFocus returnFocus
    middlewares={{ flip: true, shift: { padding: 12, crossAxis: true } }}>
    <Popover.Target>
      <button ref={triggerRef} type="button" className="image-composer-chip" aria-label={`选择${title}`}
        aria-haspopup="dialog" aria-expanded={opened} aria-controls={opened ? panelId : undefined}
        disabled={disabled} onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setOpen(false); } }}
        onClick={() => { setQuery(""); setOpen((value) => !value); }}>
        {characterOnly ? <UserRound size={13} aria-hidden /> : <Layers size={13} aria-hidden />}{title}
      </button>
    </Popover.Target>
    <Popover.Dropdown ref={panelRef} id={panelId} className="image-reference-menu" role="dialog" aria-label={title}
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Escape") setOpen(false); }}>
      <header><span>{title}<span className="ml-2 text-xs font-normal text-[var(--muted-foreground)]">{candidates.length} 项可选</span></span>
        <button type="button" aria-label={`关闭${title}`} onClick={() => setOpen(false)}><X size={14} aria-hidden /></button>
      </header>
      <p>{characterOnly ? "选择角色图片或文字设定，加入当前视频参考。" : "选择素材建立引用，已连接的素材不会重复显示。"}</p>
      <label className="image-reference-search"><Search size={14} aria-hidden />
        <input ref={searchRef} data-autofocus aria-label={`搜索${title}`} placeholder={characterOnly ? "搜索角色名称" : "搜索素材名称"}
          value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>
      <div className="image-reference-list">
        {visible.map(({ node, kind, settingOnly }) => {
          const Icon = settingOnly ? UserRound : KIND_ICONS[kind];
          const kindLabel = settingOnly ? node.type === "scene" ? "场景设定" : "角色设定" : KIND_LABELS[kind];
          const name = node.title || `未命名${kindLabel}`;
          return <button key={node.id} type="button" aria-label={`引用${name}`} onClick={() => {
            const store = useCanvasStore.getState();
            const current = canvasVideoReferences(store.nodes, store.connections, nodeId, { allowedKinds, characterOnly }).find((item) => item.node.id === node.id);
            if (!current) return;
            onPick(current.node);
            // The chosen row disappears once its connection is added; keep keyboard focus in this picker.
            searchRef.current?.focus({ preventScroll: true });
          }}>
            {kind === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={ossDisplayUrl(node.imageSrc, 128) || node.imageSrc} alt="" loading="lazy" />
            ) : <span className="grid h-10 w-10 shrink-0 place-items-center rounded bg-[var(--muted)] text-[var(--muted-foreground)]"><Icon size={18} aria-hidden /></span>}
            <span className="min-w-0 flex-1"><span className="block truncate">{name}</span><span className="block text-[11px] text-[var(--muted-foreground)]">{kindLabel}</span></span>
            <span className="image-reference-check text-[var(--muted-foreground)]"><ArrowUpRight size={14} aria-hidden /></span>
          </button>;
        })}
        {!visible.length && <div className="image-reference-empty"><Layers size={24} aria-hidden />
          <span>{search ? "没有匹配的素材" : characterOnly ? "暂无可引用角色" : "暂无可引用素材"}</span>
          <p>{search ? "试试其他名称" : characterOnly ? "添加角色节点并填写设定或生成图片后，可在这里引用。" : "上传或生成素材后可在这里引用；已连接和处理中的节点不会显示。"}</p>
        </div>}
      </div>
      {onOpenLibrary && <button type="button" className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-neutral-200 px-3 py-2 text-xs hover:bg-neutral-50"
        onClick={() => { setOpen(false); onOpenLibrary(); }}><UserRound size={14} aria-hidden />从角色资产库选择</button>}
    </Popover.Dropdown>
  </Popover>;
}
