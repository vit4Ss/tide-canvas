"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { socialAnalysisApi, type SocialActivityRecordDetailVO } from "@/lib/social-analysis-api";
import { useAuthStore } from "@/stores/use-auth-store";

/** Restore once per page/account, independently of history filters and polling. */
export function useLatestActivity(
  ownerUserId: string,
  onRestore: (record: SocialActivityRecordDetailVO) => Promise<void>,
) {
  const ensureSession = useAuthStore((state) => state.ensureSession);
  const restoreRef = useRef(onRestore);
  const requestRef = useRef(0);
  const [attempt, setAttempt] = useState(0);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { restoreRef.current = onRestore; }, [onRestore]);

  // User input wins over a slow initial request. Scrolling/hovering do not cancel.
  const cancel = useCallback(() => {
    requestRef.current += 1;
    setRestoring(false);
  }, []);

  const retry = useCallback(() => { setAttempt((value) => value + 1); }, []);

  useEffect(() => {
    const request = ++requestRef.current;
    const current = () => request === requestRef.current;
    // Defer so Strict Mode's discarded mount never sends a duplicate request.
    void Promise.resolve().then(async () => {
      if (!current()) return;
      setRestoring(!!ownerUserId);
      setError("");
      if (!ownerUserId) return;
      try {
        if (!await ensureSession() || !current()) return;
        // The server sorts by create_time DESC, id DESC and scopes to this user.
        const list = await socialAnalysisApi.records({ pageNum: 1, pageSize: 1 });
        if (!current()) return;
        if (!list.success || !list.data) throw new Error("list unavailable");
        const latest = list.data.records[0];
        if (!latest) return;
        const detail = await socialAnalysisApi.record(latest.id);
        if (!current()) return;
        if (!detail.success || !detail.data) throw new Error("detail unavailable");
        await restoreRef.current(detail.data);
      } catch {
        if (current()) setError("最新记录暂时无法恢复，请重试或从左侧选择记录");
      } finally {
        if (current()) setRestoring(false);
      }
    });
    return () => { requestRef.current += 1; };
  }, [attempt, ensureSession, ownerUserId]);

  return { restoring, error, cancel, retry };
}
