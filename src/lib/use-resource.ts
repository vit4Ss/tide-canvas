"use client";
import { useCallback, useEffect, useState } from "react";
import { http } from "./http";

export function useResource<T>(path: string, enabled = true, scope = "public") {
  const [revision, setRevision] = useState(0);
  const key = `${path}:${scope}:${revision}`;
  const [state, setState] = useState<{ key: string; data: T | null; error: string }>({ key: "", data: null, error: "" });
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    http.get<T>(path, undefined, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      setState({ key, data: result.success ? result.data : null, error: result.success ? "" : result.message });
    });
    return () => controller.abort();
  }, [path, enabled, key]);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  return { data: enabled && state.key === key ? state.data : null, error: enabled && state.key === key ? state.error : "", loading: enabled && state.key !== key, refresh };
}
