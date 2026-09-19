import { useEffect, useRef, type Dispatch, type SetStateAction, type RefObject } from "react";
import { aiApi } from "@/lib/api";
import { useAuthStore } from "@/stores/use-auth-store";
import { histItemsFromTasks } from "./utils";
import { mergeInitialStudioHistory } from "./history-merge";
import type { HistItem } from "./types";

/** Discover external submissions without resetting Studio pagination or drafts. */
export function useAPIHistorySync(hist: HistItem[], setHist: Dispatch<SetStateAction<HistItem[]>>, removedRuns: RefObject<Set<string>>, refreshBalance: (signal?: AbortSignal) => Promise<void>, revealMoreHistory: (reloadFromStart: boolean) => void) {
  const owner = useAuthStore((s) => s.user?.id);
  const latest = useRef(hist);
  useEffect(() => { latest.current = hist; }, [hist]);
  useEffect(() => {
    if (!owner) return;
    let stopped = false;
    let pending = false;
    let cursor = 0;
    let active: AbortController | null = null;
    const refresh = async () => {
      if (stopped || pending || document.hidden) return;
      pending = true;
      const controller = new AbortController();
      active = controller;
      const deadline = setTimeout(() => controller.abort(), 30_000);
      try {
        const page = await aiApi.listTasks({ isApiCall: true, noProject: true, pageNum: 1, pageSize: 20 }, controller.signal);
        if (!page.success || !page.data || controller.signal.aborted || stopped || useAuthStore.getState().user?.id !== owner) return;
        const records = page.data.records.filter((task) => task.isApiCall);
        const known = new Set(records.map((t) => `task-${t.id}`));
        const older = latest.current.filter((h) => h.isApiCall && h.status === "processing" && !known.has(h.run));
        // Bound polling even if a user has many pages of pending API tasks.
        const batch = older.length ? Array.from({ length: Math.min(4, older.length) }, (_, i) => older[(cursor + i) % older.length]) : [];
        cursor += batch.length;
        const updates = await Promise.allSettled(batch.map((h) => aiApi.getTask(h.run.replace(/^task-/, ""), controller.signal)));
        const missingRuns: string[] = [];
        for (const [index, update] of updates.entries()) {
          if (update.status === "fulfilled" && update.value.success && update.value.data) records.push(update.value.data);
          if (update.status === "fulfilled" && !update.value.success && update.value.code === 404) missingRuns.push(batch[index].run);
        }
        if (controller.signal.aborted || stopped || useAuthStore.getState().user?.id !== owner) return;
        for (const run of missingRuns) removedRuns.current.add(run);
        const items = histItemsFromTasks(records);
        setHist((prev) => mergeInitialStudioHistory(prev, items, removedRuns.current));
        const knownAPIRuns = new Set([
          ...latest.current.filter((item) => item.isApiCall), ...items,
        ].filter((item) => !removedRuns.current.has(item.run)).map((item) => item.run));
        // New head inserts can shift more than one page. If the first API page
        // contains previously unseen tasks, replay pagination from the top while
        // keeping rendered rows; continuing an old offset could skip the gap.
        if (page.data.total > knownAPIRuns.size) {
          const previousRuns = new Set(latest.current.map((item) => item.run));
          revealMoreHistory(items.some((item) => !previousRuns.has(item.run) && !removedRuns.current.has(item.run)));
        }
        // External clients can debit/refund points while this tab is open.
        // Refresh even after terminal status: a delayed refund may settle later.
        if (records.length) await refreshBalance(controller.signal);
      } catch {
        // Keep existing records during a network interruption; retry next tick.
      } finally {
        clearTimeout(deadline);
        active = null;
        pending = false;
      }
    };
    const timer = setInterval(() => void refresh(), 15_000);
    const visible = () => { if (document.hidden) active?.abort(); else void refresh(); };
    window.addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    return () => {
      stopped = true;
      active?.abort();
      clearInterval(timer);
      window.removeEventListener("focus", visible);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [owner, setHist, removedRuns, refreshBalance, revealMoreHistory]);
}
