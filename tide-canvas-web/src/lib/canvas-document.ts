import type {
  CanvasGroup,
  CanvasNode,
  CanvasSkillRunPersistence,
  Connection,
} from "@/stores/use-canvas-store";

export interface CanvasDocument {
  nodes: CanvasNode[];
  connections: Connection[];
  groups: CanvasGroup[];
  skillRuns?: CanvasSkillRunPersistence;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/**
 * Validate the document envelope before handing individual rows to the store's
 * salvage layer. A JSON string/array or a wrongly typed graph field must not be
 * interpreted as an empty canvas and then autosaved over the remote original.
 */
export function parseCanvasDocument(raw: string): CanvasDocument {
  const parsed: unknown = JSON.parse(raw);
  const document = objectValue(parsed);
  if (!document) throw new Error("canvas document is not an object");

  const arrayField = (key: "nodes" | "connections" | "groups") => {
    const value = document[key];
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new Error(`canvas ${key} is not an array`);
    return value;
  };

  const persistedRuns = document.skillRuns ?? document.skillRunState;
  if (persistedRuns !== undefined && !objectValue(persistedRuns)) {
    throw new Error("canvas skillRuns is not an object");
  }

  return {
    nodes: arrayField("nodes") as CanvasNode[],
    connections: arrayField("connections") as Connection[],
    groups: arrayField("groups") as CanvasGroup[],
    ...(persistedRuns === undefined
      ? {}
      : { skillRuns: persistedRuns as CanvasSkillRunPersistence }),
  };
}
