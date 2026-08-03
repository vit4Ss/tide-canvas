export type PendingTurnKind = "media" | "text";

export interface PendingTurnIdentity {
  kind: PendingTurnKind;
  ownerKey: string;
  conversationId: string;
  requestKey: string;
}

export interface PendingTurnDescriptor<T> extends PendingTurnIdentity {
  value: T;
}

export type PendingTurnDecision<T extends PendingTurnIdentity> =
  | { status: "inserted"; turn: T }
  | { status: "existing"; turn: T };

/**
 * Pure model for the journal's cross-tab critical section. A conversation may
 * have only one unresolved paid turn for an owner, regardless of whether that
 * turn is text or media. The caller persists only when this returns inserted.
 */
export function arbitratePendingTurn<T extends PendingTurnIdentity>(
  existing: readonly T[],
  candidate: T,
): PendingTurnDecision<T> {
  const pending = existing.find(
    (turn) =>
      turn.ownerKey === candidate.ownerKey &&
      turn.conversationId === candidate.conversationId,
  );
  return pending
    ? { status: "existing", turn: pending }
    : { status: "inserted", turn: candidate };
}

/** Remove only the exact credential owned by the caller, never a payload peer. */
export function removePendingTurnIfOwned<T>(
  existing: readonly T[],
  expected: T,
  owns: (row: T, expected: T) => boolean,
): T[] {
  return existing.filter((row) => !owns(row, expected));
}
