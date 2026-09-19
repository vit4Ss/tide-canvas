import type { AdminSkillFileValidationVO, AdminSkillFileInput } from "@/types/admin-skill";
import type { Result } from "@/types/api";

/** Validate the preflight itself as well: a missing/partial response cannot
 * admit an unvalidated package or start a paid Manifest generation. */
export function checkedSkillFileMetadata(result: Result<AdminSkillFileValidationVO>, count: number): Array<{ name: string; description: string }> {
  if (result?.success !== true || !result.data) throw new Error(result?.message || "Skill 格式校验服务暂不可用，请重试");
  const { valid, items } = result.data;
  if (!Number.isSafeInteger(count) || count < 1 || !Array.isArray(items) || items.length !== count
    || items.some((item, index) => !item || typeof item !== "object" || item.index !== index || typeof item.valid !== "boolean")) {
    throw new Error("Skill 格式校验结果不完整，请重试");
  }
  if (valid !== true || items.some((item) => item.valid !== true)) {
    throw new Error(items.filter((item) => item.valid !== true).map((item) => {
      const errors = Array.isArray(item.errors) ? item.errors.filter((error) => typeof error === "string").join("；") : "";
      return `第 ${item.index + 1} 个 Skill：${errors || "格式不符合规范"}`;
    }).join("\n") || "Skill 格式不符合规范");
  }
  return items.map((item) => {
    if (typeof item.name !== "string" || !item.name.trim() || typeof item.description !== "string" || !item.description.trim()) {
      throw new Error("Skill 格式校验结果缺少 name 或 description，请重试");
    }
    return { name: item.name, description: item.description };
  });
}

/** Both the first import and a version's replacement must reject undecodable
 * bytes; File.text() would silently turn them into replacement characters. */
export async function readUTF8File(file: File, path: string): Promise<string> {
  let bytes: ArrayBuffer;
  try { bytes = await file.arrayBuffer(); }
  catch { throw new Error(`${path} 无法读取，请重新选择文件`); }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, ""); }
  catch { throw new Error(`${path} 不是有效的 UTF-8 文本`); }
}

/** For the separate 'new skill' authoring form only. Never repair or rewrite an
 * uploaded document to pass validation: nonstandard imports must be rejected. */
export function authoredSkillFile(title: string, description: string, instructions: string): AdminSkillFileInput {
  // Already-authored/imported SKILL.md must reach final server validation
  // unchanged; never hide invalid metadata inside a new valid YAML wrapper.
  if (/^\uFEFF?---[ \t]*\r?\n/.test(instructions)) {
    return { path: "SKILL.md", mimeType: "text/markdown; charset=utf-8", content: instructions };
  }
  const slug = [...title.toLowerCase().replace(/[^\p{L}\p{Nd}]+/gu, "-")].slice(0, 64).join("").replace(/^-+|-+$/g, "") || "custom-skill";
  return {
    path: "SKILL.md",
    mimeType: "text/markdown; charset=utf-8",
    content: `---\nname: ${JSON.stringify(slug)}\ndescription: ${JSON.stringify(description.trim() || title.trim())}\n---\n\n${instructions}`,
  };
}
