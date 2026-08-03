import { create } from "zustand";
import { canvasNodeConfigApi } from "@/lib/canvas-node-config-api";
import {
  defaultCanvasNodeConfig,
  normalizeCanvasNodeConfig,
} from "@/lib/canvas-node-config";
import type {
  CanvasNodeFeatureKey,
  CanvasNodeTypeConfigVO,
} from "@/types/canvas-node-config";

type CanvasNodeConfigStatus = "idle" | "loading" | "ready" | "degraded";

interface CanvasNodeConfigState {
  status: CanvasNodeConfigStatus;
  nodeTypes: CanvasNodeTypeConfigVO[];
  lastLoadedAt: number;
  load: (force?: boolean) => Promise<void>;
}

const REFRESH_TTL_MS = 60_000;
const EMPTY_FEATURES: CanvasNodeFeatureKey[] = [];
let inFlight: Promise<void> | null = null;
let forceQueued = false;

export const useCanvasNodeConfigStore = create<CanvasNodeConfigState>((set, get) => ({
  status: "idle",
  nodeTypes: defaultCanvasNodeConfig().nodeTypes,
  lastLoadedAt: 0,

  load: async (force = false) => {
    const state = get();
    if (!force && state.lastLoadedAt > 0 && Date.now() - state.lastLoadedAt < REFRESH_TTL_MS) {
      return;
    }
    if (inFlight) {
      if (force) forceQueued = true;
      return inFlight;
    }

    inFlight = (async () => {
      if (get().lastLoadedAt === 0) set({ status: "loading" });
      try {
        const response = await canvasNodeConfigApi.get();
        const config = response.success ? normalizeCanvasNodeConfig(response.data) : null;
        if (!config) {
          set({ status: "degraded", lastLoadedAt: Date.now() });
          return;
        }
        set({
          status: "ready",
          nodeTypes: config.nodeTypes,
          lastLoadedAt: Date.now(),
        });
      } catch {
        // 保留最后一次有效配置；首次失败时 store 本来就是完整的代码内默认值。
        set({ status: "degraded", lastLoadedAt: Date.now() });
      }
    })().finally(() => {
      inFlight = null;
      if (forceQueued) {
        forceQueued = false;
        void get().load(true);
      }
    });

    return inFlight;
  },
}));

/** 返回稳定的功能数组；未知节点没有隐式图片能力。 */
export function useCanvasNodeFeatures(nodeType: string): CanvasNodeFeatureKey[] {
  return useCanvasNodeConfigStore(
    (state) => state.nodeTypes.find((item) => item.key === nodeType)?.features ?? EMPTY_FEATURES,
  );
}
