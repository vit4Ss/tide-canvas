"use client";

import { useEffect, useMemo, useState } from "react";
import { aiApi } from "@/lib/api";
import type { ModelConfig } from "@/types/admin-models";
import type { ClipReshootRequest, ReferenceVideoQuoteVO } from "@/types/ai";

const EMPTY_QUOTE: ReferenceVideoQuoteVO = {
  billingEnabled: false,
  videoCount: 0,
  durationSeconds: 0,
  resolution: "",
  pointCost: 0,
};

type QuoteState = {
  requestKey: string;
  quote: ReferenceVideoQuoteVO;
  failed: boolean;
};

/**
 * Loads the server-confirmed reference-video surcharge for pre-submit display.
 * This is deliberately only a quote: the generation endpoint repeats ownership
 * and duration verification before it deducts any points.
 */
export function useReferenceVideoQuote(
  modelId: string | null | undefined,
  config: ModelConfig | null | undefined,
  resolution: string | null | undefined,
  videoUrls: string[],
  clipReshoot?: ClipReshootRequest,
) {
  // The catalog config is only a cache invalidation hint. Never use it to
  // decide whether to request a quote: the generation endpoint reads the
  // current database config, so pre-submit display must ask the same server
  // authority even when the public model list is stale or came from an older
  // deployment that omitted these fields.
  const configRevision = JSON.stringify([
    config?.omniRefVideoEnabled,
    config?.referenceVideoBillingEnabled,
    config?.durations,
    config?.resolutions,
    config?.priceMatrix,
    config?.pricing,
  ]);
  const urlsKey = JSON.stringify(videoUrls.map((url) => url.trim()).filter(Boolean));
  const normalizedUrls = useMemo<string[]>(() => JSON.parse(urlsKey) as string[], [urlsKey]);
  const clipReshootKey = JSON.stringify(clipReshoot ?? null);
  const normalizedClipReshoot = useMemo<ClipReshootRequest | undefined>(
    () => (JSON.parse(clipReshootKey) as ClipReshootRequest | null) ?? undefined,
    [clipReshootKey],
  );
  // Older/direct clients may omit the field when a model exposes exactly one
  // resolution. Mirror the server's unambiguous fallback so the UI still shows
  // the surcharge instead of waiting until submit to discover it.
  const normalizedResolution = resolution?.trim()
    || (config?.resolutions?.length === 1 ? config.resolutions[0]?.trim() : "")
    || "";
  // Even while the local catalog is still loading (and resolution is empty),
  // ask the server. It can select the sole configured resolution or return a
  // safe validation error; silently skipping here would leave the old base
  // price visible after a reference video was selected.
  const shouldQuote = !!modelId?.trim() && normalizedUrls.length > 0;
  const requestKey = shouldQuote
    ? JSON.stringify([modelId?.trim(), normalizedResolution, configRevision, normalizedUrls, normalizedClipReshoot])
    : "";
  const [state, setState] = useState<QuoteState>({
    requestKey: "",
    quote: EMPTY_QUOTE,
    failed: false,
  });

  useEffect(() => {
    let active = true;
    if (!shouldQuote || !modelId || state.requestKey === requestKey) {
      return () => {
        active = false;
      };
    }

    void aiApi.referenceVideoQuote({
      modelId,
      resolution: normalizedResolution,
      videoUrls: normalizedUrls,
      ...(normalizedClipReshoot ? { clipReshoot: normalizedClipReshoot } : {}),
    }).then((result) => {
      if (!active) return;
      if (result.success && result.data) {
        setState({ requestKey, quote: result.data, failed: false });
      } else {
        setState({ requestKey, quote: EMPTY_QUOTE, failed: true });
      }
    });

    return () => {
      active = false;
    };
  }, [modelId, normalizedClipReshoot, normalizedResolution, normalizedUrls, requestKey, shouldQuote, state.requestKey]);

  if (!shouldQuote) {
    return { applies: false, loading: false, failed: false, quote: EMPTY_QUOTE };
  }
  // Effects run after render. Treat a changed model/matrix/reference list as
  // loading immediately so one render can never expose or submit an old quote.
  if (state.requestKey !== requestKey) {
    return { applies: true, loading: true, failed: false, quote: EMPTY_QUOTE };
  }
  return {
    // point fallback keeps the UI correct during rolling deployment when
    // an older API instance may not yet include billingEnabled in its JSON.
    applies: state.failed
      || state.quote.billingEnabled
      || state.quote.pointCost > 0,
    loading: false,
    failed: state.failed,
    quote: state.quote,
  };
}
