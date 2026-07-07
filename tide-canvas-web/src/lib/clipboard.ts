/* ============================================================================
   剪贴板写入 — 唯一实现（原 chat 页 copyText 抽出共享）。
   navigator.clipboard 仅在安全上下文可用；纯 HTTP 部署回退 execCommand，
   其失败通过返回 false 表示（不抛异常），调用方据返回值提示成败。
   ========================================================================== */

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
