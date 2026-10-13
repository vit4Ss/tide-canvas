"use client";
import { useCallback, useEffect, useRef, useState } from "react";

// The extra history entry belongs to a preview, not a second page visit.
// Back dismisses it; Forward can restore the cached item while this page stays mounted.
export function usePreviewState<T extends { id: string }>(scope: string): [T | null, (item: T | null) => void] {
  const [token] = useState(() => crypto.randomUUID());
  const [item, setItem] = useState<T | null>(null);
  const cache = useRef(new Map<string, T>());
  const closing = useRef(false);
  useEffect(() => {
    const pop = () => {
      closing.current = false;
      const marker = history.state?.framelynPreview;
      setItem(marker?.token === token && marker?.scope === scope ? cache.current.get(marker.id) || null : null);
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, [token, scope]);
  const select = useCallback((next: T | null) => {
    const marker = history.state?.framelynPreview;
    const own = marker?.token === token && marker?.scope === scope && marker?.url === location.href;
    if (!next) {
      if (own) { if (!closing.current) { closing.current = true; history.back(); } }
      else setItem(null);
      return;
    }
    if (closing.current) return;
    cache.current.set(next.id, next);
    const state = { ...history.state, framelynPreview: { token, scope, id: next.id, url: location.href } };
    if (own) history.replaceState(state, "", location.href); else history.pushState(state, "", location.href);
    setItem(next);
  }, [token, scope]);
  return [item, select];
}
