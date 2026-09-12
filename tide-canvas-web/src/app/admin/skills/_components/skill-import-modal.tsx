"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, FolderOpen, Loader2, Upload } from "lucide-react";
import { AdminAlert, AdminModal, Field, FormCard, FormGrid } from "@/components/admin";
import { toast } from "@/components/shared/toast";
import { adminSkillsApi } from "@/lib/admin-skills-api";
import type {
  AdminSkillFileInput,
  AdminSkillImportPackage,
  AdminSkillImportValidationVO,
} from "@/types/admin-skill";
import {
  SKILL_CATEGORIES,
  SKILL_OUTPUT_LABEL,
  type SkillEntryPoint,
  type SkillKind,
  type SkillOutputType,
} from "@/types/skill";
import {
  ADMIN_SKILL_ENTRY_POINTS,
  constrainAdminSkillEntryPoints,
  defaultAdminSkillBindings,
  defaultAdminSkillEntryPoints,
  defaultAdminSkillOutputTypes,
  starterAdminSkillManifest,
} from "@/lib/admin-skill-defaults";
import { SkillManifestAiControl, type SkillManifestDraftRequest } from "./skill-manifest-ai-control";
import { SKILL_INPUT_PRESETS, skillInputSchemaFor, type SkillInputPreset } from "./skill-input-schema-presets";

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_PRIMARY_FILE_BYTES = 1024 * 1024;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 16 * 1024 * 1024;
const MAX_PACKAGES = 50;
const TOOL_TEXT_INPUT_PRESETS = new Set<SkillInputPreset>(["image", "images", "keyframes", "video", "audio", "webpage"]);

function importInputPresets(kind: SkillKind, output: SkillOutputType) {
  if (kind === "preset") {
    const allowed = output === "image"
      ? new Set<SkillInputPreset>(["text", "image", "images"])
      : output === "video"
        ? new Set<SkillInputPreset>(["text", "image"])
        : new Set<SkillInputPreset>(["text"]);
    return SKILL_INPUT_PRESETS.filter((preset) => allowed.has(preset.key));
  }
  if (kind === "tool" && output === "text") {
    return SKILL_INPUT_PRESETS.filter((preset) => TOOL_TEXT_INPUT_PRESETS.has(preset.key));
  }
  return SKILL_INPUT_PRESETS;
}

function fallbackImportInputPreset(kind: SkillKind, output: SkillOutputType): SkillInputPreset {
  return kind === "tool" && output === "text" ? "webpage" : "text";
}

interface PreparedPackage {
  key: string;
  title: string;
  description: string;
  primaryFilePath: string;
  files: AdminSkillFileInput[];
  ignoredFiles?: number;
  manifestText?: string;
}

function failedImportValidation(title: string, message: string): AdminSkillImportValidationVO {
  return { valid: false, items: [{ index: -1, title, valid: false, errors: [message] }] };
}

function packagePrimaryContent(pkg: PreparedPackage): string {
  return pkg.files.find((file) => file.path.toLowerCase() === pkg.primaryFilePath.toLowerCase())?.content ?? "";
}

function importManifestSignature(
  pkg: PreparedPackage,
  kind: SkillKind,
  inputPreset: SkillInputPreset,
  primaryOutputType: SkillOutputType,
): string {
  return JSON.stringify({
    key: pkg.key,
    kind,
    inputPreset,
    primaryOutputType,
    outputTypes: defaultAdminSkillOutputTypes(kind, primaryOutputType),
    primaryFilePath: pkg.primaryFilePath,
    primaryContent: packagePrimaryContent(pkg),
  });
}

function manifestForImport(pkg: PreparedPackage, kind: SkillKind, primaryOutputType: SkillOutputType): Record<string, unknown> {
  if (kind === "preset") return starterAdminSkillManifest(kind, primaryOutputType);
  if (!pkg.manifestText?.trim()) throw new Error(`请先为“${pkg.title}”生成并确认 Manifest 草稿`);
  try {
    const parsed: unknown = JSON.parse(pkg.manifestText);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("shape");
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(`“${pkg.title}”的 Manifest 必须是合法 JSON 对象`);
  }
}

function truncateRunes(value: string, length: number): string {
  return [...value].slice(0, length).join("");
}

function stripFileSuffix(name: string): string {
  return name.replace(/\.(?:md|txt)$/i, "").replace(/\s*\(\d+\)\s*$/, "").trim();
}

function frontMatterValue(content: string, key: string): string {
  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return "";
  const line = match[1]
    .split(/\r?\n/)
    .find((item) => item.trim().toLowerCase().startsWith(`${key.toLowerCase()}:`));
  return line?.slice(line.indexOf(":") + 1).trim().replace(/^['"]|['"]$/g, "") || "";
}

function inferTitle(content: string, fallback: string): string {
  const frontMatter = frontMatterValue(content, "name");
  if (frontMatter) return truncateRunes(frontMatter, 64);
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return truncateRunes(heading, 64);
  const first = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && line !== "---" && !/^[=━─═-]{4,}$/.test(line));
  return truncateRunes(first || stripFileSuffix(fallback) || "未命名 Skill", 64);
}

function inferDescription(content: string): string {
  const frontMatter = frontMatterValue(content, "description");
  if (frontMatter) return truncateRunes(frontMatter, 255);
  const lines = content
    .replace(/^---\s*\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .filter((line) => line && !/^[=━─═-]{4,}$/.test(line));
  return truncateRunes(lines.slice(1, 3).join(" "), 255);
}

async function readUTF8File(file: File, path: string): Promise<string> {
  let bytes: ArrayBuffer;
  try {
    bytes = await file.arrayBuffer();
  } catch {
    throw new Error(`${path} 无法读取，请重新选择文件`);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
  } catch {
    throw new Error(`${path} 不是有效的 UTF-8 文本`);
  }
}

async function prepareFiles(selected: File[]): Promise<PreparedPackage[]> {
  if (!selected.length) return [];
  let total = 0;
  const loaded: Array<{ path: string; content: string; mimeType: string; relative: boolean }> = [];
  const archives: File[] = [];
  for (const file of selected) {
    const relativePath = file.webkitRelativePath?.replaceAll("\\", "/") || "";
    const filePath = relativePath || file.name;
    const lower = filePath.toLowerCase();
    if (!relativePath && (lower.endsWith(".zip") || lower.endsWith(".skill"))) {
      if (file.size <= 0 || file.size > MAX_ARCHIVE_BYTES) {
        throw new Error(`${file.name} 必须在 16 MB 以内`);
      }
      archives.push(file);
      continue;
    }
    if (!lower.endsWith(".md") && !lower.endsWith(".txt")) continue;
    if (file.size <= 0 || file.size > MAX_FILE_BYTES) {
      throw new Error(`${filePath} 超过 2 MB 单文件限制`);
    }
    total += file.size;
    if (total > MAX_TOTAL_BYTES) throw new Error("本次导入文件超过 8 MB");
    const content = await readUTF8File(file, filePath);
    loaded.push({
      path: filePath,
      content,
      mimeType: lower.endsWith(".md")
        ? "text/markdown; charset=utf-8"
        : "text/plain; charset=utf-8",
      relative: !!relativePath,
    });
  }
  // Files selected normally are independent skills. A directory selection is
  // one package rooted at its selected top-level folder and must have SKILL.md.
  const groups = new Map<string, typeof loaded>();
  for (const [itemIndex, item] of loaded.entries()) {
    const root = item.relative ? item.path.split("/")[0] : `file:${itemIndex}:${item.path}`;
    groups.set(root, [...(groups.get(root) ?? []), item]);
  }
  const prepared: PreparedPackage[] = [...groups.entries()].map(([key, files]) => {
    const primary = files.find((item) => /(^|\/)skill\.md$/i.test(item.path)) ??
      (files.length === 1 ? files[0] : undefined);
    if (!primary) throw new Error(`${key} 是多文件目录，但没有 SKILL.md`);
    if (new Blob([primary.content]).size > MAX_PRIMARY_FILE_BYTES) {
      throw new Error(`${primary.path} 超过 1 MB 主文件执行上限`);
    }
    const fallback = primary.path.split("/").at(-1) || key.replace(/^file:/, "");
    return {
      key,
      title: inferTitle(primary.content, fallback),
      description: inferDescription(primary.content),
      primaryFilePath: primary.path,
      files: files.map(({ path, content, mimeType }) => ({ path, content, mimeType })),
    };
  });

  // ZIP/.skill archives are inspected server-side. No executable/config file
  // is returned to the browser, and the final import still uses the existing
  // immutable-version JSON contract below.
  for (const [archiveIndex, archive] of archives.entries()) {
    const response = await adminSkillsApi.previewArchive(archive);
    if (!response.success || !response.data) {
      throw new Error(response.message || `${archive.name} 解析失败`);
    }
    const preview = response.data;
    preview.packages.forEach((pkg, index) => {
      const primary = pkg.files.find((file) => file.path.toLowerCase() === pkg.primaryFilePath.toLowerCase());
      if (!primary) throw new Error(`${archive.name} 中的 ${pkg.root} 缺少主文件`);
      prepared.push({
        key: `archive:${archiveIndex}:${archive.name}:${pkg.root}:${index}`,
        title: inferTitle(primary.content, pkg.root || archive.name.replace(/\.(?:zip|skill)$/i, "")),
        description: inferDescription(primary.content),
        primaryFilePath: pkg.primaryFilePath,
        files: pkg.files,
        ignoredFiles: index === 0 ? preview.ignoredFiles : 0,
      });
    });
  }

  if (!prepared.length) throw new Error("没有找到可导入的 SKILL.md、.md 或 .txt 文件");
  if (prepared.length > MAX_PACKAGES) throw new Error(`单次最多导入 ${MAX_PACKAGES} 个 Skill`);
  const preparedBytes = prepared.reduce(
    (sum, pkg) => sum + pkg.files.reduce((fileSum, file) => fileSum + new Blob([file.content]).size, 0),
    0,
  );
  if (preparedBytes > MAX_TOTAL_BYTES) throw new Error("本次导入的 Skill 文本文件合计超过 8 MB");
  return prepared;
}

export function SkillImportModal({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: () => void | Promise<void>;
}) {
  const [packages, setPackages] = useState<PreparedPackage[]>([]);
  const [reading, setReading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [manifestBusy, setManifestBusy] = useState(false);
  const [validation, setValidation] = useState<AdminSkillImportValidationVO | null>(null);
  const [kind, setKind] = useState<SkillKind>("agent");
  const [inputPreset, setInputPreset] = useState<SkillInputPreset>("text");
  const [primaryOutputType, setPrimaryOutputType] = useState<SkillOutputType>("text");
  const [category, setCategory] = useState<string>(SKILL_CATEGORIES[0]);
  const [authorName, setAuthorName] = useState("官方");
  const [entryPoints, setEntryPoints] = useState<SkillEntryPoint[]>(
    defaultAdminSkillEntryPoints("agent"),
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const readSeqRef = useRef(0);
  const directoryProps = { webkitdirectory: "", directory: "" } as React.InputHTMLAttributes<HTMLInputElement>;

  const totalBytes = useMemo(
    () => packages.reduce(
      (sum, pkg) => sum + pkg.files.reduce((fileSum, file) => fileSum + new Blob([file.content]).size, 0),
      0,
    ),
    [packages],
  );
  const ignoredFiles = useMemo(
    () => packages.reduce((sum, pkg) => sum + (pkg.ignoredFiles ?? 0), 0),
    [packages],
  );
  const visibleInputPresets = importInputPresets(kind, primaryOutputType);

  useEffect(() => () => {
    readSeqRef.current += 1;
  }, []);

  const readSelection = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = [...(event.target.files ?? [])];
    event.target.value = "";
    if (!selected.length || submitting || manifestBusy) return;
    const readSeq = ++readSeqRef.current;
    setReading(true);
    try {
      const prepared = await prepareFiles(selected);
      if (readSeq === readSeqRef.current) {
        setPackages(prepared);
        setValidation(null);
      }
    } catch (error) {
      if (readSeq === readSeqRef.current) {
        toast.error(error instanceof Error ? error.message : "文件读取失败");
      }
    } finally {
      if (readSeq === readSeqRef.current) setReading(false);
    }
  };

  const toggleEntry = (entry: SkillEntryPoint) => {
    if (kind === "agent") return;
    if (kind === "preset" && entry === "api") return;
    if (kind === "tool" && entry !== "studio" && entry !== "api") return;
    setEntryPoints((current) => current.includes(entry)
      ? current.filter((item) => item !== entry)
      : [...current, entry]);
    setValidation(null);
  };

  const clearManifestDrafts = () => {
    setPackages((current) => current.map((pkg) => ({ ...pkg, manifestText: undefined })));
    setValidation(null);
  };

  const loadManifestRequests = async (): Promise<SkillManifestDraftRequest[]> => {
    if (!packages.length) throw new Error("请先选择 Skill 文件或目录");
    const inputSchema = skillInputSchemaFor(inputPreset) as Record<string, unknown>;
    return packages.filter((pkg) => !pkg.manifestText?.trim()).map((pkg) => ({
      key: pkg.key,
      title: pkg.title,
      source: packagePrimaryContent(pkg),
      kind,
      primaryOutputType,
      outputTypes: defaultAdminSkillOutputTypes(kind, primaryOutputType),
      inputSchema,
      signature: importManifestSignature(pkg, kind, inputPreset, primaryOutputType),
    }));
  };

  const buildImportPackages = (): AdminSkillImportPackage[] => {
    const normalizedEntryPoints = constrainAdminSkillEntryPoints(kind, entryPoints);
    const inputSchema = skillInputSchemaFor(inputPreset);
    return packages.map((pkg, index) => ({
      title: truncateRunes(pkg.title.trim(), 64),
      description: pkg.description.trim(),
      category,
      authorName: authorName.trim(),
      // The immutable v1 is published, but the catalog card stays offline until
      // an administrator reviews it and explicitly toggles it online.
      status: 0,
      sortOrder: index,
      kind,
      entryPoints: normalizedEntryPoints,
      primaryOutputType,
      outputTypes: defaultAdminSkillOutputTypes(kind, primaryOutputType),
      inputSchema,
      manifest: manifestForImport(pkg, kind, primaryOutputType),
      defaultParams: {},
      bindings: defaultAdminSkillBindings(normalizedEntryPoints, primaryOutputType),
      primaryFilePath: pkg.primaryFilePath,
      files: pkg.files,
      publish: true,
    }));
  };

  const save = async () => {
    if (submitting) return false;
    if (manifestBusy) {
      toast.info("Manifest 草稿仍在生成，请等待完成或先停止生成");
      return false;
    }
    if (reading) {
      toast.info("Skill 文件仍在解析，请稍候");
      return false;
    }
    if (!packages.length) {
      toast.error("请先选择 Skill 文件或目录");
      return false;
    }
    if (!entryPoints.length) {
      toast.error("请至少选择一个使用入口");
      return false;
    }
    if (packages.some((pkg) => !pkg.title.trim())) {
      toast.error("Skill 名称不能为空");
      return false;
    }
    let skills: AdminSkillImportPackage[];
    try {
      skills = buildImportPackages();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Manifest 配置无效");
      return false;
    }
    setSubmitting(true);
    try {
      const checked = await adminSkillsApi.validateImport(skills);
      if (!checked.success || !checked.data) {
        const message = checked.message || "Skill 导入校验失败";
        setValidation(failedImportValidation("校验服务", message));
        toast.error(message);
        return false;
      }
      setValidation(checked.data);
      if (!checked.data.valid) {
        const firstFailure = checked.data.items.find((item) => !item.valid);
        toast.error(firstFailure?.errors[0] || "Skill 包未通过导入校验");
        return false;
      }
      const res = await adminSkillsApi.importSkills(skills);
      if (!res.success) {
        const message = res.message || "Skill 导入失败";
        setValidation(failedImportValidation("导入写入", message));
        toast.error(message);
        return false;
      }
      toast.success(`已导入 ${skills.length} 个 Skill，检查配置后再上架`);
      try {
        await onImported();
      } catch {
        toast.info("Skill 已导入，但列表刷新失败，请手动刷新页面");
      }
      setPackages([]);
      return true;
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AdminModal
      open={open}
      size="lg"
      title="导入 Skill 文件"
      subtitle="选择输入 Schema 和主输出后，由文本模型生成可确认的 Manifest 草稿。"
      saveLabel="校验并导入"
      footNote="AI 不会改写 SKILL.md 或填写模型 ID；最终仍需通过服务端完整预检。"
      closeable={!manifestBusy}
      onClose={onClose}
      onSave={save}
    >
      <fieldset
        disabled={reading || submitting}
        aria-busy={reading || submitting}
        style={{ border: 0, margin: 0, minWidth: 0, padding: 0 }}
      >
        <FormCard title="文件">
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" className="adm-btn ghost" disabled={reading || manifestBusy} onClick={() => fileInputRef.current?.click()}>
            {reading ? <Loader2 className="adm-spin" aria-hidden size={14} /> : <Upload aria-hidden size={14} />}
            选择文件或 ZIP
          </button>
          <button type="button" className="adm-btn ghost" disabled={reading || manifestBusy} onClick={() => folderInputRef.current?.click()}>
            <FolderOpen aria-hidden size={14} /> 选择 Skill 目录
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".md,.txt,.zip,.skill,text/markdown,text/plain,application/zip"
            multiple
            style={{ display: "none" }}
            onChange={(event) => void readSelection(event)}
          />
          <input
            {...directoryProps}
            ref={folderInputRef}
            type="file"
            accept=".md,.txt,text/markdown,text/plain"
            multiple
            style={{ display: "none" }}
            onChange={(event) => void readSelection(event)}
          />
          <span className="muted" style={{ fontSize: 12 }}>
            {packages.length
              ? `${packages.length} 个 Skill · ${(totalBytes / 1024).toFixed(1)} KB${ignoredFiles ? ` · 已忽略 ${ignoredFiles} 个包外或非文本文件` : ""}`
              : "ZIP 最大 16 MB；主文件/展开上下文 1 MB，参考文件 2 MB，文本合计 8 MB。"}
          </span>
        </div>
        <p className="muted" style={{ margin: "8px 0 0", fontSize: 12, lineHeight: 1.6 }}>
          包内 .md/.txt 会作为固定参考上下文随 SKILL.md 使用；脚本、YAML 和二进制文件不会导入或执行。
        </p>
        {ignoredFiles ? (
          <div style={{ marginTop: 12 }}>
            <AdminAlert tone="warning" title={`有 ${ignoredFiles} 个文件不会导入`}>
              如果该 Skill 必须依赖这些脚本、配置或二进制资源，其对应能力在 FlowingLight 中不可用；纯文本指令和参考资料不受影响。
            </AdminAlert>
          </div>
        ) : null}
        {packages.length ? (
          <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
            {packages.map((pkg, index) => (
              <div
                key={pkg.key}
                style={{
                  display: "grid",
                  gridTemplateColumns: "20px minmax(0,1fr) auto",
                  gap: 8,
                  alignItems: "center",
                }}
              >
                <FileText aria-hidden size={14} />
                <input
                  aria-label={`第 ${index + 1} 个 Skill 名称`}
                  value={pkg.title}
                  maxLength={64}
                  disabled={manifestBusy}
                  onChange={(event) => {
                    setPackages((current) => current.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, title: event.target.value } : item,
                    ));
                    setValidation(null);
                  }}
                />
                <span className="muted" style={{ fontSize: 11 }}>
                  {pkg.files.length} 个文本文件
                </span>
              </div>
            ))}
          </div>
        ) : null}
        </FormCard>

        <FormCard title="导入策略">
        {validation && !validation.valid ? (
          <div style={{ marginBottom: 14 }}>
            <AdminAlert tone="error" title="导入校验未通过">
              <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                {validation.items.filter((item) => !item.valid).map((item) => (
                  <li key={`${item.index}:${item.title}`} style={{ marginTop: 4 }}>
                    <span style={{ color: "var(--text)", fontWeight: 600 }}>{item.title}：</span>
                    {item.errors.join("；")}
                  </li>
                ))}
              </ul>
              <div style={{ marginTop: 6 }}>未写入任何 Skill，请根据以上提示处理后重试。</div>
            </AdminAlert>
          </div>
        ) : null}
        <FormGrid>
          <Field label="执行形态" required span={2} hint="预设技能单次生成；智能技能在画布执行；技能工具在创作台或 API 执行。">
            <select
              value={kind}
              disabled={manifestBusy}
              onChange={(event) => {
                const nextKind = event.target.value as SkillKind;
                const nextPrimaryOutput = nextKind === "tool" && primaryOutputType !== "text" && primaryOutputType !== "file"
                  ? "file"
                  : primaryOutputType;
                const nextInputPresets = importInputPresets(nextKind, nextPrimaryOutput);
                setKind(nextKind);
                setEntryPoints(defaultAdminSkillEntryPoints(nextKind));
                setPrimaryOutputType(nextPrimaryOutput);
                if (!nextInputPresets.some((preset) => preset.key === inputPreset)) {
                  setInputPreset(fallbackImportInputPreset(nextKind, nextPrimaryOutput));
                }
                clearManifestDrafts();
              }}
            >
              <option value="preset">预设技能</option>
              <option value="agent">智能技能</option>
              <option value="tool">技能工具</option>
            </select>
          </Field>
          <Field label="输入 Schema" required span={2} hint="由管理员选择输入类型，AI 不会修改。">
            <select
              value={inputPreset}
              disabled={manifestBusy}
              onChange={(event) => {
                setInputPreset(event.target.value as SkillInputPreset);
                clearManifestDrafts();
              }}
            >
              {visibleInputPresets.map((preset) => <option key={preset.key} value={preset.key}>{preset.label}</option>)}
            </select>
            <small className="muted" style={{ display: "block", marginTop: 5, fontSize: 11 }}>
              {SKILL_INPUT_PRESETS.find((preset) => preset.key === inputPreset)?.description}
            </small>
          </Field>
          <Field label="分类" span={2}>
            <select value={category} onChange={(event) => {
              setCategory(event.target.value);
              setValidation(null);
            }}>
              {SKILL_CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </Field>
          <Field label="作者署名" span={2}>
            <input value={authorName} maxLength={64} onChange={(event) => {
              setAuthorName(event.target.value);
              setValidation(null);
            }} />
          </Field>
          <Field label="主输出" required span={2} hint="由管理员确定最终产物类型，AI 只能据此编排步骤。">
            <select
              value={primaryOutputType}
              disabled={manifestBusy}
              onChange={(event) => {
                const nextOutput = event.target.value as SkillOutputType;
                const nextInputPresets = importInputPresets(kind, nextOutput);
                setPrimaryOutputType(nextOutput);
                if (!nextInputPresets.some((preset) => preset.key === inputPreset)) {
                  setInputPreset(fallbackImportInputPreset(kind, nextOutput));
                }
                clearManifestDrafts();
              }}
            >
              {(kind === "tool"
                ? (["text", "file"] as SkillOutputType[])
                : (["text", "image", "video", "audio", "file"] as SkillOutputType[])
              ).map((output) => <option key={output} value={output}>{SKILL_OUTPUT_LABEL[output]}</option>)}
            </select>
          </Field>
          <Field label="可用入口" required span={4} group>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {ADMIN_SKILL_ENTRY_POINTS.map((entry) => (
                <label key={entry.key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={entryPoints.includes(entry.key)}
                    disabled={kind === "agent" || (kind === "preset" && entry.key === "api") || (kind === "tool" && entry.key !== "studio" && entry.key !== "api")}
                    onChange={() => toggleEntry(entry.key)}
                  />
                  {entry.label}
                </label>
              ))}
            </div>
          </Field>
        </FormGrid>
        <div style={{ marginTop: 14 }}>
          {kind === "preset" ? (
            <AdminAlert tone="info" title="预设技能使用固定 Manifest">
              预设技能没有多步骤编排，系统会根据主输出生成最小运行配置，无需调用文本模型。
            </AdminAlert>
          ) : (
            <SkillManifestAiControl
              key={`${kind}:${inputPreset}:${primaryOutputType}:${packages.map((pkg) => pkg.key).join("|")}`}
              disabled={reading || submitting || !packages.length || packages.every((pkg) => !!pkg.manifestText?.trim())}
              loadRequests={loadManifestRequests}
              onBusyChange={setManifestBusy}
              onGenerated={(results) => {
                setPackages((current) => current.map((pkg) => {
                  const result = results.find((item) => item.key === pkg.key);
                  if (!result || result.signature !== importManifestSignature(pkg, kind, inputPreset, primaryOutputType)) return pkg;
                  return { ...pkg, manifestText: JSON.stringify(result.manifest, null, 2) };
                }));
                setValidation(null);
              }}
            />
          )}
        </div>
        {kind !== "preset" && packages.some((pkg) => pkg.manifestText) ? (
          <div className="adm-skill-manifest-drafts">
            {packages.filter((pkg) => pkg.manifestText).map((pkg) => (
              <details key={pkg.key}>
                <summary>{pkg.title} · Manifest 草稿</summary>
                <textarea
                  rows={10}
                  value={pkg.manifestText}
                  aria-label={`${pkg.title} Manifest 草稿`}
                  spellCheck={false}
                  disabled={manifestBusy}
                  onChange={(event) => {
                    const manifestText = event.target.value;
                    setPackages((current) => current.map((item) => item.key === pkg.key ? { ...item, manifestText } : item));
                    setValidation(null);
                  }}
                />
              </details>
            ))}
          </div>
        ) : null}
        </FormCard>
      </fieldset>
    </AdminModal>
  );
}
