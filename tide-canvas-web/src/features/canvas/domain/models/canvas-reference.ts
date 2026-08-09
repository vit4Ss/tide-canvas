export type CanvasReferenceKind = "image" | "video" | "audio" | "text";

/** 提示词编辑器中可被 @ 引用的画布或附件素材。 */
export interface CanvasReferenceItem {
  id: string;
  thumb: string;
  title: string;
  index: number;
  kind?: CanvasReferenceKind;
  media?: CanvasReferenceKind;
  src?: string;
  text?: string;
}
