import { getAccessToken, http } from "./http";

export interface DownloadAsset { url: string; name: string }
export function safeFilename(name: string, url: string, index = 0) {
  const ext = /\.(\w{1,8})$/.exec(new URL(url, "https://example.test").pathname)?.[1];
  const stem = name.replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, "_").replace(/^\.+/, "").trim().slice(0, 140) || "creation";
  return `${index ? `${index}-` : ""}${stem}${ext && !stem.toLowerCase().endsWith(`.${ext.toLowerCase()}`) ? `.${ext}` : ""}`;
}
export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
export async function downloadOriginal(asset: DownloadAsset, signal: AbortSignal) {
  const response = await http.post<{ url: string; native?: boolean }>("/api/files/download-ticket", { url: new URL(asset.url, location.origin).href, name: safeFilename(asset.name, asset.url) }, { signal });
  if (!response.success || !response.data?.url) throw new Error(response.message || "The download could not be prepared.");
  const target = new URL(response.data.url, location.origin);
  if (target.origin !== location.origin || target.pathname !== "/api/files/download") throw new Error("The service returned an invalid download link.");
  if (signal.aborted) throw new Error("Download cancelled.");
  // External legacy URLs cannot be verified when the ticket is issued. Fetch
  // and check the response first rather than saving an error page as media.
  if (!response.data.native) {
    const file = await fetch(target.href, { signal, cache: "no-store", credentials: "omit" });
    if (!file.ok || !file.body) throw new Error("The original file is unavailable. Try again or contact support with the creation reference.");
    const reader = file.body.getReader(), chunks: Uint8Array[] = [];
    const limit = 100 * 1024 * 1024; let total = 0;
    try {
      if (Number(file.headers.get("content-length") || 0) > limit) throw new Error("This external file exceeds the 100 MB browser download limit. Open the original file instead.");
      while (true) { const part = await reader.read(); if (part.done) break; total += part.value.length; if (total > limit) throw new Error("This external file exceeds the 100 MB browser download limit. Open the original file instead."); chunks.push(part.value); }
    } catch (cause) { await reader.cancel().catch(() => {}); throw cause; }
    if (signal.aborted) throw new Error("Download cancelled.");
    saveBlob(new Blob(chunks.map(chunk => chunk.slice().buffer), { type: file.headers.get("content-type") || "application/octet-stream" }), safeFilename(asset.name, asset.url));
    return;
  }
  const a = document.createElement("a"); a.href = target.href; a.download = safeFilename(asset.name, asset.url); a.rel = "noreferrer"; document.body.append(a); a.click(); a.remove();
}
export async function downloadArchive(assets: DownloadAsset[], signal: AbortSignal, progress: (done: number) => void) {
  if (!assets.length || assets.length > 24) throw new Error("Choose between 1 and 24 files.");
  const token = getAccessToken();
  if (!token) throw new Error("Sign in to download your files.");
  const { zipSync } = await import("fflate");
  const entries: Record<string, Uint8Array> = {};
  const limit = 100 * 1024 * 1024;
  let total = 0;
  for (const [index, asset] of assets.entries()) {
    if (signal.aborted || token !== getAccessToken()) throw new Error("Download cancelled or your account changed.");
    const params = new URLSearchParams({ url: new URL(asset.url, location.origin).href, name: safeFilename(asset.name, asset.url) });
    const response = await fetch(`/api/files/download?${params}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]), cache: "no-store" });
    if (!response.ok || !response.body) throw new Error(`Could not download “${asset.name}”. No archive was saved; retry or open the original.`);
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = []; let length = 0;
    try {
      if (total + Number(response.headers.get("content-length") || 0) > limit) throw new Error("This selection exceeds the 100 MB archive limit. Download large files individually.");
      while (true) {
        const next = await reader.read(); if (next.done) break;
        total += next.value.length; length += next.value.length;
        if (total > limit) throw new Error("This selection exceeds the 100 MB archive limit. Download large files individually.");
        chunks.push(next.value);
      }
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    entries[safeFilename(asset.name, asset.url, index + 1)] = bytes;
    progress(index + 1);
  }
  if (signal.aborted || token !== getAccessToken()) throw new Error("Download cancelled or your account changed.");
  // Media is already compressed. Storing ZIP entries avoids expensive recompression.
  saveBlob(new Blob([zipSync(entries, { level: 0 }).slice().buffer], { type: "application/zip" }), "framelyn-creations.zip");
}
