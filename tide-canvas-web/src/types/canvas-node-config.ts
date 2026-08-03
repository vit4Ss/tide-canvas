/**
 * 画布节点能力配置。
 *
 * 节点类型与功能实现都由代码注册；接口只下发启用状态、顺序和功能 key。
 * 前端永远通过本地白名单把 feature key 映射到 React 行为，不执行后台文本。
 */

export type CanvasNodeRenderer =
  | "image"
  | "video"
  | "scene_3d"
  | "text"
  | "audio"
  | "script";

export type CanvasNodeFeatureKey =
  | "image.subjectTurnaround"
  | "image.subjectCloseup"
  | "image.expressionGrid"
  | "image.makeupAdjust"
  | "image.expressionAdjust"
  | "image.portraitTexture"
  | "image.panorama"
  | "image.panoramaCapture"
  | "image.panoramaCaptureGrid"
  | "image.panoramaGuide"
  | "image.panoramaReset"
  | "image.multiAngle"
  | "image.relightPanel"
  | "image.gridGenerate"
  | "tool.upscale"
  | "image.crop"
  | "image.rotate"
  | "image.gridSplit"
  | "media.replace"
  | "image.mirror"
  | "media.download"
  | "media.preview";

export interface CanvasNodeTypeConfigVO {
  key: string;
  title: string;
  description: string;
  renderer: CanvasNodeRenderer;
  /** 服务端登记的图标语义名；实际组件仍由前端白名单选择。 */
  icon: string;
  /** 仅控制新增节点入口；已有画布里的节点始终继续渲染。 */
  enabled: boolean;
  sortOrder: number;
  /** 顺序即节点结果态顶部工具栏的展示顺序。 */
  features: CanvasNodeFeatureKey[];
}

export interface CanvasNodeConfigVO {
  version: number;
  nodeTypes: CanvasNodeTypeConfigVO[];
}
