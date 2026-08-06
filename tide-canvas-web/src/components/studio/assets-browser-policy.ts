export type AssetTabKey = "hist" | "upload";
export type AssetMediaKind = "image" | "video" | "audio" | "doc";
export type AssetFilterKey = AssetMediaKind | "character" | "scene";
export type GeneratedMediaKind = Exclude<AssetMediaKind, "doc">;
export type HistoryFilterKey = GeneratedMediaKind | "character" | "scene";

export const HISTORY_FILTER_KEYS: readonly HistoryFilterKey[] = ["character", "scene", "image", "video", "audio"];
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
  text_to_video: "video",
  image_to_video: "video",
  start_end_to_video: "video",
  reference_to_video: "video",
  text_to_audio: "audio",
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
