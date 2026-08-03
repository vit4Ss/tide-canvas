import { http } from "@/lib/http";
import type { CanvasNodeConfigVO } from "@/types/canvas-node-config";

export const canvasNodeConfigApi = {
  /** 公开画布配置：包含已注册节点及其启用状态、顺序、顶部功能 key。 */
  get: () => http.get<CanvasNodeConfigVO>("/api/canvas/node-types"),
};

