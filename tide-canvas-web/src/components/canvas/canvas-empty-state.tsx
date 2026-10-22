"use client";

import { Upload } from "lucide-react";
import { useCanvasNodeConfigStore } from "@/stores/use-canvas-node-config-store";
import { canvasNodeIcon } from "@/lib/canvas-node-config";

export function CanvasEmptyState({ onAddNode, onUpload }: { onAddNode: (type: string) => void; onUpload: () => void }) {
  const nodeTypes = useCanvasNodeConfigStore((s) => s.nodeTypes);
  const starters = ["image", "video", "audio", "script"].flatMap((key) => {
    const type = nodeTypes.find((item) => item.key === key && item.enabled);
    return type ? [type] : [];
  });
  return (
    <section className="canvas-start" aria-label="开始画布创作">
      <div className="canvas-start-intro">
        <h1>让灵感，在画布上展开</h1>
        <p>从一个节点开始，连接你的图片、镜头与故事。</p>
      </div>
      <div className="canvas-start-actions">
        {starters.map((item) => {
          const Icon = canvasNodeIcon(item.key);
          return <button key={item.key} type="button" className="canvas-start-action" onClick={() => onAddNode(item.key)}><Icon size={20} aria-hidden /><span>{item.title}<small>{item.description}</small></span></button>;
        })}
      </div>
      <button type="button" className="canvas-start-import" onClick={onUpload}><Upload size={15} aria-hidden />导入素材<span aria-hidden>·</span>也可以拖入文件</button>
      <div className="canvas-start-hint">右键添加更多节点 · Ctrl / ⌘ + 滚轮缩放 · 拖拽空白处平移</div>
    </section>
  );
}
