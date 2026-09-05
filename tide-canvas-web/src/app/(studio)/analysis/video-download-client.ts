export interface VideoDownloadProgress { loaded: number; total: number }

// Let the browser manage the Blob backing store rather than accumulating
// Uint8Array chunks in React/JS. Only one download is retained by the caller.
export function receiveVideoDownload(
  url: string,
  maxBytes: number,
  signal: AbortSignal,
  onProgress: (progress: VideoDownloadProgress) => void,
  createRequest = () => new XMLHttpRequest(),
): Promise<Blob> {
  const limit = Number.isFinite(maxBytes) && maxBytes > 0 ? Math.min(maxBytes, 2 ** 31) : 512 * 1024 ** 2;
  return new Promise((resolve, reject) => {
    const xhr = createRequest();
    let settled = false;
    let lastProgress = 0;
    const finish = (error?: Error, blob?: Blob) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", cancel);
      xhr.onload = xhr.onerror = xhr.ontimeout = xhr.onabort = xhr.onprogress = xhr.onreadystatechange = null;
      if (error) reject(error);
      else resolve(blob!);
    };
    const cancel = () => {
      finish(new DOMException("已取消视频下载", "AbortError"));
      xhr.abort();
    };
    const tooLarge = () => {
      finish(new Error("视频文件超过当前下载大小上限"));
      xhr.abort();
    };
    if (signal.aborted) { cancel(); return; }
    signal.addEventListener("abort", cancel, { once: true });
    xhr.open("GET", url);
    xhr.responseType = "blob";
    xhr.timeout = 60 * 60_000;
    xhr.setRequestHeader("Accept", "video/mp4, application/json");
    xhr.onreadystatechange = () => {
      if (xhr.readyState === 2 && Number(xhr.getResponseHeader("Content-Length")) > limit) tooLarge();
    };
    xhr.onprogress = (event) => {
      if (event.loaded > limit || event.lengthComputable && event.total > limit) { tooLarge(); return; }
      const now = Date.now();
      if (!lastProgress || now - lastProgress >= 200 || event.loaded === event.total) {
        lastProgress = now;
        onProgress({ loaded: event.loaded, total: event.lengthComputable ? event.total : 0 });
      }
    };
    xhr.onerror = () => finish(new Error("下载连接失败，请检查网络后重试"));
    xhr.ontimeout = () => finish(new Error("视频下载超时，请稍后重试"));
    xhr.onabort = () => finish(new DOMException("已取消视频下载", "AbortError"));
    xhr.onload = () => { void (async () => {
      try {
        const blob = xhr.response as Blob | null;
        const contentType = (xhr.getResponseHeader("Content-Type") || "").toLowerCase();
        if (xhr.status !== 200 || /json|text\//.test(contentType)) {
          let message = `视频下载失败（HTTP ${xhr.status || "未知"}），请重试`;
          try {
            const result = JSON.parse(await blob?.slice(0, 16_384).text() || "");
            const reason = typeof result.message === "string" ? result.message : result.error;
            if (typeof reason === "string" && reason.trim()) message = reason.trim().slice(0, 500);
          } catch { /* A gateway HTML page must never be saved as a video. */ }
          finish(new Error(message));
          return;
        }
        if (!blob?.size) { finish(new Error("下载返回了空文件，请重新获取视频")); return; }
        if (blob.size > limit) { tooLarge(); return; }
        // Our backend always remuxes/transcodes to MP4 before returning it.
        const prefix = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
        if (String.fromCharCode(...prefix.slice(4, 8)) !== "ftyp") {
          finish(new Error("下载接口没有返回有效的 MP4 视频，请重新获取视频"));
          return;
        }
        finish(undefined, blob);
      } catch {
        finish(new Error("视频文件接收失败，请重试"));
      }
    })(); };
    try { xhr.send(); } catch { finish(new Error("无法发起视频下载，请重试")); }
  });
}
