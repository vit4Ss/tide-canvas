export type AssetTabKey = "hist" | "upload";
export type AssetMediaKind = "image" | "video" | "audio" | "doc";
/* "3d" 只挂在生成侧：3D 是生成产物（/three-d 工作台），上传历史不收 3D 文件，
   所以它进 GeneratedMediaKind / 生成历史筛选，不进 AssetMediaKind（上传/选取的
   媒体类型语义不变）。 */
export type AssetFilterKey = AssetMediaKind | "character" | "scene" | "3d";
export type GeneratedMediaKind = Exclude<AssetMediaKind, "doc"> | "3d";
export type HistoryFilterKey = GeneratedMediaKind | "character" | "scene";

export const HISTORY_FILTER_KEYS: readonly HistoryFilterKey[] = ["character", "scene", "image", "video", "audio", "3d"];
export const UPLOAD_FILTER_KEYS: readonly AssetFilterKey[] = [
  "character",
  "scene",
  "image",
  "video",
  "audio",
  "doc",
];

export const HANDLER_MEDIA_KIND: Readonly<Record<string, GeneratedMediaKind>> = {
  text_to_image: "image",
  image_to_image: "image",
  outpaint: "image",
  remove_bg: "image",
  upscale: "image",
  remove_object: "image",
  relight: "image",
  text_to_video: "video",
  image_to_video: "video",
  start_end_to_video: "video",
  reference_to_video: "video",
  video_upscale: "video",
  text_to_audio: "audio",
  generate_3d: "3d",
};

export function isHistoryFilter(filter: AssetFilterKey): filter is HistoryFilterKey {
  return filter !== "doc";
}

export function initialAssetTab(defaultTab: AssetTabKey, defaultFilter: AssetFilterKey): AssetTabKey {
  return defaultTab === "hist" && defaultFilter === "doc" ? "upload" : defaultTab;
}

export function filtersForAssetTab(tab: AssetTabKey): readonly AssetFilterKey[] {
  return tab === "hist" ? HISTORY_FILTER_KEYS : UPLOAD_FILTER_KEYS;
}

export function assetViewKey(input: {
  tab: AssetTabKey;
  filter: AssetFilterKey;
  startDate: string;
  endDate: string;
  sortAsc: boolean;
}): string {
  return [input.tab, input.filter, input.startDate, input.endDate, input.sortAsc ? "asc" : "desc"].join("|");
}
