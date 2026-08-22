"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Copy, FileText, Loader2, Plus, Trash2, Upload } from "lucide-react";
import {
  AdminEmptyState,
  AdminModal,
  Field,
  FormCard,
  FormGrid,
  StatusPill,
} from "@/components/admin";
import { toast } from "@/components/shared/toast";
import { adminSkillsApi } from "@/lib/admin-skills-api";
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
  const [publishingId, setPublishingId] = useState("");
  const [copyingId, setCopyingId] = useState("");
  const [form, setForm] = useState<VersionForm | null>(null);
  const [bindingErrors, setBindingErrors] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Loading the live bindings happens independently from version history. If
  // the admin copies/edits a version before that request resolves, its stale
  // response must not overwrite the chosen immutable snapshot.
  const bindingHydrationRef = useRef(0);
  const modalGenerationRef = useRef(0);
  const copySeqRef = useRef(0);
  const fileReadSeqRef = useRef(0);
  const publishSeqRef = useRef(0);

  const load = useCallback(async (generation = modalGenerationRef.current) => {
    if (!skill) return;
    setLoading(true);
    const res = await adminSkillsApi.listVersions(skill.id);
    if (generation !== modalGenerationRef.current) return;
    setLoading(false);
    if (res.success && res.data) setVersions(res.data);
    else toast.error(res.message || "版本加载失败");
  }, [skill]);

  useEffect(() => {
    if (!open || !skill) return;
    let cancelled = false;
    const generation = ++modalGenerationRef.current;
    const hydration = ++bindingHydrationRef.current;
    const frame = requestAnimationFrame(() => {
      setVersions([]);
      setLoading(false);
      setPublishingId("");
      setCopyingId("");
      setForm(emptyForm(skill));
      setBindingErrors({});
      void load(generation);
      void adminSkillsApi.listBindings(skill.id).then((res) => {
        if (
          cancelled ||
          hydration !== bindingHydrationRef.current ||
          !res.success ||
          !res.data
        ) return;
        setForm((current) => current && ({
          ...current,
          bindings: constrainBindingRows(
            current.kind,
            current.entryPoints,
            current.primaryOutputType,
            bindingRows(res.data, "live"),
          ),
        }));
      });
    });
    return () => {
      cancelled = true;
      modalGenerationRef.current += 1;
      bindingHydrationRef.current += 1;
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

  const toggleEntry = (key: SkillEntryPoint) => {
    if (form.kind === "agent") return;
    if (form.kind === "preset" && key === "api") return;
    if (form.kind === "tool" && key !== "studio" && key !== "api") return;
    bindingHydrationRef.current += 1;
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
    bindingHydrationRef.current += 1;
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
    bindingHydrationRef.current += 1;
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
    bindingHydrationRef.current += 1;
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
    const generation = modalGenerationRef.current;
    const readSeq = ++fileReadSeqRef.current;
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
      const content = await file.text();
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
    const skillMd = next.find((file) => /(^|\/)skill\.md$/i.test(file.path));
    setForm((current) => current && ({
      ...current,
      files: next,
      primaryFilePath: skillMd?.path || (next.length === 1 ? next[0].path : ""),
    }));
  };

  const copyVersion = async (summary: AdminSkillVersionVO) => {
    if (copyingId) return;
    const generation = modalGenerationRef.current;
    const copySeq = ++copySeqRef.current;
    bindingHydrationRef.current += 1;
    setCopyingId(summary.id);
    const detail = await adminSkillsApi.getVersion(skill.id, summary.id);
    if (generation !== modalGenerationRef.current || copySeq !== copySeqRef.current) return;
    setCopyingId("");
    if (!detail.success || !detail.data) {
      toast.error(detail.message || "版本详情加载失败");
      return;
    }
    const version = detail.data;
    const parsedEntryPoints = parseAdminStringList<SkillEntryPoint>(version.entryPoints);
    const entryPoints = constrainAdminSkillEntryPoints(version.kind, parsedEntryPoints);
    const outputTypes = parseAdminStringList<SkillOutputType>(version.outputTypes);
    const versionBindings = parseAdminBindings(version.bindings);
    const sourceBindings = versionBindings.length
      ? bindingRows(versionBindings, `version-${version.id}`)
      : form.bindings.map((binding) => ({
          ...binding,
          key: bindingRowKey(`version-${version.id}-fallback`),
        }));
    const stringify = (value: unknown) =>
      typeof value === "string"
        ? (() => {
            try {
              return JSON.stringify(JSON.parse(value), null, 2);
            } catch {
              return value;
            }
          })()
        : JSON.stringify(value ?? {}, null, 2);
    setBindingErrors({});
    setForm({
      kind: version.kind,
      entryPoints,
      primaryOutputType: version.primaryOutputType,
      outputTypes: version.kind === "preset"
        ? [version.primaryOutputType]
        : outputTypes.length ? outputTypes : [version.primaryOutputType],
      inputSchema: stringify(version.inputSchema),
      manifest: stringify(version.manifest),
      promptTemplate: version.promptTemplate || "",
      modelId: version.modelId || "",
      defaultParams: stringify(version.defaultParams),
      primaryFilePath: version.primaryFilePath || "",
      files: (version.files ?? []).flatMap((file) => file.content === undefined ? [] : [{
        path: file.path,
        content: file.content,
        mimeType: file.mimeType,
      }]),
      publish: false,
      bindings: constrainBindingRows(
        version.kind,
        entryPoints,
        version.primaryOutputType,
        sourceBindings,
      ),
    });
    toast.info(`已复制 v${version.version} 配置和文件，请检查后创建新版本`);
  };

  const save = async () => {
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
    if (publishingId) return;
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
      onClose={onClose}
      onSave={save}
    >
      <FormCard title="版本历史">
        {loading ? (
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
                    disabled={!!copyingId}
                    onClick={() => void copyVersion(version)}
                  >
                    {copyingId === version.id
                      ? <Loader2 className="adm-spin" aria-hidden size={13} />
                      : <Copy aria-hidden size={13} />}
                    复制配置
                  </button>
                  {version.status !== "published" ? (
                    <button
                      type="button"
                      className="adm-btn ghost"
                      disabled={!!publishingId}
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
          <Field label="模型 ID" span={2} hint="可留空，由 Manifest 步骤或系统默认模型决定。">
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
          <Field label="提示词 / 主说明" span={4} hint="无文件时必填；导入文件包时可以由主文件提供。">
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
      </FormCard>

      <FormCard title="Skill 文件包">
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" className="adm-btn ghost" onClick={() => fileInputRef.current?.click()}>
            <Upload aria-hidden size={14} /> 选择 .md / .txt
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
            {form.files.length
              ? `${form.files.length} 个文件 · ${(packageBytes / 1024).toFixed(1)} KB`
              : "单文件可直接导入；目录包需包含 SKILL.md。"}
          </span>
        </div>
        {form.files.length ? (
          <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
            {form.files.map((file) => (
              <label
                key={file.path}
                style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}
              >
                <input
                  type="radio"
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
      </FormCard>
    </AdminModal>
  );
}
