/** 同一浏览器会话内的资产列表失效信号。
 *
 * 资产页会缓存各个 tab / 类型 / 日期组合；在创作台等其他入口新增文件后，
 * 需要让已缓存的“上传历史”重新拉取，否则服务端已有记录，界面仍会显示旧列表。
 */
export const ASSET_LIBRARY_CHANGED_EVENT = "tide:asset-library-changed";

export type AssetLibraryCollection = "hist" | "upload" | "all";
export type AssetLibraryMediaKind = "image" | "video" | "audio" | "doc" | "3d";
export type AssetLibraryOrigin = "tool" | "capture" | "unknown";

export interface AssetLibraryChange {
  collection: AssetLibraryCollection;
  mediaKind?: AssetLibraryMediaKind;
  origin?: AssetLibraryOrigin;
}

interface RevisionedAssetLibraryChange extends AssetLibraryChange {
  revision: number;
}

let revision = 0;
const changeLog: RevisionedAssetLibraryChange[] = [];
const CHANGE_LOG_LIMIT = 64;

export function assetLibraryRevision(): number {
  return revision;
}

/** Return every invalidation after a caller's last observed revision. */
export function assetLibraryChangesSince(lastRevision: number): AssetLibraryChange[] {
  if (lastRevision >= revision) return [];
  const firstRetained = changeLog[0]?.revision ?? revision + 1;
  if (lastRevision < firstRetained - 1) return [{ collection: "all", origin: "unknown" }];
  return changeLog
    .filter((change) => change.revision > lastRevision)
    .map((change) => ({
      collection: change.collection,
      ...(change.mediaKind ? { mediaKind: change.mediaKind } : {}),
      ...(change.origin ? { origin: change.origin } : {}),
    }));
}

/** Whether a cached tab/filter/date/sort view can be affected by these changes. */
export function assetLibraryChangesAffectView(
  viewKey: string,
  changes: readonly AssetLibraryChange[],
): boolean {
  const [tab, filter] = viewKey.split("|");
  return changes.some((change) =>
    (change.collection === "all" || change.collection === tab) &&
    (!change.mediaKind || change.mediaKind === filter),
  );
}

export function notifyAssetLibraryChanged(
  change: AssetLibraryChange = { collection: "all", origin: "unknown" },
): void {
  revision += 1;
  const entry = { ...change, revision };
  changeLog.push(entry);
  if (changeLog.length > CHANGE_LOG_LIMIT) changeLog.shift();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(ASSET_LIBRARY_CHANGED_EVENT, { detail: entry }));
  }
}
