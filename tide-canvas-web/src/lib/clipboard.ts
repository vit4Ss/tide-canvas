/* ============================================================================
   剪贴板写入 — 唯一实现（原 chat 页 copyText 抽出共享）。
   navigator.clipboard 仅在安全上下文可用；纯 HTTP 部署回退 execCommand，
   其失败通过返回 false 表示（不抛异常），调用方据返回值提示成败。
   ========================================================================== */

export async function copyText(text: string, canCopy?: () => boolean): Promise<boolean> {
  // A sensitive caller may lose its session while the browser is deciding
  // clipboard permissions. Recheck before each separate write attempt.
  const allowed = () => {
    try { return canCopy ? canCopy() : true; } catch { return false; }
  };
  if (!allowed()) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return allowed();
    }
  } catch {
    /* fall through */
  }
  if (!allowed()) return false;
  let ta: HTMLTextAreaElement | null = null;
  let previousFocus: HTMLElement | null = null;
  try {
    previousFocus = document.activeElement as HTMLElement | null;
    ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    if (!allowed()) return false;
    const ok = document.execCommand("copy");
    return ok && allowed();
  } catch {
    return false;
  } finally {
    // execCommand can throw; never leave the secret in a hidden DOM element.
    if (ta) { ta.value = ""; ta.remove(); }
    try { if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true }); } catch { /* the prior element may no longer accept focus */ }
  }
}
