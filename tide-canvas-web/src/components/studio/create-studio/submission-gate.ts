export const GENERATION_SUBMIT_HOLD_MS = 1_200;

/**
 * A synchronous gate for paid generation submits. React state updates are not
 * synchronous, so `disabled` alone cannot stop two click events in the same
 * frame. The gate closes immediately and stays closed until both the request
 * settles and the minimum double-click window has elapsed.
 */
export function createSubmissionGate(minimumHoldMs = GENERATION_SUBMIT_HOLD_MS) {
  let locked = false;
  let acquiredAt = 0;

  return {
    tryAcquire(now = Date.now()): boolean {
      if (locked) return false;
      locked = true;
      acquiredAt = now;
      return true;
    },
    releaseDelay(now = Date.now()): number {
      if (!locked) return 0;
      return Math.max(0, minimumHoldMs - Math.max(0, now - acquiredAt));
    },
    unlock(): void {
      locked = false;
      acquiredAt = 0;
    },
    isLocked(): boolean {
      return locked;
    },
  };
}

export type SubmissionGate = ReturnType<typeof createSubmissionGate>;
