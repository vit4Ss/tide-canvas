"use client";

import { useMemo, useState } from "react";
import { ArrowUpRight, AudioLines, Clapperboard, FileText, Image as ImageIcon, Search, Workflow } from "lucide-react";
import { useCanvasStore, type CanvasNode } from "@/stores/use-canvas-store";

function kindOf(node: CanvasNode) {
  if (node.type === "video" || node.videoSrc) return "video";
  if (node.type === "audio" || node.audioSrc) return "audio";
  if (node.type === "text" || node.type === "script") return "text";
  if (node.imageSrc || ["image", "character", "scene", "style_reference"].includes(node.type)) return "image";
  return "other";
}

export function CanvasStoryboard({ onRevealNode, onWorkflow }: { onRevealNode: (node: CanvasNode) => void; onWorkflow: () => void }) {
  const nodes = useCanvasStore((state) => state.nodes);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const sorted = useMemo(() => [...nodes].sort((a, b) => a.storyboardFrame && b.storyboardFrame && a.storyboardFrame.sourceVideoId === b.storyboardFrame.sourceVideoId ? a.storyboardFrame.index - b.storyboardFrame.index : a.y - b.y || a.x - b.x), [nodes]);
  const visible = sorted.filter((node) => (filter === "all" || kindOf(node) === filter) && `${node.title} ${node.prompt || ""} ${node.content || ""}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <section className="canvas-storyboard" aria-label="故事板">
    <header className="canvas-storyboard-header"><div><h1>故事板</h1><p>浏览当前画布的镜头与素材，返回工作流继续编辑。</p></div><span>{nodes.length} 个节点</span></header>
    <div className="canvas-storyboard-tools"><div className="canvas-storyboard-filters" role="group" aria-label="素材类型">{[["all", "全部"], ["image", "图片"], ["video", "视频"], ["audio", "音频"], ["text", "文本 / 脚本"]].map(([key, name]) => <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>{name}</button>)}</div><label className="canvas-storyboard-search"><Search size={14} aria-hidden /><input aria-label="搜索画布素材" placeholder="搜索名称或提示词" value={query} onChange={(event) => setQuery(event.target.value)} /></label></div>
    {visible.length ? <div className="canvas-storyboard-grid">{visible.map((node) => {
      const kind = kindOf(node);
      const Icon = kind === "video" ? Clapperboard : kind === "audio" ? AudioLines : kind === "text" ? FileText : ImageIcon;
      return <article key={node.id} className="canvas-storyboard-card">
        <div className="canvas-storyboard-media">
          {kind === "video" && node.videoSrc ? <video src={node.videoSrc} controls preload="metadata" /> : kind === "image" && node.imageSrc ?
            // eslint-disable-next-line @next/next/no-img-element
            <img src={node.imageSrc} alt={node.title} loading="lazy" /> : kind === "audio" && node.audioSrc ? <audio src={node.audioSrc} controls preload="none" /> : kind === "text" ? <p>{node.content || node.prompt || "尚未填写内容"}</p> : <div className="canvas-storyboard-placeholder"><Icon size={28} strokeWidth={1.5} /><span>{node.status === "generating" ? "生成中…" : "尚未添加素材"}</span></div>}
        </div>
        <div className="canvas-storyboard-caption"><div><Icon size={14} aria-hidden /><h2>{node.title}</h2></div><button type="button" onClick={() => onRevealNode(node)} title="在工作流中定位" aria-label={`在工作流中定位：${node.title}`}><ArrowUpRight size={16} /></button></div>
        {(node.storyboardFrame?.description || node.prompt) && <p className="canvas-storyboard-description">{node.storyboardFrame?.description || node.prompt}</p>}
      </article>;
    })}</div> : <div className="canvas-storyboard-empty"><Clapperboard size={32} strokeWidth={1.4} /><h2>{nodes.length ? "没有匹配的素材" : "故事从第一个镜头开始"}</h2><p>{nodes.length ? "试试其他关键词或素材类型。" : "在工作流中添加图片、视频或脚本，这里会同步呈现。"}</p><button type="button" onClick={onWorkflow}><Workflow size={15} />返回工作流</button></div>}
  </section>;
}
