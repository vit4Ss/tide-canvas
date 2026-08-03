import type {
  SkillEntryPoint,
  SkillInputSchema,
  SkillKind,
  SkillOutputType,
  SkillVO,
} from "@/types/skill";

/**
 * Admin responses intentionally include execution sources. Public SkillVO does
 * not: prompts, manifests and package files are server-owned implementation
 * details and must never be required by a public surface.
 */
export interface AdminSkillVO extends SkillVO {
  usageScenario: string;
  howTo: string;
  outputDescription: string;
  promptTemplate: string;
  modelId: string;
  defaultParams: string;
  kind: SkillKind;
  currentVersionId?: string;
}

export type AdminSkillVersionStatus = "draft" | "published" | "archived";

export interface AdminSkillFileVO {
  id?: string;
  skillVersionId?: string;
  path: string;
  content?: string;
  storageKey?: string;
  mimeType: string;
  size: number;
  sha256: string;
}

export interface AdminSkillVersionVO {
  id: string;
  skillId: string;
  version: number;
  kind: SkillKind;
  status: AdminSkillVersionStatus;
  /** The Go admin API stores these JSON values as strings. */
  entryPoints: string | SkillEntryPoint[];
  primaryOutputType: SkillOutputType;
  outputTypes: string | SkillOutputType[];
  inputSchema: string | SkillInputSchema;
  manifest: string | Record<string, unknown>;
  promptTemplate: string;
  modelId: string;
  defaultParams: string | Record<string, unknown>;
  /** Immutable placement snapshot introduced with versioned Skill bindings. */
  bindings?: string | AdminSkillBindingDTO[];
  primaryFilePath: string;
  contentHash: string;
  createdBy?: string;
  publishedAt?: string | null;
  createTime: string;
  updateTime: string;
  files?: AdminSkillFileVO[];
}

export interface AdminSkillFileInput {
  path: string;
  content: string;
  mimeType?: string;
}

export interface AdminSkillVersionCreateDTO {
  kind: SkillKind;
  entryPoints: SkillEntryPoint[];
  primaryOutputType: SkillOutputType;
  outputTypes: SkillOutputType[];
  inputSchema: SkillInputSchema | Record<string, unknown>;
  manifest: Record<string, unknown>;
  promptTemplate?: string;
  modelId?: string;
  defaultParams?: Record<string, unknown>;
  primaryFilePath?: string;
  files?: AdminSkillFileInput[];
  publish?: boolean;
  bindings?: AdminSkillBindingDTO[];
}

export interface AdminSkillBindingDTO {
  surface: SkillEntryPoint;
  targetType: string;
  enabled?: boolean;
  sortOrder?: number;
  defaults?: Record<string, unknown>;
}

export interface AdminSkillBindingVO {
  id: string;
  skillId: string;
  surface: SkillEntryPoint;
  targetType: string;
  enabled: boolean;
  sortOrder: number;
  defaults: string | Record<string, unknown>;
}

export interface AdminSkillImportPackage extends AdminSkillVersionCreateDTO {
  title: string;
  description?: string;
  usageScenario?: string;
  howTo?: string;
  outputDescription?: string;
  coverUrl?: string;
  category?: string;
  authorName?: string;
  status?: number;
  sortOrder?: number;
}

export function parseAdminStringList<T extends string>(
  raw: string | T[] | null | undefined,
): T[] {
  if (Array.isArray(raw)) return [...new Set(raw)];
  if (!raw?.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? [...new Set(parsed.filter((item): item is T => typeof item === "string"))]
      : [];
  } catch {
    return [];
  }
}

export function parseAdminBindings(
  raw: string | AdminSkillBindingDTO[] | null | undefined,
): AdminSkillBindingDTO[] {
  if (Array.isArray(raw)) return raw;
  if (!raw?.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const value = item as Record<string, unknown>;
      const surface = value.surface;
      const targetType = value.targetType;
      if (
        (surface !== "studio" && surface !== "chat" && surface !== "canvas" &&
          surface !== "asset" && surface !== "api") ||
        typeof targetType !== "string"
      ) return [];
      return [{
        surface,
        targetType,
        enabled: value.enabled !== false,
        sortOrder: typeof value.sortOrder === "number" ? value.sortOrder : 0,
        defaults:
          value.defaults && typeof value.defaults === "object" && !Array.isArray(value.defaults)
            ? value.defaults as Record<string, unknown>
            : {},
      } satisfies AdminSkillBindingDTO];
    });
  } catch {
    return [];
  }
}
