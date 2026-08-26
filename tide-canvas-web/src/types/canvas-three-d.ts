export type CanvasThreeDMode = "t2_3d" | "i2_3d" | "mv2_3d";
export type CanvasThreeDGenerateType = "Normal" | "Geometry";
export type CanvasThreeDResultFormat = "" | "STL" | "USDZ" | "FBX";

export interface CanvasThreeDAsset {
  type: string;
  url: string;
  previewImageUrl?: string;
  metricScaleFactor?: number;
  groundPlaneOffset?: number;
}

export interface CanvasThreeDSceneAsset {
  url: string;
  title: string;
  format?: "glb" | "spz";
  /** Director GLB meshes default to an untextured blocking model; original materials remain optional. */
  materialMode?: "original" | "solid";
  colliderUrl?: string;
  metricScaleFactor?: number;
  groundPlaneOffset?: number;
  sourceNodeId?: string;
  source?: "connected" | "restored";
}
