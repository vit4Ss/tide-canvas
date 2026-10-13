import type { StudioSettings } from "./studio";

export type StudioDraft = StudioSettings & { modelId: string; entryQuery?: string };
const prefix = "framelyn.studio-draft.v1:";
const maxAge = 7 * 24 * 60 * 60 * 1000;
export function draftKey(owner: string) { return prefix + encodeURIComponent(owner || "guest"); }
export function parseDraft(raw: string | null, now = Date.now()): StudioDraft | null {
  try {
    const value = JSON.parse(raw || "null");
    if (!value || value.version !== 1 || !Number.isFinite(value.savedAt) || value.savedAt > now || now - value.savedAt > maxAge) return null;
    const d = value.draft;
    if (!d || !["image", "video", "audio", "3d", "upscale"].includes(d.media)) return null;
    for (const key of ["modelId", "mode", "prompt", "resolution", "ratio", "quality", "duration", "outputFps", "upscaleModel", "voice", "lyrics"]) if (typeof d[key] !== "string" || d[key].length > 32000) return null;
    if (!Number.isInteger(d.count) || d.count < 1 || d.count > 4 || typeof d.instrumental !== "boolean" || typeof d.enablePbr !== "boolean") return null;
    if (!Array.isArray(d.refs) || d.refs.length > 32 || d.refs.some((r: { url: string; name: string; kind: string }) => !r || typeof r.url !== "string" || !/^(https?:\/\/|\/(?!\/))/.test(r.url) || typeof r.name !== "string" || !["image", "video", "audio"].includes(r.kind))) return null;
    return d;
  } catch { return null; }
}
export function readDraft(owner: string): StudioDraft | null {
  try { return parseDraft(sessionStorage.getItem(draftKey(owner))); } catch { return null; }
}
export function writeDraft(owner: string, draft: StudioDraft): boolean {
  try { sessionStorage.setItem(draftKey(owner), JSON.stringify({ version: 1, savedAt: Date.now(), draft })); return true; } catch { return false; }
}
export function loginDraft(draft: StudioDraft): string {
  const id = crypto.randomUUID();
  return writeDraft(`handoff:${id}`, draft) ? `/studio?draft=${id}` : "/studio";
}
export function takeLoginDraft(id: string): StudioDraft | null {
  if (!/^[\da-f-]{36}$/i.test(id)) return null;
  const key = draftKey(`handoff:${id}`);
  try {
    const draft = parseDraft(sessionStorage.getItem(key));
    sessionStorage.removeItem(key);
    if (draft) sessionStorage.removeItem(draftKey("guest"));
    return draft;
  } catch { return null; }
}
