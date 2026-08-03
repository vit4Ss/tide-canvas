import type {
  CanvasNodeFeatureKey,
  CanvasNodeRenderer,
  CanvasNodeTypeConfigVO,
} from "@/types/canvas-node-config";

/** A code-registered toolbar capability that an administrator may assign. */
export interface AdminCanvasNodeFeatureVO {
  key: CanvasNodeFeatureKey;
  title: string;
  description: string;
  group: string;
  supportedRenderers: CanvasNodeRenderer[];
}

/** Complete, versioned document returned by the node configuration endpoint. */
export interface AdminCanvasNodeConfigVO {
  version: number;
  nodeTypes: CanvasNodeTypeConfigVO[];
  featureCatalog: AdminCanvasNodeFeatureVO[];
}

/** Mutable fields for one code-registered node type. */
export interface AdminCanvasNodeTypeUpdateDTO {
  key: string;
  /** Only controls whether this type appears in new-node entry points. */
  enabled: boolean;
  sortOrder: number;
  /** Order is also the top-toolbar display order. An empty list is meaningful. */
  features: CanvasNodeFeatureKey[];
}

/** Full replacement document for the current schema version. */
export interface AdminCanvasNodeConfigUpdateDTO {
  version: number;
  nodeTypes: AdminCanvasNodeTypeUpdateDTO[];
}
