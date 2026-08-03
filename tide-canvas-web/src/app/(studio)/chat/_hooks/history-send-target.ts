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
 * A paid history replay may only use the exact model/Skill target that was
 * validated before it was queued. Focus-driven catalog refreshes can otherwise
 * replace the selected model between the async validation and send effect.
 */
export function historySendTargetMatches(
  expected: HistorySendTarget,
  current: HistorySendState,
): boolean {
  return expected.conversationId === current.conversationId
    && expected.draft === current.draft
    && expected.skillId === current.skillId
    && !!current.model
    && expected.model.id === current.model.id
    && expected.model.name === current.model.name
    && expected.model.modelKey === current.model.modelKey
    && expected.model.type === current.model.type;
}
