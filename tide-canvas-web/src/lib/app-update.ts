export const CURRENT_APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION?.trim() || "development";
export const APP_UPDATE_CAN_RELOAD_EVENT = "flowinglight:can-reload-for-app-update";
export const APP_UPDATE_BEFORE_RELOAD_EVENT = "flowinglight:before-app-update";

export interface AppUpdateSnapshot {
  version: 1;
  savedAt: number;
  targetVersion: string;
}

export function isFreshUpdateSnapshot(savedAt: unknown, maxAgeMs = 30 * 60 * 1000): boolean {
  return typeof savedAt === "number" && Number.isFinite(savedAt) && Date.now() - savedAt <= maxAgeMs;
}
