import { useCanvasStore } from "@/stores/use-canvas-store";

/** Correlation fields attached to uploads initiated from a canvas surface. */
export function currentCanvasUploadContext(): {
  projectId?: string;
  entryPoint: "canvas";
} {
  return {
    projectId: useCanvasStore.getState().currentProjectId ?? undefined,
    entryPoint: "canvas",
  };
}
