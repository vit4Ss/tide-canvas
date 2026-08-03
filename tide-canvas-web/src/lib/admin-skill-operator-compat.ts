import {
  parseAdminStringList,
  type AdminSkillVersionVO,
} from "@/types/admin-skill";
import type { SkillEntryPoint, SkillOutputType } from "@/types/skill";

const LEGACY_ENTRY_POINTS: SkillEntryPoint[] = ["chat", "studio", "canvas", "asset", "api"];
const SIMPLE_MANIFEST_KEYS = new Set([
  "kind",
  "primaryOutputType",
  "outputTypes",
  // Historical preset backfills mirrored these execution fields in Manifest.
  "promptTemplate",
  "modelId",
  "defaultParams",
]);

function objectValue(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      return objectValue(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function sameStringSet(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && expected.every((item) => actual.includes(item));
}

function canonicalJSON(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJSON(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function defaultParamsValue(value: unknown): Record<string, unknown> | null {
  if (value == null || value === "") return {};
  return objectValue(value);
}

function isEmptyObjectSchema(value: unknown): boolean {
  const schema = objectValue(value);
  if (!schema || schema.type !== "object") return false;
  if (!Object.keys(schema).every((key) => key === "type" || key === "properties" || key === "required")) {
    return false;
  }
  const properties = schema.properties;
  if (properties !== undefined && (!objectValue(properties) || Object.keys(properties as object).length !== 0)) {
    return false;
  }
  const required = schema.required;
  return required === undefined || (Array.isArray(required) && required.length === 0);
}

function normalizePath(value: string | undefined): string {
  return (value || "").replaceAll("\\", "/").trim().toLowerCase();
}

/**
 * The legacy catalog PUT endpoint can only rebuild the deliberately simple
 * single-file Preset shape. Everything else must be edited through immutable
 * version management so custom schemas, manifests and package files survive.
 */
export function isOperatorEditablePresetVersion(
  version: AdminSkillVersionVO,
  catalogOutputType: string,
): boolean {
  if (version.kind !== "preset" || version.status !== "published") return false;

  const primaryOutput = version.primaryOutputType.toLowerCase() as SkillOutputType;
  if (!primaryOutput || primaryOutput !== catalogOutputType.toLowerCase()) return false;
  const outputs = parseAdminStringList<SkillOutputType>(version.outputTypes);
  if (outputs.length !== 1 || outputs[0] !== primaryOutput) return false;

  const entries = parseAdminStringList<SkillEntryPoint>(version.entryPoints);
  if (!sameStringSet(entries, LEGACY_ENTRY_POINTS)) return false;
  if (!isEmptyObjectSchema(version.inputSchema)) return false;

  const manifest = objectValue(version.manifest);
  if (!manifest || !Object.keys(manifest).every((key) => SIMPLE_MANIFEST_KEYS.has(key))) return false;
  if (manifest.kind !== "preset" || manifest.primaryOutputType !== primaryOutput) return false;
  const manifestOutputs = stringList(manifest.outputTypes);
  if (manifestOutputs.length !== 1 || manifestOutputs[0] !== primaryOutput) return false;
  if (manifest.promptTemplate !== undefined && manifest.promptTemplate !== version.promptTemplate) return false;
  if (manifest.modelId !== undefined && manifest.modelId !== version.modelId) return false;
  if (manifest.defaultParams !== undefined) {
    const manifestDefaults = defaultParamsValue(manifest.defaultParams);
    const versionDefaults = defaultParamsValue(version.defaultParams);
    if (!manifestDefaults || !versionDefaults || canonicalJSON(manifestDefaults) !== canonicalJSON(versionDefaults)) {
      return false;
    }
  }

  const files = version.files ?? [];
  if (normalizePath(version.primaryFilePath) !== "skill.md" || files.length !== 1) return false;
  const primaryFile = files[0];
  if (normalizePath(primaryFile.path) !== "skill.md" || typeof primaryFile.content !== "string") return false;
  if (primaryFile.content.trim() !== version.promptTemplate.trim()) return false;

  const executionText = `${version.promptTemplate}\n${primaryFile.content}\n${JSON.stringify(manifest)}`;
  return !executionText.includes("{{skill.");
}
