"use client";

import type { PageData } from "@/types/api";
import { http } from "./http";
import { mediaHistoryPage, type HistoryRow } from "./media-history";
import { useResource } from "./use-resource";

const loadMediaPage = <T extends HistoryRow>(path: string, signal: AbortSignal) =>
  mediaHistoryPage<T>(path, signal, (request, requestSignal) => http.get<PageData<T>>(request, undefined, { signal: requestSignal }));

export function useMediaHistory<T extends HistoryRow>(path: string, enabled = true, scope = "public") {
  return useResource<PageData<T>>(path, enabled, scope, loadMediaPage<T>);
}
