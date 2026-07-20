/* ============================================================================
   requireField — 提交时必填项缺失的统一反馈。

   口径(全站一致):提交动作命中空必填项时,除 toast 文案外,把对应字段滚进
   视口并加一圈短暂的强调描边(.req-miss,样式在 globals.css),让用户一眼
   看到"缺的是哪个"。纯 DOM 操作、无状态,任何表单(创作台/对话页/画布节点)
   传入元素或选择器即可接入。
   ========================================================================== */

/** 高亮一个必填字段:滚动到可见 + 1.6s 强调描边 + 尝试聚焦第一个可输入子元素。
    target 可以是元素本身、CSS 选择器,或 ref.current;找不到时静默(toast 仍在)。 */
export function markRequiredField(target: string | HTMLElement | null | undefined): void {
  if (typeof document === "undefined") return;
  const el = typeof target === "string" ? document.querySelector<HTMLElement>(target) : target;
  if (!el) return;
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  // 重复触发时先移除再加,保证动画重放
  el.classList.remove("req-miss");
  // 强制 reflow 让同帧内的 remove/add 生效
  void el.offsetWidth;
  el.classList.add("req-miss");
  window.setTimeout(() => el.classList.remove("req-miss"), 1600);
  const focusable = el.matches("input,textarea,select,[contenteditable]")
    ? el
    : el.querySelector<HTMLElement>("input,textarea,select,[contenteditable]");
  focusable?.focus?.({ preventScroll: true });
}
