"use client";

import { memo } from "react";
import { ImageNode } from "./nodes/image-node";
import { VideoNode } from "./nodes/video-node";
import { AudioNode } from "./nodes/audio-node";
import { TextNode } from "./nodes/text-node";
import { ScriptNode } from "./nodes/script-node";
import { Scene3DNode } from "./nodes/scene-3d-node";
import { VideoComposeNode } from "./nodes/video-compose-node";
import { STYLE_REFERENCE_NODE_TYPE, StyleReferenceNode } from "./nodes/style-reference-node";
import { DefaultNode } from "./nodes/components/default-node";
import type { CanvasNodeProps } from "./nodes/types/node-props";

// 中文注释：节点注册入口只负责根据类型路由到对应组件，节点内部 UI 和样式放在各自模块中维护。
export const CanvasNodeComponent = memo(function CanvasNodeComponent(props: CanvasNodeProps) {
  switch (props.node.type) {
    case "image":
      return <ImageNode {...props} />;
    case "video":
      return <VideoNode {...props} />;
    case "audio":
      return <AudioNode {...props} />;
    case "text":
      return <TextNode {...props} />;
    case "script":
      return <ScriptNode {...props} />;
    case "scene_3d":
      return <Scene3DNode {...props} />;
    case "video_compose":
      return <VideoComposeNode {...props} />;
    case STYLE_REFERENCE_NODE_TYPE:
      return <StyleReferenceNode {...props} />;
    default:
      return <DefaultNode {...props} />;
  }
});

export type { CanvasNodeProps };
