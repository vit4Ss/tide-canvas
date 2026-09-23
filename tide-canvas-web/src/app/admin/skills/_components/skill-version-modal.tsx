"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Copy, FileText, Loader2, Plus, Trash2, Upload } from "lucide-react";
import {
  AdminAlert,
  AdminEmptyState,
  AdminModal,
  Field,
  FormCard,
  FormGrid,
  StatusPill,
} from "@/components/admin";
import { toast } from "@/components/shared/toast";
import { adminSkillsApi } from "@/lib/admin-skills-api";
import { checkedSkillFileMetadata, readUTF8File } from "@/lib/admin-skill-package";
import {
  ADMIN_SKILL_ENTRY_POINTS as ENTRY_POINTS,
  constrainAdminSkillEntryPoints,
  defaultAdminSkillEntryPoints,
  defaultAdminSkillOutputTypes,
  defaultAdminSkillTarget,
  starterAdminSkillInputSchema,
  starterAdminSkillManifest,
} from "@/lib/admin-skill-defaults";
import {
  parseAdminBindings,
  parseAdminStringList,
  type AdminSkillBindingDTO,
  type AdminSkillBindingVO,
  type AdminSkillFileInput,
  type AdminSkillVO,
  type AdminSkillVersionCreateDTO,
  type AdminSkillVersionVO,
} from "@/types/admin-skill";
import {
  SKILL_KIND_LABEL,
  SKILL_OUTPUT_LABEL,
  type SkillEntryPoint,
  type SkillKind,
  type SkillOutputType,
} from "@/types/skill";
import { SkillManifestAiControl, type SkillManifestDraftRequest } from "./skill-manifest-ai-control";
import { detectSkillInputPreset, SKILL_INPUT_PRESETS, skillInputSchemaFor, type SkillInputPreset } from "./skill-input-schema-presets";

const OUTPUT_TYPES: SkillOutputType[] = ["text", "image", "video", "audio", "file"];
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_PACKAGE_BYTES = 8 * 1024 * 1024;

interface VersionForm {
  kind: SkillKind;
  entryPoints: SkillEntryPoint[];
  primaryOutputType: SkillOutputType;
  outputTypes: SkillOutputType[];
  inputSchema: string;
  manifest: string;
  promptTemplate: string;
  modelId: string;
  defaultParams: string;
  primaryFilePath: string;
  files: AdminSkillFileInput[];
  publish: boolean;
  bindings: BindingFormRow[];
}

interface BindingFormRow {
  key: string;
  surface: SkillEntryPoint;
  targetType: string;
  enabled: boolean;
  sortOrder: string;
  defaults: string;
}

const GENERATION_TARGETS = [
  ["*", "全部类型"],
  ["text", "文本"],
  ["image", "图片"],
  ["video", "视频"],
  ["audio", "音频"],
] as const;

const CANVAS_TARGETS = [
  ["*", "全部节点"],
  ["character", "角色"],
  ["scene", "场景"],
  ["scene_3d", "3D 导演台"],
  ["text", "文本"],
  ["image", "图片"],
  ["video", "视频"],
  ["audio", "音频"],
  ["script", "脚本"],
] as const;

const ASSET_TARGETS = [
  ["*", "全部资产"],
  ["general", "普通素材"],
  ["character", "角色资产"],
  ["scene", "场景资产"],
] as const;

const API_TARGETS = [["*", "全部 API 调用"]] as const;

const TARGETS_BY_SURFACE: Record<
  SkillEntryPoint,
  readonly (readonly [string, string])[]
> = {
  studio: GENERATION_TARGETS,
  chat: GENERATION_TARGETS,
  canvas: CANVAS_TARGETS,
  asset: ASSET_TARGETS,
  api: API_TARGETS,
};

const IMAGE_ONLY_ASSET_TARGETS = new Set(["*", "character", "scene"]);

function targetsForSurface(
  surface: SkillEntryPoint,
  primaryOutputType: SkillOutputType,
): readonly (readonly [string, string])[] {
  const targets = TARGETS_BY_SURFACE[surface];
  if (surface !== "asset" || primaryOutputType === "image") return targets;
  return targets.filter(([target]) => !IMAGE_ONLY_ASSET_TARGETS.has(target));
}

function starterModelIdFromManifest(raw: string): string {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "";
    const steps = (parsed as { steps?: unknown }).steps;
    if (!Array.isArray(steps)) return "";
    for (const step of steps) {
      if (!step || typeof step !== "object" || Array.isArray(step)) continue;
      const modelId = (step as { modelId?: unknown }).modelId;
      if (typeof modelId === "string") return modelId;
    }
  } catch {
    // Invalid or hand-written JSON is never treated as a generated starter.
  }
  return "";
}

function isStarterManifest(
  raw: string,
  kind: SkillKind,
  primaryOutputType: SkillOutputType,
): boolean {
  try {
    const parsed: unknown = JSON.parse(raw);
    const expected = starterAdminSkillManifest(
      kind,
      primaryOutputType,
      starterModelIdFromManifest(raw),
    );
    return JSON.stringify(parsed) === JSON.stringify(expected);
  } catch {
    return false;
  }
}

const ENTRY_LABEL = Object.fromEntries(
  ENTRY_POINTS.map((entry) => [entry.key, entry.label]),
) as Record<SkillEntryPoint, string>;

let bindingRowSequence = 0;

function bindingRowKey(prefix = "binding"): string {
  bindingRowSequence += 1;
  return `${prefix}-${bindingRowSequence}`;
}

function stringifyBindingDefaults(
  raw: string | Record<string, unknown> | null | undefined,
): string {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return "{}";
    try {
      const parsed: unknown = JSON.parse(trimmed);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? JSON.stringify(parsed, null, 2)
        : raw;
    } catch {
      // Preserve invalid historical data so the editor surfaces it instead of
      // silently replacing it with an empty object on the next publish.
      return raw;
    }
  }
  return JSON.stringify(raw && !Array.isArray(raw) ? raw : {}, null, 2);
}

function bindingRows(
  rows: readonly (AdminSkillBindingDTO | AdminSkillBindingVO)[],
  prefix = "binding",
): BindingFormRow[] {
  return rows.map((row) => ({
    key: bindingRowKey(prefix),
    surface: row.surface,
    targetType: row.targetType || "*",
    enabled: row.enabled !== false,
    sortOrder: String(row.sortOrder ?? 0),
    defaults: stringifyBindingDefaults(row.defaults),
  }));
}

function defaultBindings(
  entryPoints: readonly SkillEntryPoint[],
  primaryOutputType: SkillOutputType,
): BindingFormRow[] {
  return entryPoints.map((surface, sortOrder) => ({
    key: bindingRowKey("default"),
    surface,
    targetType: defaultAdminSkillTarget(surface, primaryOutputType),
    enabled: true,
    sortOrder: String(sortOrder),
    defaults: "{}",
  }));
}

function constrainBindingRows(
  kind: SkillKind,
  entryPoints: readonly SkillEntryPoint[],
  primaryOutputType: SkillOutputType,
  rows: readonly BindingFormRow[],
): BindingFormRow[] {
  const allowedEntries = constrainAdminSkillEntryPoints(kind, entryPoints);
  const allowed = new Set(allowedEntries);
  const constrained = rows.filter((row) => allowed.has(row.surface));
  for (const surface of allowedEntries) {
    if (constrained.some((row) => row.surface === surface)) continue;
    constrained.push(...defaultBindings([surface], primaryOutputType));
  }
  return constrained;
}

function emptyForm(skill: AdminSkillVO): VersionForm {
  const kind = skill.kind || "preset";
  const output = (skill.outputType || "text") as SkillOutputType;
  const supportedEntries = [...new Set((skill.entryPoints ?? []).filter((entry) =>
    ENTRY_POINTS.some((candidate) => candidate.key === entry),
  ))];
  const entryPoints = constrainAdminSkillEntryPoints(kind, supportedEntries);
  return {
    kind,
    entryPoints,
    primaryOutputType: output,
    outputTypes: defaultAdminSkillOutputTypes(kind, output),
    // The schema describes input.parameters only. Prompt and source assets are
    // stable top-level run fields rendered by every product surface already.
    inputSchema: JSON.stringify(starterAdminSkillInputSchema(kind, output), null, 2),
    manifest: JSON.stringify(starterAdminSkillManifest(kind, output), null, 2),
    promptTemplate: kind === "preset" ? skill.promptTemplate || "" : "",
    modelId: kind === "preset" ? skill.modelId || "" : "",
    defaultParams: skill.defaultParams?.trim() || "{}",
    primaryFilePath: "",
    files: [],
    publish: false,
    bindings: defaultBindings(entryPoints, output),
  };
}

function initialVersionId(skill: AdminSkillVO, versions: readonly AdminSkillVersionVO[]): string | undefined {
  // A newer draft must not silently replace the version that users actually run.
  if (skill.currentVersionId && skill.currentVersionId !== "0") return skill.currentVersionId;
  const newest = [...versions].sort((a, b) => b.version - a.version);
  return (newest.find((version) => version.status === "published") ?? newest[0])?.id;
}

function formFromVersion(version: AdminSkillVersionVO, fallbackBindings: readonly BindingFormRow[]): VersionForm {
  const entryPoints = constrainAdminSkillEntryPoints(version.kind, parseAdminStringList<SkillEntryPoint>(version.entryPoints));
  const outputTypes = parseAdminStringList<SkillOutputType>(version.outputTypes);
  const versionBindings = parseAdminBindings(version.bindings);
  const sourceBindings = versionBindings.length
    ? bindingRows(versionBindings, `version-${version.id}`)
    : fallbackBindings.map((binding) => ({ ...binding, key: bindingRowKey(`version-${version.id}-fallback`) }));
  const stringify = (value: unknown): string => {
    if (typeof value !== "string") return JSON.stringify(value ?? {}, null, 2);
    try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; }
  };
  const files = version.files ?? [];
  // Never silently drop files from a partial/list response then save that as a
  // new version. Imported packages must be restored from complete detail data.
  if ((version.primaryFilePath && !files.some((file) => file.path === version.primaryFilePath))
    || files.some((file) => typeof file.content !== "string" || !!file.storageKey)) {
    throw new Error("版本文件内容不完整，无法载入新草稿，请重新加载");
  }
  return {
    kind: version.kind,
    entryPoints,
    primaryOutputType: version.primaryOutputType,
    outputTypes: version.kind === "preset" ? [version.primaryOutputType]
      : outputTypes.length ? outputTypes : [version.primaryOutputType],
    inputSchema: stringify(version.inputSchema),
    manifest: stringify(version.manifest),
    promptTemplate: version.promptTemplate || "",
    modelId: version.modelId || "",
    defaultParams: stringify(version.defaultParams),
    primaryFilePath: version.primaryFilePath || "",
    files: files.map((file) => ({ path: file.path, content: file.content!, mimeType: file.mimeType })),
    publish: false,
    bindings: constrainBindingRows(version.kind, entryPoints, version.primaryOutputType, sourceBindings),
  };
}

function objectJSON(raw: string, label: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(raw || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("shape");
    return value as Record<string, unknown>;
  } catch {
    toast.error(`${label}必须是 JSON 对象`);
    return null;
  }
}

function silentObjectJSON(raw: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(raw || "{}");
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function versionManifestSource(form: VersionForm): string {
  const requested = form.primaryFilePath.trim().toLowerCase();
  const primary = form.files.find((file) => file.path.trim().toLowerCase() === requested) ??
    form.files.find((file) => /(^|\/)skill\.md$/i.test(file.path)) ?? form.files[0];
  return primary?.content?.trim() || form.promptTemplate.trim();
}

function versionManifestSignature(form: VersionForm): string {
  return JSON.stringify({
    kind: form.kind,
    primaryOutputType: form.primaryOutputType,
    outputTypes: form.outputTypes,
    inputSchema: form.inputSchema,
    source: versionManifestSource(form),
  });
}

function withoutTextModelDefaults(raw: string, primaryOutputType: SkillOutputType): string {
  const defaults = silentObjectJSON(raw);
  // Preserve malformed input so the existing save validation reports it.
  if (!defaults) return raw;
  delete defaults.textModelId;
  if (primaryOutputType === "text" || primaryOutputType === "file") delete defaults.modelId;
  return JSON.stringify(defaults, null, 2);
}

function versionTone(status: AdminSkillVersionVO["status"]): "green" | "blue" | "gray" {
  if (status === "published") return "green";
  if (status === "draft") return "blue";
  return "gray";
}

function versionStatus(status: AdminSkillVersionVO["status"]): string {
  if (status === "published") return "已发布";
  if (status === "draft") return "草稿";
  return "已归档";
}

function SkillBindingEditor({
  entryPoints,
  primaryOutputType,
  bindings,
  errors,
  onAdd,
  onUpdate,
  onRemove,
}: {
  entryPoints: readonly SkillEntryPoint[];
  primaryOutputType: SkillOutputType;
  bindings: readonly BindingFormRow[];
  errors: Readonly<Record<string, string>>;
  onAdd: (surface: SkillEntryPoint) => void;
  onUpdate: (
    key: string,
    patch: Partial<Omit<BindingFormRow, "key" | "surface">>,
  ) => void;
  onRemove: (key: string) => void;
}) {
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {entryPoints.map((surface) => {
        const rows = bindings.filter((binding) => binding.surface === surface);
        const targets = targetsForSurface(surface, primaryOutputType);
        const usedTargets = new Set(rows.map((binding) => binding.targetType));
        const canAdd = targets.some(([target]) => !usedTargets.has(target));
        return (
          <section
            key={surface}
            aria-label={`${ENTRY_LABEL[surface]}落点配置`}
            style={{
              overflow: "hidden",
              border: "1px solid var(--border, #e5e7eb)",
              borderRadius: 10,
            }}
          >
            <header
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 12px",
                borderBottom: rows.length ? "1px solid var(--border, #e5e7eb)" : undefined,
              }}
            >
              <span style={{ minWidth: 0, flex: 1 }}>
                <strong style={{ display: "block", fontSize: 13 }}>{ENTRY_LABEL[surface]}</strong>
                <small className="muted" style={{ fontSize: 11 }}>
                  {rows.length ? `${rows.length} 个落点；精确落点优先于 *` : "尚未配置落点"}
                </small>
              </span>
              <button
                type="button"
                className="adm-btn ghost"
                disabled={!canAdd}
                title={canAdd ? `添加${ENTRY_LABEL[surface]}落点` : "所有可用落点均已添加"}
                onClick={() => onAdd(surface)}
              >
                <Plus aria-hidden size={13} />
                添加落点
              </button>
            </header>

            {rows.length ? (
              <div style={{ display: "grid" }}>
                {rows.map((binding, index) => {
                  const knownTarget = targets.some(([target]) => target === binding.targetType);
                  const targetOptions = knownTarget
                    ? targets
                    : ([
                        [
                          binding.targetType,
                          surface === "asset" &&
                          primaryOutputType !== "image" &&
                          IMAGE_ONLY_ASSET_TARGETS.has(binding.targetType)
                            ? `${binding.targetType}（仅支持图片输出，请修改）`
                            : `${binding.targetType}（已有自定义值）`,
                        ],
                        ...targets,
                      ] as const);
                  return (
                    <div
                      key={binding.key}
                      style={{
                        display: "grid",
                        gap: 10,
                        padding: 12,
                        borderTop: index ? "1px solid var(--border, #e5e7eb)" : undefined,
                      }}
                    >
                      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "end", gap: 10 }}>
                        <label style={{ minWidth: 180, flex: "1 1 220px" }}>
                          <span className="muted" style={{ display: "block", marginBottom: 5, fontSize: 11 }}>
                            落点类型
                          </span>
                          <select
                            value={binding.targetType}
                            aria-label={`${ENTRY_LABEL[surface]}落点类型`}
                            onChange={(event) => onUpdate(binding.key, { targetType: event.target.value })}
                          >
                            {targetOptions.map(([target, label]) => (
                              <option
                                key={target}
                                value={target}
                                disabled={
                                  surface === "asset" &&
                                  primaryOutputType !== "image" &&
                                  IMAGE_ONLY_ASSET_TARGETS.has(target)
                                }
                              >
                                {label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label style={{ width: 96 }}>
                          <span className="muted" style={{ display: "block", marginBottom: 5, fontSize: 11 }}>
                            排序
                          </span>
                          <input
                            type="number"
                            step={1}
                            value={binding.sortOrder}
                            aria-label={`${ENTRY_LABEL[surface]} ${binding.targetType} 排序`}
                            onChange={(event) => onUpdate(binding.key, { sortOrder: event.target.value })}
                          />
                        </label>
                        <label
                          style={{
                            display: "inline-flex",
                            minHeight: 36,
                            alignItems: "center",
                            gap: 6,
                            padding: "0 4px",
                            fontSize: 12,
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={binding.enabled}
                            onChange={(event) => onUpdate(binding.key, { enabled: event.target.checked })}
                          />
                          启用
                        </label>
                        <button
                          type="button"
                          className="adm-btn ghost"
                          aria-label={`移除${ENTRY_LABEL[surface]} ${binding.targetType} 落点`}
                          onClick={() => onRemove(binding.key)}
                        >
                          <Trash2 aria-hidden size={13} />
                          移除
                        </button>
                      </div>
                      <label>
                        <span className="muted" style={{ display: "block", marginBottom: 5, fontSize: 11 }}>
                          落点默认参数（JSON 对象，会覆盖版本默认参数中的同名键）
                        </span>
                        <textarea
                          rows={3}
                          value={binding.defaults}
                          spellCheck={false}
                          aria-invalid={!!errors[binding.key]}
                          aria-label={`${ENTRY_LABEL[surface]} ${binding.targetType} 默认参数`}
                          style={{ width: "100%", fontFamily: "var(--mono)" }}
                          onChange={(event) => onUpdate(binding.key, { defaults: event.target.value })}
                        />
                      </label>
                      {errors[binding.key] ? (
                        <small style={{ color: "var(--danger, #dc2626)", fontSize: 11 }}>
                          {errors[binding.key]}
                        </small>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="muted" style={{ padding: "16px 12px", fontSize: 12 }}>
                此入口不会展示或启动该 Skill；请添加至少一个落点后再保存。
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

export function SkillVersionModal({
  open,
  skill,
  onClose,
  onChanged,
}: {
  open: boolean;
  skill: AdminSkillVO | null;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
}) {
  const [versions, setVersions] = useState<AdminSkillVersionVO[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [sourceVersion, setSourceVersion] = useState<AdminSkillVersionVO | null>(null);
  const [filesReplaced, setFilesReplaced] = useState(false);
  const [readingFiles, setReadingFiles] = useState(false);
  const [publishingId, setPublishingId] = useState("");
  const [copyingId, setCopyingId] = useState("");
  const [manifestAiBusy, setManifestAiBusy] = useState(false);
  const [form, setForm] = useState<VersionForm | null>(null);
  const [bindingErrors, setBindingErrors] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const loadingRef = useRef(false);
  const copyingRef = useRef(false);
  const readingFilesRef = useRef(false);
  const modalGenerationRef = useRef(0);
  const copySeqRef = useRef(0);
  const fileReadSeqRef = useRef(0);
  const publishSeqRef = useRef(0);
  const loadSeqRef = useRef(0);

  const load = useCallback(async (generation = modalGenerationRef.current, initialize = false) => {
    if (!skill) return;
    const seq = ++loadSeqRef.current;
    const active = () => generation === modalGenerationRef.current && seq === loadSeqRef.current;
    loadingRef.current = true;
    setLoading(true);
    setLoadError("");
    try {
      const res = await adminSkillsApi.listVersions(skill.id);
      if (!active()) return;
      if (!res.success || !Array.isArray(res.data)) throw new Error(res.message || "版本加载失败");
      setVersions(res.data);
      if (initialize) {
        const versionId = initialVersionId(skill, res.data);
        const [bindings, detail] = await Promise.all([
          adminSkillsApi.listBindings(skill.id),
          versionId ? adminSkillsApi.getVersion(skill.id, versionId) : Promise.resolve(null),
        ]);
        if (!active()) return;
        if (!bindings.success || !Array.isArray(bindings.data)) throw new Error(bindings.message || "入口配置加载失败");
        const base = emptyForm(skill);
        base.bindings = constrainBindingRows(base.kind, base.entryPoints, base.primaryOutputType, bindingRows(bindings.data, "live"));
        if (versionId) {
          if (!detail?.success || !detail.data || detail.data.id !== versionId || detail.data.skillId !== skill.id) {
            throw new Error(detail?.message || "版本详情加载失败");
          }
          setForm(formFromVersion(detail.data, base.bindings));
          setSourceVersion(detail.data);
        } else {
          setForm(base);
          setSourceVersion(null);
        }
        setFilesReplaced(false);
        setBindingErrors({});
      }
    } catch (error) {
      if (active()) setLoadError(error instanceof Error ? error.message : "版本加载失败，请重试");
    } finally {
      if (active()) {
        loadingRef.current = false;
        setLoading(false);
      }
    }
  }, [skill]);

  useEffect(() => {
    if (!open || !skill) return;
    const generation = ++modalGenerationRef.current;
    const frame = requestAnimationFrame(() => {
      setVersions([]);
      setLoading(false);
      setPublishingId("");
      setCopyingId("");
      setManifestAiBusy(false);
      setReadingFiles(false);
      readingFilesRef.current = false;
      copyingRef.current = false;
      setForm(emptyForm(skill));
      setSourceVersion(null);
      setFilesReplaced(false);
      setBindingErrors({});
      void load(generation, true);
    });
    return () => {
      modalGenerationRef.current += 1;
      loadSeqRef.current += 1;
      copySeqRef.current += 1;
      fileReadSeqRef.current += 1;
      publishSeqRef.current += 1;
      cancelAnimationFrame(frame);
    };
  }, [load, open, skill]);

  const packageBytes = useMemo(
    () => form?.files.reduce((sum, file) => sum + new Blob([file.content]).size, 0) ?? 0,
    [form?.files],
  );

  if (!skill || !form) return null;
  const editorBlocked = loading || !!loadError || !!copyingId || readingFiles || !!publishingId;

  const loadManifestRequests = async (): Promise<SkillManifestDraftRequest[]> => {
    const inputSchema = silentObjectJSON(form.inputSchema);
    if (!inputSchema) throw new Error("请先填写合法的输入 Schema JSON 对象");
    let source = versionManifestSource(form);
    if (!source && skill.currentVersionId) {
      const response = await adminSkillsApi.getVersion(skill.id, skill.currentVersionId);
      if (!response.success || !response.data) {
        throw new Error(response.message || "当前发布版本读取失败");
      }
      const version = response.data;
      const primaryPath = version.primaryFilePath?.trim().toLowerCase();
      const files = version.files ?? [];
      const primary = files.find((file) => file.path.trim().toLowerCase() === primaryPath) ??
        files.find((file) => /(^|\/)skill\.md$/i.test(file.path)) ?? files[0];
      source = primary?.content?.trim() || version.promptTemplate?.trim() || "";
    }
    return [{
      key: skill.id,
      title: skill.title,
      source,
      kind: form.kind,
      primaryOutputType: form.primaryOutputType,
      outputTypes: form.outputTypes,
      inputSchema,
      signature: versionManifestSignature(form),
    }];
  };
  const detectedInputPreset = detectSkillInputPreset(silentObjectJSON(form.inputSchema));

  const toggleEntry = (key: SkillEntryPoint) => {
    if (form.kind === "agent") return;
    if (form.kind === "preset" && key === "api") return;
    if (form.kind === "tool" && key !== "studio" && key !== "api") return;
    setBindingErrors({});
    setForm((current) => {
      if (!current) return current;
      const exists = current.entryPoints.includes(key);
      const hasBinding = current.bindings.some((binding) => binding.surface === key);
      return {
        ...current,
        entryPoints: exists
          ? current.entryPoints.filter((item) => item !== key)
          : [...current.entryPoints, key],
        bindings: !exists && !hasBinding
          ? [
              ...current.bindings,
              {
                key: bindingRowKey("added"),
                surface: key,
                targetType: defaultAdminSkillTarget(key, current.primaryOutputType),
                enabled: true,
                sortOrder: "0",
                defaults: "{}",
              },
            ]
          : current.bindings,
      };
    });
  };

  const updateBinding = (key: string, patch: Partial<Omit<BindingFormRow, "key" | "surface">>) => {
    setBindingErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
    setForm((current) => current && ({
      ...current,
      bindings: current.bindings.map((binding) =>
        binding.key === key ? { ...binding, ...patch } : binding,
      ),
    }));
  };

  const addBinding = (surface: SkillEntryPoint) => {
    setBindingErrors({});
    setForm((current) => {
      if (!current) return current;
      const surfaceRows = current.bindings.filter((binding) => binding.surface === surface);
      const used = new Set(surfaceRows.map((binding) => binding.targetType));
      const targetType = targetsForSurface(surface, current.primaryOutputType)
        .find(([target]) => !used.has(target))?.[0];
      if (!targetType) {
        toast.info(`${ENTRY_LABEL[surface]}没有更多可添加的落点`);
        return current;
      }
      const sortOrders = surfaceRows.map((binding) => Number(binding.sortOrder));
      const maxSortOrder = sortOrders.filter(Number.isFinite).reduce((max, value) => Math.max(max, value), -1);
      return {
        ...current,
        bindings: [
          ...current.bindings,
          {
            key: bindingRowKey("added"),
            surface,
            targetType,
            enabled: true,
            sortOrder: String(maxSortOrder + 1),
            defaults: "{}",
          },
        ],
      };
    });
  };

  const removeBinding = (key: string) => {
    setBindingErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
    setForm((current) => current && ({
      ...current,
      bindings: current.bindings.filter((binding) => binding.key !== key),
    }));
  };

  const toggleOutput = (key: SkillOutputType) => {
    setForm((current) => {
      if (!current) return current;
      if (current.kind === "preset") return current;
      if (key === current.primaryOutputType) return current;
      const exists = current.outputTypes.includes(key);
      return {
        ...current,
        outputTypes: exists
          ? current.outputTypes.filter((item) => item !== key)
          : [...current.outputTypes, key],
      };
    });
  };

  const readFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = [...(event.target.files ?? [])];
    event.target.value = "";
    if (!selected.length) return;
    if (editorBlocked || manifestAiBusy || loadingRef.current || copyingRef.current || readingFilesRef.current) return;
    const generation = modalGenerationRef.current;
    const readSeq = ++fileReadSeqRef.current;
    readingFilesRef.current = true;
    setReadingFiles(true);
    try {
      let total = 0;
      const next: AdminSkillFileInput[] = [];
      for (const file of selected) {
        const path = (file.webkitRelativePath || file.name).replaceAll("\\", "/");
        const lower = path.toLowerCase();
        if (!lower.endsWith(".md") && !lower.endsWith(".txt")) {
          toast.error(`不支持的文件：${path}`);
          return;
        }
        if (file.size <= 0 || file.size > MAX_FILE_BYTES) {
          toast.error(`${path} 超过 2 MB 单文件限制`);
          return;
        }
        total += file.size;
        if (total > MAX_PACKAGE_BYTES) {
          toast.error("文件包超过 8 MB 限制");
          return;
        }
        const content = await readUTF8File(file, path);
        if (generation !== modalGenerationRef.current || readSeq !== fileReadSeqRef.current) return;
        next.push({
          path,
          content,
          mimeType: lower.endsWith(".md")
            ? "text/markdown; charset=utf-8"
            : "text/plain; charset=utf-8",
        });
      }
      if (generation !== modalGenerationRef.current || readSeq !== fileReadSeqRef.current) return;
      const skillMd = next.find((file) => /(^|\/)SKILL\.md$/.test(file.path));
      if (!skillMd) throw new Error("文件包必须包含 SKILL.md 主文件（区分大小写）");
      checkedSkillFileMetadata(await adminSkillsApi.validateFiles([{ primaryFilePath: skillMd.path, files: next }]), 1);
      if (generation !== modalGenerationRef.current || readSeq !== fileReadSeqRef.current) return;
      setForm((current) => current && ({
        ...current,
        files: next,
        primaryFilePath: skillMd.path,
      }));
      setFilesReplaced(true);
    } catch (error) {
      if (generation === modalGenerationRef.current && readSeq === fileReadSeqRef.current) {
        toast.error(error instanceof Error ? error.message : "文件读取失败，已保留原文件包");
      }
    } finally {
      if (generation === modalGenerationRef.current && readSeq === fileReadSeqRef.current) {
        readingFilesRef.current = false;
        setReadingFiles(false);
      }
    }
  };

  const copyVersion = async (summary: AdminSkillVersionVO) => {
    if (editorBlocked || manifestAiBusy || copyingRef.current || loadingRef.current || readingFilesRef.current) return;
    const generation = modalGenerationRef.current;
    const copySeq = ++copySeqRef.current;
    const active = () => generation === modalGenerationRef.current && copySeq === copySeqRef.current;
    copyingRef.current = true;
    setCopyingId(summary.id);
    try {
      const detail = await adminSkillsApi.getVersion(skill.id, summary.id);
      if (!active()) return;
      if (!detail.success || !detail.data || detail.data.id !== summary.id || detail.data.skillId !== skill.id) {
        throw new Error(detail.message || "版本详情加载失败");
      }
      const next = formFromVersion(detail.data, form.bindings);
      setForm(next);
      setSourceVersion(detail.data);
      setFilesReplaced(false);
      setBindingErrors({});
      toast.info(`已载入 v${detail.data.version} 配置和文件，保存时创建新草稿`);
    } catch (error) {
      if (active()) toast.error(error instanceof Error ? error.message : "版本详情加载失败，已保留当前草稿");
    } finally {
      if (active()) {
        copyingRef.current = false;
        setCopyingId("");
      }
    }
  };

  const save = async () => {
    if (editorBlocked || loadingRef.current || copyingRef.current || readingFilesRef.current) {
      toast.info(loadError ? "请先重新加载版本后再保存" : "版本或文件正在加载，请稍候");
      return false;
    }
    if (manifestAiBusy) {
      toast.info("Manifest 草稿仍在生成，请等待完成或先停止生成");
      return false;
    }
    const entryPoints = constrainAdminSkillEntryPoints(form.kind, form.entryPoints);
    const outputTypes = form.kind === "preset"
      ? [form.primaryOutputType]
      : [...new Set([form.primaryOutputType, ...form.outputTypes])];
    if (!entryPoints.length) {
      toast.error("请至少选择一个使用入口");
      return false;
    }
    if (!outputTypes.length) {
      toast.error("请至少选择一个输出类型");
      return false;
    }
    for (const entryPoint of entryPoints) {
      if (!form.bindings.some((binding) => binding.surface === entryPoint)) {
        toast.error(`请为${ENTRY_LABEL[entryPoint]}至少添加一个落点`);
        return false;
      }
    }
    if (form.files.length > 1 && !form.primaryFilePath) {
      toast.error("多文件包必须指定主文件，目录包通常使用 SKILL.md");
      return false;
    }
    if (!form.files.length && !form.promptTemplate.trim()) {
      toast.error("请填写提示词，或导入 .md/.txt 文件包");
      return false;
    }
    const inputSchema = objectJSON(form.inputSchema, "输入 Schema");
    const manifest = objectJSON(form.manifest, "Manifest");
    const defaultParams = objectJSON(form.defaultParams, "默认参数");
    if (!inputSchema || !manifest || !defaultParams) return false;

    const nextBindingErrors: Record<string, string> = {};
    const seenBindings = new Set<string>();
    const bindings: AdminSkillBindingDTO[] = [];
    for (const binding of form.bindings.filter((row) => entryPoints.includes(row.surface))) {
      const issues: string[] = [];
      const targetType = binding.targetType.trim().toLowerCase();
      if (!targetType || targetType.length > 32 || /[ /\\\0]/.test(targetType)) {
        issues.push("落点格式无效");
      }
      if (
        binding.surface === "asset" &&
        form.primaryOutputType !== "image" &&
        IMAGE_ONLY_ASSET_TARGETS.has(targetType)
      ) {
        issues.push("非图片主输出只能使用普通素材落点");
      }
      const duplicateKey = `${binding.surface}\u0000${targetType}`;
      if (seenBindings.has(duplicateKey)) issues.push("同一入口不能重复配置相同落点");
      else seenBindings.add(duplicateKey);

      const sortOrder = Number(binding.sortOrder);
      if (!binding.sortOrder.trim() || !Number.isSafeInteger(sortOrder)) {
        issues.push("排序必须是整数");
      }

      let defaults: Record<string, unknown> | null = null;
      try {
        const parsed: unknown = JSON.parse(binding.defaults);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          issues.push("默认参数必须是 JSON 对象");
        } else {
          defaults = parsed as Record<string, unknown>;
        }
      } catch {
        issues.push("默认参数不是合法 JSON");
      }

      if (issues.length) {
        nextBindingErrors[binding.key] = issues.join("；");
        continue;
      }
      bindings.push({
        surface: binding.surface,
        targetType,
        enabled: binding.enabled,
        sortOrder,
        defaults: defaults!,
      });
    }
    setBindingErrors(nextBindingErrors);
    if (Object.keys(nextBindingErrors).length) {
      toast.error("请检查入口落点配置");
      return false;
    }

    const dto: AdminSkillVersionCreateDTO = {
      kind: form.kind,
      entryPoints,
      primaryOutputType: form.primaryOutputType,
      outputTypes,
      inputSchema,
      manifest: { ...manifest, kind: form.kind },
      promptTemplate: form.promptTemplate || undefined,
      modelId: form.modelId || undefined,
      defaultParams,
      primaryFilePath: form.primaryFilePath || undefined,
      files: form.files.length ? form.files : undefined,
      publish: form.publish,
      bindings,
    };
    const res = form.files.length
      ? await adminSkillsApi.importVersion(skill.id, dto)
      : await adminSkillsApi.createVersion(skill.id, dto);
    if (!res.success) {
      toast.error(res.message || "版本创建失败");
      return false;
    }
    toast.success(form.publish ? "新版本已发布" : "新版本草稿已保存");
    await onChanged();
    return true;
  };

  const publish = async (version: AdminSkillVersionVO) => {
    if (editorBlocked || manifestAiBusy || loadingRef.current || copyingRef.current || readingFilesRef.current) return;
    const generation = modalGenerationRef.current;
    const publishSeq = ++publishSeqRef.current;
    setPublishingId(version.id);
    const res = await adminSkillsApi.publishVersion(skill.id, version.id);
    if (generation !== modalGenerationRef.current || publishSeq !== publishSeqRef.current) return;
    setPublishingId("");
    if (!res.success) {
      toast.error(res.message || "发布失败");
      return;
    }
    toast.success(`v${version.version} 已发布`);
    await load(generation);
    if (generation !== modalGenerationRef.current || publishSeq !== publishSeqRef.current) return;
    await onChanged();
  };

  return (
    <AdminModal
      open={open}
      size="xl"
      title={`运行版本 · ${skill.title}`}
      subtitle="已发布版本不可变；修改配置会创建新草稿，确认后再切换线上版本。"
      saveLabel={form.publish ? "创建并发布" : "保存新草稿"}
      footNote="发布只影响之后启动的运行；历史运行始终固定原版本。"
      closeable={!manifestAiBusy}
      onClose={onClose}
      onSave={save}
    >
      <FormCard title="版本历史">
        {loadError ? (
          <AdminAlert tone="error" title="版本加载失败">
            {loadError}
            <button type="button" className="adm-btn ghost" onClick={() => void load(modalGenerationRef.current, !sourceVersion)}>重新加载</button>
          </AdminAlert>
        ) : loading ? (
          <div style={{ minHeight: 100, display: "grid", placeItems: "center" }}>
            <Loader2 className="adm-spin" aria-hidden size={18} />
          </div>
        ) : versions.length === 0 ? (
          <AdminEmptyState title="暂无版本" description="保存下方配置以创建 v1。" />
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {versions.map((version) => (
              <div
                key={version.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "64px minmax(0,1fr) auto auto",
                  gap: 12,
                  alignItems: "center",
                  padding: "10px 12px",
                  border: "1px solid var(--border, #e5e7eb)",
                  borderRadius: 10,
                }}
              >
                <strong>v{version.version}</strong>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 13 }}>
                    {SKILL_KIND_LABEL[version.kind]} · {SKILL_OUTPUT_LABEL[version.primaryOutputType] || version.primaryOutputType}
                    {version.primaryFilePath ? ` · ${version.primaryFilePath}` : ""}
                  </span>
                  <span className="muted" style={{ display: "block", fontSize: 11 }}>
                    {version.contentHash ? version.contentHash.slice(0, 12) : "无内容摘要"}
                    {version.publishedAt ? ` · ${version.publishedAt.replace("T", " ").slice(0, 16)}` : ""}
                  </span>
                </span>
                <StatusPill tone={versionTone(version.status)}>{versionStatus(version.status)}</StatusPill>
                <span style={{ display: "flex", gap: 6 }}>
                  <button
                    type="button"
                    className="adm-btn ghost"
                    disabled={editorBlocked || manifestAiBusy}
                    onClick={() => void copyVersion(version)}
                  >
                    {copyingId === version.id
                      ? <Loader2 className="adm-spin" aria-hidden size={13} />
                      : <Copy aria-hidden size={13} />}
                    载入此版本
                  </button>
                  {version.status !== "published" ? (
                    <button
                      type="button"
                      className="adm-btn ghost"
                      disabled={editorBlocked || manifestAiBusy}
                      onClick={() => void publish(version)}
                    >
                      {publishingId === version.id ? (
                        <Loader2 className="adm-spin" aria-hidden size={13} />
                      ) : (
                        <CheckCircle2 aria-hidden size={13} />
                      )}
                      发布
                    </button>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        )}
      </FormCard>

      <FormCard title="新版本运行配置">
        {sourceVersion && (
          <AdminAlert tone="info" title={`已载入${sourceVersion.id === skill.currentVersionId ? "当前发布" : ""}版本 v${sourceVersion.version}`}>
            配置和文件包已自动带入，无需再次导入。修改后保存为新草稿，发布后才会替换线上版本。
          </AdminAlert>
        )}
        {form.kind === "preset" ? (
          <AdminAlert tone="info" title="预设技能使用固定 Manifest">
            预设技能没有多步骤编排，系统会根据主输出生成最小运行配置，无需调用文本模型。
          </AdminAlert>
        ) : !editorBlocked ? (
          <SkillManifestAiControl
            key={versionManifestSignature(form)}
            loadRequests={loadManifestRequests}
            onBusyChange={setManifestAiBusy}
            onGenerated={(results) => {
              const result = results[0];
              if (!result) return;
              setForm((current) => {
                if (!current || result.signature !== versionManifestSignature(current)) return current;
                return {
                  ...current,
                  // Regeneration adopts the current primary instead of keeping
                  // an old version's text-model binding. Media bindings remain.
                  modelId: ["text", "file"].includes(current.primaryOutputType) ? "" : current.modelId,
                  defaultParams: withoutTextModelDefaults(current.defaultParams, current.primaryOutputType),
                  bindings: current.bindings.map((binding) => ({
                    ...binding,
                    defaults: withoutTextModelDefaults(binding.defaults, current.primaryOutputType),
                  })),
                  manifest: JSON.stringify(result.manifest, null, 2),
                };
              });
            }}
          />
        ) : null}
        <fieldset disabled={manifestAiBusy || editorBlocked} style={{ border: 0, margin: "14px 0 0", minWidth: 0, padding: 0 }}>
          <FormGrid>
          <Field label="执行形态" required span={2}>
            <select
              value={form.kind}
              onChange={(event) => {
                const kind = event.target.value as SkillKind;
                if (form.kind === kind) return;
                if (
                  !isStarterManifest(
                    form.manifest,
                    form.kind,
                    form.primaryOutputType,
                  ) &&
                  !window.confirm("切换执行形态会重置当前自定义 Manifest 与输入 Schema，确认继续吗？")
                ) {
                  return;
                }
                setForm((current) => {
                  if (!current || current.kind === kind) return current;
                  const entryPoints = defaultAdminSkillEntryPoints(kind);
                  const primaryOutputType = kind === "tool" && current.primaryOutputType !== "text" && current.primaryOutputType !== "file"
                    ? "file"
                    : current.primaryOutputType;
                  return {
                    ...current,
                    kind,
                    entryPoints,
                    primaryOutputType,
                    modelId: kind === "tool" ? "" : current.modelId,
                    outputTypes: defaultAdminSkillOutputTypes(
                      kind,
                      primaryOutputType,
                    ),
                    bindings: constrainBindingRows(
                      kind,
                      entryPoints,
                      primaryOutputType,
                      current.bindings,
                    ),
                    inputSchema: JSON.stringify(
                      starterAdminSkillInputSchema(kind, primaryOutputType),
                      null,
                      2,
                    ),
                    manifest: JSON.stringify(
                      starterAdminSkillManifest(kind, primaryOutputType, kind === "tool" ? "" : current.modelId),
                      null,
                      2,
                    ),
                  };
                });
              }}
            >
              <option value="preset">预设 · 单次生成兼容链路</option>
              <option value="agent">智能技能 · 画布对话与跨节点执行</option>
              <option value="tool">技能工具 · 文件生成与内容分析</option>
            </select>
          </Field>
          <Field label="主输出" required span={2}>
            <select
              value={form.primaryOutputType}
              onChange={(event) => {
                const value = event.target.value as SkillOutputType;
                if (form.primaryOutputType === value) return;
                if (
                  !isStarterManifest(
                    form.manifest,
                    form.kind,
                    form.primaryOutputType,
                  ) &&
                  !window.confirm("切换主输出会重置当前自定义 Manifest、输入 Schema 和可能输出，确认继续吗？")
                ) {
                  return;
                }
                setForm((current) => {
                  if (!current || current.primaryOutputType === value) return current;
                  return {
                    ...current,
                    primaryOutputType: value,
                    modelId: "",
                    outputTypes: defaultAdminSkillOutputTypes(current.kind, value),
                    inputSchema: JSON.stringify(
                      starterAdminSkillInputSchema(current.kind, value),
                      null,
                      2,
                    ),
                    manifest: JSON.stringify(
                      starterAdminSkillManifest(current.kind, value),
                      null,
                      2,
                    ),
                    bindings: constrainBindingRows(
                      current.kind,
                      current.entryPoints,
                      value,
                      current.bindings,
                    ),
                  };
                });
              }}
            >
              {(form.kind === "tool" ? OUTPUT_TYPES.filter((type) => type === "text" || type === "file") : OUTPUT_TYPES).map((type) => (
                <option key={type} value={type}>{SKILL_OUTPUT_LABEL[type]}</option>
              ))}
            </select>
          </Field>
          <Field label="可用入口" required span={4} group>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {ENTRY_POINTS.map((entry) => (
                <label key={entry.key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={form.entryPoints.includes(entry.key)}
                    disabled={form.kind === "agent" || (form.kind === "preset" && entry.key === "api") || (form.kind === "tool" && entry.key !== "studio" && entry.key !== "api")}
                    onChange={() => toggleEntry(entry.key)}
                  />
                  {entry.label}
                </label>
              ))}
            </div>
          </Field>
          <Field
            label="可能输出"
            required
            span={4}
            group
            hint={form.kind === "preset"
              ? "预设技能始终只生成主输出这一种内容。"
              : form.kind === "tool"
                ? "技能工具可声明中间文本和最终文件；主输出必须包含在其中。"
                : "智能技能可以在画布中产生多种节点，主输出必须包含在其中。"}
          >
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {(form.kind === "tool" ? OUTPUT_TYPES.filter((type) => type === "text" || type === "file") : OUTPUT_TYPES).map((type) => (
                <label key={type} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={form.outputTypes.includes(type)}
                    disabled={form.kind === "preset" || form.primaryOutputType === type}
                    onChange={() => toggleOutput(type)}
                  />
                  {SKILL_OUTPUT_LABEL[type]}
                </label>
              ))}
            </div>
          </Field>
          <Field
            label="入口落点与默认参数"
            required
            span={4}
            group
            hint="每个入口可配置多个精确落点；* 是兜底落点。落点默认参数会覆盖版本默认参数中的同名键。"
          >
            <SkillBindingEditor
              entryPoints={form.entryPoints}
              primaryOutputType={form.primaryOutputType}
              bindings={form.bindings}
              errors={bindingErrors}
              onAdd={addBinding}
              onUpdate={updateBinding}
              onRemove={removeBinding}
            />
          </Field>
          <Field label="模型 ID" span={2} hint="可留空；文本和分析默认跟随模型管理中的主模型，手动指定或 Manifest 步骤配置优先。">
            <input
              value={form.modelId}
              onChange={(event) => {
                const modelId = event.target.value;
                setForm((current) => {
                  if (!current) return current;
                  const manifest = isStarterManifest(
                    current.manifest,
                    current.kind,
                    current.primaryOutputType,
                  )
                    ? JSON.stringify(
                        starterAdminSkillManifest(
                          current.kind,
                          current.primaryOutputType,
                          modelId,
                        ),
                        null,
                        2,
                      )
                    : current.manifest;
                  return { ...current, modelId, manifest };
                });
              }}
            />
          </Field>
          <Field label="保存后" span={2}>
            <select
              value={form.publish ? "publish" : "draft"}
              onChange={(event) => setForm({ ...form, publish: event.target.value === "publish" })}
            >
              <option value="draft">仅保存草稿</option>
              <option value="publish">立即发布</option>
            </select>
          </Field>
          <Field label="输入 Schema 模板" span={4} hint="选择常用输入结构；选择后仍可在下方继续编辑 JSON。">
            <select
              value={detectedInputPreset ?? "custom"}
              onChange={(event) => {
                if (event.target.value === "custom") return;
                const preset = event.target.value as SkillInputPreset;
                setForm({ ...form, inputSchema: JSON.stringify(skillInputSchemaFor(preset), null, 2) });
              }}
            >
              {SKILL_INPUT_PRESETS.map((preset) => <option key={preset.key} value={preset.key}>{preset.label}</option>)}
              <option value="custom">自定义 JSON</option>
            </select>
          </Field>
          <Field label="输入 Schema" required span={4} hint="支持 JSON Schema；所有入口共用同一份动态输入定义。">
            <textarea
              rows={7}
              value={form.inputSchema}
              spellCheck={false}
              style={{ fontFamily: "var(--mono)" }}
              onChange={(event) => setForm({ ...form, inputSchema: event.target.value })}
            />
          </Field>
          <Field label="Manifest" required span={4} hint="执行器只接受服务端注册的步骤和工具；不会执行任意代码或任意 URL。">
            <textarea
              rows={10}
              value={form.manifest}
              spellCheck={false}
              style={{ fontFamily: "var(--mono)" }}
              onChange={(event) => setForm({ ...form, manifest: event.target.value })}
            />
          </Field>
          <Field label="提示词 / 主说明" span={4} hint="无文件时须填写完整的标准 SKILL.md（含 name、description 元数据及正文）；导入包由主文件提供。">
            <textarea
              rows={6}
              value={form.promptTemplate}
              onChange={(event) => setForm({ ...form, promptTemplate: event.target.value })}
            />
          </Field>
          <Field label="默认参数" required span={4}>
            <textarea
              rows={4}
              value={form.defaultParams}
              spellCheck={false}
              style={{ fontFamily: "var(--mono)" }}
              onChange={(event) => setForm({ ...form, defaultParams: event.target.value })}
            />
          </Field>
          </FormGrid>
        </fieldset>
      </FormCard>

      <FormCard title="Skill 文件包">
        <fieldset disabled={manifestAiBusy || editorBlocked} style={{ border: 0, margin: 0, minWidth: 0, padding: 0 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" className="adm-btn ghost" onClick={() => fileInputRef.current?.click()}>
            {readingFiles ? <Loader2 className="adm-spin" aria-hidden size={14} /> : <Upload aria-hidden size={14} />}
            {readingFiles ? "格式校验中…" : form.files.length ? "更换文件包" : "选择 Skill 文件包"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".md,.txt,text/markdown,text/plain"
            multiple
            style={{ display: "none" }}
            onChange={(event) => void readFiles(event)}
          />
          <span className="muted" style={{ fontSize: 12 }}>
            {loading || copyingId ? "正在加载版本文件…" : loadError ? "文件包尚未加载，请先重试。" : form.files.length
              ? `${filesReplaced ? "已选择新文件包" : "已载入文件包"} · ${form.files.length} 个文件 · ${(packageBytes / 1024).toFixed(1)} KB`
              : "当前没有文件包；请选择含 name、description 元数据的 SKILL.md，也可直接编写上方提示词。"}
          </span>
        </div>
        {form.files.length > 0 && (
          <p className="muted" style={{ fontSize: 12, margin: "8px 0 0" }}>
            {filesReplaced ? "新文件包仅用于待保存的草稿，请核对提示词和 Manifest 中的文件引用。" : "不更换则沿用以上版本文件；更换不会修改已发布版本。"}
          </p>
        )}
        {form.files.length ? (
          <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
            {form.files.map((file) => (
              <label
                key={file.path}
                style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}
              >
                <input
                  type="radio"
                  disabled={!/(^|\/)SKILL\.md$/.test(file.path)}
                  name="skill-primary-file"
                  checked={form.primaryFilePath === file.path}
                  onChange={() => setForm({ ...form, primaryFilePath: file.path })}
                />
                <FileText aria-hidden size={14} />
                <span style={{ flex: 1 }}>{file.path}</span>
                <span className="muted">{(new Blob([file.content]).size / 1024).toFixed(1)} KB</span>
              </label>
            ))}
          </div>
        ) : null}
        </fieldset>
      </FormCard>
    </AdminModal>
  );
}
