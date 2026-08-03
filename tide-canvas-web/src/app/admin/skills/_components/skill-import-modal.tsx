"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, FolderOpen, Loader2, Upload } from "lucide-react";
import { AdminModal, Field, FormCard, FormGrid } from "@/components/admin";
import { toast } from "@/components/shared/toast";
import { adminSkillsApi } from "@/lib/admin-skills-api";
import type {
  AdminSkillFileInput,
  AdminSkillImportPackage,
} from "@/types/admin-skill";
import {
  SKILL_CATEGORIES,
  type SkillEntryPoint,
  type SkillKind,
} from "@/types/skill";
import {
  ADMIN_SKILL_ENTRY_POINTS,
  constrainAdminSkillEntryPoints,
  defaultAdminSkillBindings,
  defaultAdminSkillEntryPoints,
  defaultAdminSkillOutputTypes,
  starterAdminSkillManifest,
} from "@/lib/admin-skill-defaults";

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const MAX_PACKAGES = 50;

interface PreparedPackage {
  key: string;
  title: string;
  description: string;
  primaryFilePath: string;
  files: AdminSkillFileInput[];
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

async function prepareFiles(selected: File[]): Promise<PreparedPackage[]> {
  if (!selected.length) return [];
  let total = 0;
  const loaded: Array<{ path: string; content: string; mimeType: string; relative: boolean }> = [];
  for (const file of selected) {
    const relativePath = file.webkitRelativePath?.replaceAll("\\", "/") || "";
    const filePath = relativePath || file.name;
    const lower = filePath.toLowerCase();
    if (!lower.endsWith(".md") && !lower.endsWith(".txt")) continue;
    if (file.size <= 0 || file.size > MAX_FILE_BYTES) {
      throw new Error(`${filePath} 超过 2 MB 单文件限制`);
    }
    total += file.size;
    if (total > MAX_TOTAL_BYTES) throw new Error("本次导入文件超过 8 MB");
    loaded.push({
      path: filePath,
      content: await file.text(),
      mimeType: lower.endsWith(".md")
        ? "text/markdown; charset=utf-8"
        : "text/plain; charset=utf-8",
      relative: !!relativePath,
    });
  }
  if (!loaded.length) throw new Error("没有找到可导入的 .md 或 .txt 文件");

  // Files selected normally are independent skills. A directory selection is
  // one package rooted at its selected top-level folder and must have SKILL.md.
  const groups = new Map<string, typeof loaded>();
  for (const item of loaded) {
    const root = item.relative ? item.path.split("/")[0] : `file:${item.path}`;
    groups.set(root, [...(groups.get(root) ?? []), item]);
  }
  if (groups.size > MAX_PACKAGES) {
    throw new Error(`单次最多导入 ${MAX_PACKAGES} 个 Skill`);
  }

  return [...groups.entries()].map(([key, files]) => {
    const primary = files.find((item) => /(^|\/)skill\.md$/i.test(item.path)) ??
      (files.length === 1 ? files[0] : undefined);
    if (!primary) throw new Error(`${key} 是多文件目录，但没有 SKILL.md`);
    const fallback = primary.path.split("/").at(-1) || key.replace(/^file:/, "");
    return {
      key,
      title: inferTitle(primary.content, fallback),
      description: inferDescription(primary.content),
      primaryFilePath: primary.path,
      files: files.map(({ path, content, mimeType }) => ({ path, content, mimeType })),
    };
  });
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
  const [kind, setKind] = useState<SkillKind>("agent");
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

  useEffect(() => () => {
    readSeqRef.current += 1;
  }, []);

  const readSelection = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = [...(event.target.files ?? [])];
    event.target.value = "";
    if (!selected.length) return;
    const readSeq = ++readSeqRef.current;
    setReading(true);
    try {
      const prepared = await prepareFiles(selected);
      if (readSeq === readSeqRef.current) setPackages(prepared);
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
    setEntryPoints((current) => current.includes(entry)
      ? current.filter((item) => item !== entry)
      : [...current, entry]);
  };

  const save = async () => {
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
    const normalizedEntryPoints = constrainAdminSkillEntryPoints(kind, entryPoints);
    const skills: AdminSkillImportPackage[] = packages.map((pkg, index) => ({
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
      primaryOutputType: "text",
      outputTypes: defaultAdminSkillOutputTypes(kind, "text"),
      inputSchema: {
        type: "object",
        properties: {},
      },
      manifest: starterAdminSkillManifest(kind, "text"),
      defaultParams: {},
      bindings: defaultAdminSkillBindings(normalizedEntryPoints, "text"),
      primaryFilePath: pkg.primaryFilePath,
      files: pkg.files,
      publish: true,
    }));
    const res = await adminSkillsApi.importSkills(skills);
    if (!res.success) {
      toast.error(res.message || "Skill 导入失败");
      return false;
    }
    toast.success(`已导入 ${skills.length} 个 Skill，检查配置后再上架`);
    await onImported();
    setPackages([]);
    return true;
  };

  return (
    <AdminModal
      open={open}
      size="lg"
      title="导入 Skill 文件"
      subtitle="每个独立 .md/.txt 会创建一个 Skill；目录包以 SKILL.md 为主文件。"
      saveLabel="导入为下架技能"
      footNote="导入后已有可追溯的已发布 v1，但目录卡片保持下架，便于先检查运行配置。"
      onClose={onClose}
      onSave={save}
    >
      <FormCard title="文件">
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" className="adm-btn ghost" disabled={reading} onClick={() => fileInputRef.current?.click()}>
            {reading ? <Loader2 className="adm-spin" aria-hidden size={14} /> : <Upload aria-hidden size={14} />}
            选择多个文件
          </button>
          <button type="button" className="adm-btn ghost" disabled={reading} onClick={() => folderInputRef.current?.click()}>
            <FolderOpen aria-hidden size={14} /> 选择 Skill 目录
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".md,.txt,text/markdown,text/plain"
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
              ? `${packages.length} 个 Skill · ${(totalBytes / 1024).toFixed(1)} KB`
              : "支持单文件 2 MB、单次 8 MB。"}
          </span>
        </div>
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
                  onChange={(event) => setPackages((current) => current.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, title: event.target.value } : item,
                  ))}
                />
                <span className="muted" style={{ fontSize: 11 }}>
                  {pkg.files.length} 个文件
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </FormCard>

      <FormCard title="导入策略">
        <FormGrid>
          <Field label="执行形态" required span={2} hint="预设技能单次生成一种内容；智能技能在画布中通过对话跨节点执行。">
            <select
              value={kind}
              onChange={(event) => {
                const nextKind = event.target.value as SkillKind;
                setKind(nextKind);
                setEntryPoints(defaultAdminSkillEntryPoints(nextKind));
              }}
            >
              <option value="preset">预设技能</option>
              <option value="agent">智能技能</option>
            </select>
          </Field>
          <Field label="分类" span={2}>
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              {SKILL_CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </Field>
          <Field label="作者署名" span={2}>
            <input value={authorName} maxLength={64} onChange={(event) => setAuthorName(event.target.value)} />
          </Field>
          <Field label="主输出" span={2} hint="批量导入先按文本产物落库，可在版本配置中改成多模态。">
            <input value="文本" readOnly />
          </Field>
          <Field label="可用入口" required span={4} group>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {ADMIN_SKILL_ENTRY_POINTS.map((entry) => (
                <label key={entry.key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={entryPoints.includes(entry.key)}
                    disabled={kind === "agent"}
                    onChange={() => toggleEntry(entry.key)}
                  />
                  {entry.label}
                </label>
              ))}
            </div>
          </Field>
        </FormGrid>
      </FormCard>
    </AdminModal>
  );
}
