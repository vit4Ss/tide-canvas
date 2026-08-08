import type { StudioModelVO } from "@/lib/market-api";

export type HistoryModelIdentity = Pick<StudioModelVO, "id" | "name" | "modelKey" | "type">;

export interface HistorySendTarget {
  conversationId: string;
  draft: string;
  model: HistoryModelIdentity;
  skillId: string | null;
}

export interface HistorySendState {
  conversationId: string | null;
  draft: string;
  model: HistoryModelIdentity | null;
  skillId: string | null;
}

/**
 * A paid history replay may only use the same persisted model row/Skill target
 * that was validated before it was queued. Catalog labels and upstream keys may
 * be edited in place, so the database row id is the stable model identity.
 */
export function historySendTargetMatches(
  expected: HistorySendTarget,
  current: HistorySendState,
): boolean {
  return expected.conversationId === current.conversationId
    && expected.draft === current.draft
    && expected.skillId === current.skillId
    && !!current.model
    && expected.model.id === current.model.id;
}
