/** Legacy orders are CNY. Never add or convert independent USD receipts. */
export function orderMoney(value: number | string, currency = "CNY") {
  const amount = Number(value) || 0;
  return `${currency === "USD" ? "US$" : "¥"}${amount.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function paidTotals(cny: number | string = 0, usd: number | string = 0) {
  return orderMoney(cny, "CNY") + (Number(usd) > 0 ? ` / ${orderMoney(usd, "USD")}` : "");
}
