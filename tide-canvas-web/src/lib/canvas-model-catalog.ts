import type { AiModelVO } from "../types/ai";

export interface CanvasModelCatalogSnapshot {
  models: AiModelVO[];
  status: "loading" | "ready" | "error";
  error: string | null;
}

interface ModelResponse {
  success: boolean;
  data?: AiModelVO[];
  message?: string;
}

/** A catalog is shared only while canvas nodes are subscribed, never persisted across sessions. */
export function createCanvasModelCatalog(fetchModels: () => Promise<ModelResponse>) {
  const initial: CanvasModelCatalogSnapshot = { models: [], status: "loading", error: null };
  let snapshot = initial;
  let pending: Promise<CanvasModelCatalogSnapshot> | null = null;
  let revision = 0;
  const listeners = new Set<() => void>();

  const publish = (next: CanvasModelCatalogSnapshot) => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };

  const load = (force = false): Promise<CanvasModelCatalogSnapshot> => {
    if (pending) return pending;
    if (!force && snapshot.status === "ready") return Promise.resolve(snapshot);
    const request = ++revision;
    publish({ models: [], status: "loading", error: null });
    const task = Promise.resolve().then(fetchModels).then((result): CanvasModelCatalogSnapshot => {
      if (!result.success) return { models: [], status: "error", error: result.message?.trim() || "模型加载失败，请重试" };
      if (!Array.isArray(result.data)) return { models: [], status: "error", error: "模型列表响应异常，请重试" };
      return { models: result.data, status: "ready", error: null };
    }).catch((): CanvasModelCatalogSnapshot => ({
      models: [], status: "error", error: "模型加载失败，请检查网络后重试",
    })).then((next) => {
      if (request === revision) {
        pending = null;
        publish(next);
      }
      return next;
    });
    pending = task;
    return task;
  };

  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => initial,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        // StrictMode's immediate unsubscribe/resubscribe reuses the same request.
        queueMicrotask(() => {
          if (listeners.size > 0) return;
          revision += 1;
          pending = null;
          snapshot = initial;
        });
      };
    },
    load: () => load(),
    reload: () => load(true),
  };
}

/** Keep a valid choice, then the document preference, then the configured primary model. */
export function resolveCanvasModelId(models: AiModelVO[], current: string, preferred?: string): string {
  if (current && models.some((model) => model.modelId === current)) return current;
  if (preferred && models.some((model) => model.modelId === preferred)) return preferred;
  const primary = models.find((model) => {
    try {
      return (JSON.parse(model.config || "{}") as { imagePrimary?: boolean }).imagePrimary === true;
    } catch {
      return false;
    }
  });
  return (primary ?? models[0])?.modelId ?? "";
}
