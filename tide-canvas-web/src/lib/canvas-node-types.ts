export const CHARACTER_NODE_TYPE = "character";
export const SCENE_NODE_TYPE = "scene";

const CONCEPT_NODE_TYPES = new Set([CHARACTER_NODE_TYPE, SCENE_NODE_TYPE]);
const IMAGE_CANVAS_NODE_TYPES = new Set(["image", ...CONCEPT_NODE_TYPES]);

/** 角色、场景是有独立语义的概念节点，但媒体载体与图片节点一致。 */
export function isConceptCanvasNodeType(type?: string): boolean {
  return !!type && CONCEPT_NODE_TYPES.has(type);
}

/** 能直接产出 imageSrc 的画布节点（用于封面候选等场景）。 */
export function isImageCanvasNodeType(type?: string): boolean {
  return !!type && IMAGE_CANVAS_NODE_TYPES.has(type);
}

/** 能作为图片素材输入的节点；导演台截图/背景同样按图片处理。 */
export function isImageReferenceNodeType(type?: string): boolean {
  return isImageCanvasNodeType(type) || type === "scene_3d";
}

/** 图片生成节点还允许把视频帧作为视觉参考。 */
export function isVisualReferenceNodeType(type?: string): boolean {
  return isImageReferenceNodeType(type) || type === "video";
}
