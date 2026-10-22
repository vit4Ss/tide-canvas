"use client";

import { useMemo, useState } from "react";
import { Popover } from "@mantine/core";
import { Check, Image as ImageIcon, Layers, Search, X } from "lucide-react";
import { useCanvasStore } from "@/stores/use-canvas-store";
import { canvasImageReferences, imageReferenceCount } from "@/lib/canvas-image-references";
import { ossDisplayUrl } from "@/lib/oss-display";
import { toast } from "@/components/shared/toast";

interface Props { nodeId: string; limit?: number; disabled?: boolean; validate: (id: string) => boolean }

export function ImageReferencePicker({ nodeId, limit, disabled, validate }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const nodes = useCanvasStore((state) => state.nodes);
  const connections = useCanvasStore((state) => state.connections);
  const candidates = useMemo(() => canvasImageReferences(nodes, connections, nodeId), [nodes, connections, nodeId]);
  const selected = new Set(connections.filter((connection) => connection.targetId === nodeId).map((connection) => connection.sourceId));
  const selectedCount = candidates.filter((node) => selected.has(node.id)).length;
  const visible = candidates.filter((node) => (node.title || "").toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const toggle = (sourceId: string) => {
    const store = useCanvasStore.getState();
    const target = store.nodes.find((node) => node.id === nodeId);
    if (!target || target.uploading || target.pendingGeneration || target.status === "generating") return;
    const existing = store.connections.filter((connection) => connection.sourceId === sourceId && connection.targetId === nodeId);
    if (existing.length) {
      store.pushHistory();
      existing.forEach((connection) => store.removeConnection(connection.id, false));
      return;
    }
    if (!canvasImageReferences(store.nodes, store.connections, nodeId).some((node) => node.id === sourceId)) { toast.info("该图片当前不可作为参考，请重新选择"); return; }
    if (limit && imageReferenceCount(store.nodes, store.connections, nodeId) >= limit) { toast.info(`当前模型最多支持 ${limit} 张输入图片（包含节点自身图片）`); return; }
    if (!validate(sourceId)) return;
    store.addConnection({ id: `reference_${sourceId}_${nodeId}`, sourceId, targetId: nodeId });
  };
  return <Popover opened={open && !disabled} onChange={setOpen} position="top-start" width={320} withinPortal floatingStrategy="fixed" zIndex={130}>
    <Popover.Target><button type="button" className="image-composer-chip" aria-label="选择画布参考图片" aria-expanded={open} disabled={disabled} onMouseDown={(event) => event.stopPropagation()} onClick={() => { setQuery(""); setOpen((value) => !value); }}><Layers size={13} />画布参考{selectedCount > 0 && <span className="image-composer-count">{selectedCount}</span>}</button></Popover.Target>
    <Popover.Dropdown className="image-reference-menu" role="dialog" aria-label="画布参考图片" onMouseDown={(event) => event.stopPropagation()} onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Escape") setOpen(false); }}>
      <header><span>画布参考</span><button type="button" aria-label="关闭画布参考" onClick={() => setOpen(false)}><X size={14} /></button></header>
      <p>选择图片建立连线，再次点击可取消引用。</p>
      <label className="image-reference-search"><Search size={14} /><input aria-label="搜索画布图片" placeholder="搜索图片名称" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <div className="image-reference-list">
        {visible.map((node) => <button key={node.id} type="button" aria-pressed={selected.has(node.id)} onClick={() => toggle(node.id)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={ossDisplayUrl(node.imageSrc, 128) || node.imageSrc} alt="" loading="lazy" />
          <span>{node.title || "未命名图片"}</span><span className="image-reference-check">{selected.has(node.id) && <Check size={14} />}</span>
        </button>)}
        {!visible.length && <div className="image-reference-empty"><ImageIcon size={24} /><span>{query ? "没有匹配的图片" : "还没有可引用的图片"}</span><p>{query ? "试试其他名称" : "上传或生成其他图片后，可在这里选为参考。"}</p></div>}
      </div>
    </Popover.Dropdown>
  </Popover>;
}
