import { apiUrl, http } from "@/lib/http";

// Use the existing file-bound capability and attachment proxy. Access tokens
// never enter native navigation URLs, and large first-party videos stream.
export async function downloadTemplateResult(url: string, name: string, isCurrent: () => boolean): Promise<void> {
  name = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 180) || "FlowLight";
  const extension = new URL(url, window.location.origin).pathname.match(/\.([a-zA-Z0-9]{1,8})$/)?.[1];
  if (extension && !name.toLowerCase().endsWith(`.${extension.toLowerCase()}`)) name += `.${extension}`;
  const ticket = await http.post<{ url: string; native?: boolean }>("/api/files/download-ticket", { url, name });
  if (!isCurrent()) return;
  if (!ticket.success || !ticket.data?.url?.startsWith("/api/files/download?")) throw new Error(ticket.message || "暂时无法下载，请重试");
  let href = apiUrl(ticket.data.url);
  let blobURL = "";
  if (!ticket.data.native) {
    const response = await fetch(href, { credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error("文件下载失败，请稍后重试");
    blobURL = URL.createObjectURL(await response.blob()); href = blobURL;
  }
  if (!isCurrent()) { if (blobURL) URL.revokeObjectURL(blobURL); return; }
  const anchor = document.createElement("a"); anchor.href = href; anchor.download = name; anchor.rel = "noopener";
  anchor.style.display = "none"; document.body.appendChild(anchor); anchor.click(); anchor.remove();
  if (blobURL) window.setTimeout(() => URL.revokeObjectURL(blobURL), 30000);
}
