import { http } from "@/lib/http";
import type {
  AdminCanvasNodeConfigUpdateDTO,
  AdminCanvasNodeConfigVO,
} from "@/types/admin-canvas-nodes";

const BASE = "/api/admin/canvas/nodes";

/** Admin API for the versioned, code-registered canvas node capability document. */
export const adminCanvasNodesApi = {
  list: () => http.get<AdminCanvasNodeConfigVO>(BASE),
  update: (dto: AdminCanvasNodeConfigUpdateDTO) =>
    http.put<AdminCanvasNodeConfigVO>(BASE, dto),
};
