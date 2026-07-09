import type { PaymentInitiateVO } from "@/types/order";

/**
 * 以 form POST 方式跳转到支付网关收银台（易支付推荐 POST，不易被劫持）。
 * newTab 为 true 时在新标签页打开（适合画布等不希望丢失页面状态的场景）。
 */
export function submitPayForm(payment: PaymentInitiateVO, options?: { newTab?: boolean }) {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = payment.payUrl;
  if (options?.newTab) form.target = "_blank";
  form.style.display = "none";
  for (const [key, value] of Object.entries(payment.params)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = key;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
  // 新标签页场景当前页仍存活，清理临时表单
  form.remove();
}
