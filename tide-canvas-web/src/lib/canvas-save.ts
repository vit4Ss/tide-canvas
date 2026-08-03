export const CANVAS_SAVE_NOW_EVENT = "tide-canvas-save-now";

export interface CanvasSaveRequestDetail {
  projectId: string;
  handled: boolean;
  acknowledge: (saved: boolean) => void;
}

/** Request an immediate persisted canvas snapshot and wait for its result. */
export function requestCanvasSave(projectId: string): Promise<boolean> {
  if (typeof window === "undefined" || !projectId) return Promise.resolve(false);

  return new Promise((resolve) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const detail: CanvasSaveRequestDetail = {
      projectId,
      handled: false,
      acknowledge: (saved) => {
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        resolve(saved);
      },
    };
    // Do not leave a launch dialog blocked forever if a browser/network stack
    // stalls without completing fetch. The create journal remains intact and
    // will retry on recovery; a late save acknowledgement is safely ignored.
    timeout = setTimeout(() => detail.acknowledge(false), 30_000);
    window.dispatchEvent(new CustomEvent<CanvasSaveRequestDetail>(CANVAS_SAVE_NOW_EVENT, { detail }));
    if (!detail.handled) detail.acknowledge(false);
  });
}
