export const CANVAS_SAVE_NOW_EVENT = "tide-canvas-save-now";

export interface CanvasSaveRequestDetail {
  projectId: string;
  handled: boolean;
  acknowledge: (saved: boolean) => void;
}

const SAVE_TIMEOUT_MS = 30_000;
const LISTENER_GRACE_MS = 1_000;
const LISTENER_RETRY_MS = 50;

/** Request an immediate persisted canvas snapshot and wait for its result. */
export function requestCanvasSave(projectId: string): Promise<boolean> {
  if (typeof window === "undefined" || !projectId) return Promise.resolve(false);

  return new Promise((resolve) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let listenerRetry: ReturnType<typeof setTimeout> | null = null;
    const listenerDeadline = Date.now() + LISTENER_GRACE_MS;
    const detail: CanvasSaveRequestDetail = {
      projectId,
      handled: false,
      acknowledge: (saved) => {
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        if (listenerRetry) clearTimeout(listenerRetry);
        resolve(saved);
      },
    };
    // Do not leave a launch dialog blocked forever if a browser/network stack
    // stalls without completing fetch. The create journal remains intact and
    // will retry on recovery; a late save acknowledgement is safely ignored.
    timeout = setTimeout(() => detail.acknowledge(false), SAVE_TIMEOUT_MS);
    const dispatch = () => {
      if (settled) return;
      detail.handled = false;
      try {
        window.dispatchEvent(new CustomEvent<CanvasSaveRequestDetail>(CANVAS_SAVE_NOW_EVENT, { detail }));
      } catch {
        detail.acknowledge(false);
        return;
      }
      if (detail.handled) return;
      if (Date.now() >= listenerDeadline) {
        detail.acknowledge(false);
        return;
      }
      listenerRetry = setTimeout(dispatch, LISTENER_RETRY_MS);
    };
    dispatch();
  });
}
