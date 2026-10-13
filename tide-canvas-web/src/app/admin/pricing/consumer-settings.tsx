"use client";
import { useEffect, useState } from "react";
import { http } from "@/lib/http";
import { AdminAlert, Field, Panel } from "@/components/admin";

interface Info { supportEmail: string; commercialUse: string; retention: string; refundTiming: string; creditValidity: string; membershipTerms: string }
const empty: Info = { supportEmail: "", commercialUse: "", retention: "", refundTiming: "", creditValidity: "", membershipTerms: "" };
const labels: Record<Exclude<keyof Info, "supportEmail">, string> = { commercialUse: "商用范围（英文）", retention: "文件与作品保存期限（英文）", refundTiming: "退款处理时限（英文）", creditValidity: "积分有效期（英文）", membershipTerms: "会员权益与有效期（英文）" };

export function ConsumerSettings({ onDirtyChange }: { onDirtyChange: (value: boolean) => void }) {
  const [value, setValue] = useState<Info>(empty);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [revision, setRevision] = useState(0);
  const [checkout, setCheckout] = useState<boolean | null>(null);
  const [registration, setRegistration] = useState<boolean | null>(null);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => {
    let alive = true;
    void Promise.all([http.get<Info>("/api/admin/en/pricing/consumer"), http.get<{ key: string }[]>("/api/billing/en/channels"), http.get<{ registerClosed: boolean }>("/api/auth/register-config")]).then(([info, channels, signup]) => {
      if (!alive) return;
      setLoading(false);
      if (info.success && info.data) { setValue({ ...empty, ...info.data }); setError(""); } else setError(info.message || "无法读取英文消费者说明；请先部署后端接口。");
      setCheckout(channels.success && Array.isArray(channels.data) ? channels.data.some(c => ["stripe", "pancake"].includes(c.key)) : null);
      setRegistration(signup.success && typeof signup.data?.registerClosed === "boolean" ? !signup.data.registerClosed : null);
    });
    return () => { alive = false; };
  }, [revision]);
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError(""); setSaved(false);
    const response = await http.put<Info>("/api/admin/en/pricing/consumer", value);
    setBusy(false);
    if (!response.success) { setError(response.message || "保存失败"); return; }
    setValue(response.data!); setDirty(false); setSaved(true);
  };
  const change = (key: keyof Info, text: string) => { setValue(v => ({ ...v, [key]: text })); setDirty(true); setSaved(false); };
  return <Panel title="英文站售后与购买说明" sub="以下信息直接展示在英文站帮助、价格及使用条款中。留空会明确显示尚未发布，请填写已确定的英文承诺。">
    <div style={{ padding: 16 }}>
    <p style={{ marginBottom: 16 }}>上线检查：美元支付 {checkout === null ? "状态待确认" : checkout ? "已可用" : "尚未配置或未启用"} · 新用户注册 {registration === null ? "状态待确认" : registration ? "已开放" : "已关闭"}。美元套餐需在下方单独填写价格并上架；注册开关与中文站共用，不会自动开启。</p>
    <p style={{ marginBottom: 16 }}>此处维护公开文案，不会自动改变文件清理、积分到期或会员降级规则。请只填写服务实际支持的承诺。</p>
    {error && <AdminAlert title="消费者说明加载或保存失败" tone="error">{error}<button className="adm-btn ghost" type="button" onClick={() => { setLoading(true); setRevision(n => n + 1); }}>重新读取</button></AdminAlert>}
    {saved && <p role="status">已保存，英文站刷新后生效。</p>}
    <form onSubmit={event => void save(event)}><fieldset disabled={loading || busy} style={{ border: 0, padding: 0, display: "grid", gap: 16 }}>
      <Field label="公开客服邮箱"><input className="adm-input" type="email" required maxLength={254} value={value.supportEmail} onChange={e => change("supportEmail", e.target.value)} /></Field>
      {(Object.keys(labels) as (keyof typeof labels)[]).map(key => <Field key={key} label={labels[key]}><textarea className="adm-input" rows={3} maxLength={2000} value={value[key]} onChange={e => change(key, e.target.value)} /></Field>)}
      <div><button className="adm-btn" disabled={!dirty || busy} type="submit">{busy ? "保存中…" : "保存消费者说明"}</button></div>
    </fieldset></form></div>
  </Panel>;
}
