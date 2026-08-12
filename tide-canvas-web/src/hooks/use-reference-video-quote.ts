"use client";

import { useEffect, useMemo, useState } from "react";
import { aiApi } from "@/lib/api";
import type { ModelConfig } from "@/types/admin-models";
import type { ReferenceVideoQuoteVO } from "@/types/ai";

const EMPTY_QUOTE: ReferenceVideoQuoteVO = {
  videoCount: 0,
  durationSeconds: 0,
  ratePerSecond: 0,
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
  videoUrls: string[],
) {
  const enabled = config?.referenceVideoBillingEnabled === true;
  const configuredRate = String(config?.referenceVideoPricePerSecond ?? "");
  const urlsKey = JSON.stringify(videoUrls.map((url) => url.trim()).filter(Boolean));
  const normalizedUrls = useMemo<string[]>(() => JSON.parse(urlsKey) as string[], [urlsKey]);
  const applies = enabled && !!modelId?.trim() && normalizedUrls.length > 0;
  const requestKey = applies ? JSON.stringify([modelId?.trim(), configuredRate, normalizedUrls]) : "";
  const [state, setState] = useState<QuoteState>({
    requestKey: "",
    quote: EMPTY_QUOTE,
    failed: false,
  });

  useEffect(() => {
    let active = true;
    if (!applies || !modelId || state.requestKey === requestKey) {
      return () => {
        active = false;
      };
    }

    void aiApi.referenceVideoQuote({ modelId, videoUrls: normalizedUrls }).then((result) => {
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
  }, [applies, modelId, normalizedUrls, requestKey, state.requestKey]);

  if (!applies) {
    return { applies: false, loading: false, failed: false, quote: EMPTY_QUOTE };
  }
  // Effects run after render. Treat a changed model/rate/reference list as
  // loading immediately so one render can never expose or submit an old quote.
  if (state.requestKey !== requestKey) {
    return { applies: true, loading: true, failed: false, quote: EMPTY_QUOTE };
  }
  return { applies: true, loading: false, failed: state.failed, quote: state.quote };
}
