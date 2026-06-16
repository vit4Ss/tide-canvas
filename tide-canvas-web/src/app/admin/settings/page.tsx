"use client";

import { useEffect, useState } from "react";
import { Card, Input, InputNumber, Switch, Button, Space, Skeleton } from "antd";
import { SaveOutlined } from "@ant-design/icons";
import { adminApi } from "@/lib/api";
import { useHasPerm } from "@/stores/use-permission-store";
import { toast } from "@/components/shared/toast";
import { AdminPageHead } from "@/components/admin/page-head";

interface SettingField {
  key: string;
  label: string;
  type: "text" | "number" | "toggle" | "textarea";
  description?: string;
  placeholder?: string;
}
interface SettingGroup {
  title: string;
  description?: string;
  fields: SettingField[];
}

const SETTING_GROUPS: SettingGroup[] = [
  {
    title: "站点设置",
    fields: [
      { key: "site.name", label: "站点名称", type: "text", description: "网站显示的名称" },
      { key: "site.description", label: "站点描述", type: "text", description: "网站的描述信息" },
      { key: "register.enabled", label: "开放注册", type: "toggle", description: "是否允许新用户注册" },
      { key: "default.storage_quota", label: "默认存储额度 (bytes)", type: "number", description: "每个用户默认的存储空间额度" },
    ],
  },
  {
    title: "积分设置",
    fields: [
      { key: "points.new_user", label: "新用户赠送积分", type: "number", description: "新注册用户初始赠送积分" },
      { key: "points.checkin.base", label: "签到基础积分", type: "number", description: "每次签到获得的基础积分" },
      { key: "points.checkin.streak_bonus", label: "连续签到额外积分", type: "number", description: "连续签到每天额外奖励积分" },
      { key: "points.checkin.streak_cap", label: "连续签到积分上限", type: "number", description: "连续签到额外积分的上限" },
      { key: "points.recharge.ratio", label: "充值比例 (1元=N积分)", type: "number", description: "每元可兑换的积分数量" },
    ],
  },
  {
    title: "支付设置（易联达Pay）",
    description: "对接易支付 V2 协议（SHA256WithRSA）。在商户后台「个人资料→API信息」生成RSA密钥对后填入；保存并开启后，用户即可在充值页在线支付。",
    fields: [
      { key: "pay.epay.enabled", label: "启用在线支付", type: "toggle", description: "关闭时充值订单需管理员在订单管理中手动确认" },
      { key: "pay.epay.gateway", label: "网关地址", type: "text", description: "支付接口域名", placeholder: "https://api.ndow.cn" },
      { key: "pay.epay.pid", label: "商户ID (pid)", type: "text", description: "商户后台获取的商户ID", placeholder: "1001" },
      { key: "pay.epay.merchant_private_key", label: "商户RSA私钥", type: "textarea", description: "商户后台生成的私钥（Base64，可带PEM头尾），用于请求签名，请妥善保管" },
      { key: "pay.epay.platform_public_key", label: "平台RSA公钥", type: "textarea", description: "支付平台的公钥（Base64），用于异步通知与查单响应验签" },
      { key: "pay.epay.notify_url", label: "异步通知地址", type: "text", description: "必须公网可达，路径固定为 /api/orders/notify/epay", placeholder: "https://你的后端域名/api/orders/notify/epay" },
      { key: "pay.epay.return_url", label: "支付完成跳转地址", type: "text", description: "支付成功后浏览器跳回的页面", placeholder: "https://你的前端域名/user/orders" },
      { key: "pay.epay.pay_types", label: "启用的支付方式", type: "text", description: "逗号分隔，可选：alipay(支付宝)、wxpay(微信)", placeholder: "alipay,wxpay" },
    ],
  },
  {
    title: "AI 设置",
    fields: [
      { key: "ai.user_max_concurrency", label: "单用户 AI 并发上限", type: "number", description: "单个用户同时进行中的 AI 生成任务数上限（0 = 不限制）；超出时提示等待已有任务完成" },
    ],
  },
];
const ALL_FIELDS = SETTING_GROUPS.flatMap((g) => g.fields);

export default function AdminSettingsPage() {
  const can = useHasPerm();
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [originalSettings, setOriginalSettings] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const res = await adminApi.settings.get();
      if (res.success && res.data) { setSettings(res.data); setOriginalSettings(res.data); }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "加载设置失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadSettings(); }, []);

  const handleChange = (key: string, value: unknown) => setSettings((prev) => ({ ...prev, [key]: value }));
  const hasChanges = () => ALL_FIELDS.some((f) => String(settings[f.key] ?? "") !== String(originalSettings[f.key] ?? ""));

  const handleSave = async () => {
    setSaving(true);
    try {
      const changed: Record<string, unknown> = {};
      for (const f of ALL_FIELDS) {
        if (String(settings[f.key] ?? "") !== String(originalSettings[f.key] ?? "")) changed[f.key] = settings[f.key];
      }
      if (Object.keys(changed).length === 0) { toast.info("没有需要保存的更改"); return; }
      const res = await adminApi.settings.update(changed);
      if (res.success) { setOriginalSettings({ ...settings }); toast.success("设置已保存"); }
      else toast.error(res.message || "保存失败");
    } catch {
      toast.error("保存失败，请重试");
    } finally {
      setSaving(false);
    }
  };

  const renderField = (f: SettingField) => {
    const value = settings[f.key];
    if (f.type === "toggle") {
      const on = value === true || value === "true" || value === 1 || value === "1";
      return <Switch checked={on} onChange={(c) => handleChange(f.key, c)} />;
    }
    if (f.type === "number") {
      return <InputNumber style={{ width: 240 }} value={value != null ? Number(value) : undefined} onChange={(v) => handleChange(f.key, v ?? "")} />;
    }
    if (f.type === "textarea") {
      return <Input.TextArea rows={4} spellCheck={false} style={{ fontFamily: "monospace", fontSize: 12 }} placeholder={f.placeholder} value={String(value ?? "")} onChange={(e) => handleChange(f.key, e.target.value)} />;
    }
    return <Input style={{ width: 320, maxWidth: "100%" }} placeholder={f.placeholder} value={String(value ?? "")} onChange={(e) => handleChange(f.key, e.target.value)} />;
  };

  const saveBtn = can("setting:edit") && <Button type="primary" icon={<SaveOutlined />} loading={saving} disabled={!hasChanges()} onClick={handleSave}>保存设置</Button>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <AdminPageHead title="系统设置" desc="站点基础配置和功能开关" extra={saveBtn} />

      {loading ? (
        <Card><Skeleton active paragraph={{ rows: 8 }} /></Card>
      ) : (
        <>
          {SETTING_GROUPS.map((group) => (
            <Card key={group.title} title={group.title}>
              {group.description && <p style={{ marginTop: -8, marginBottom: 16, fontSize: 12, color: "#bfbfbf" }}>{group.description}</p>}
              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                {group.fields.map((f) => (
                  <div key={f.key} style={f.type === "textarea" ? {} : { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 24, flexWrap: "wrap" }}>
                    <div style={{ minWidth: 200 }}>
                      <div style={{ fontWeight: 500, fontSize: 14 }}>{f.label}</div>
                      {f.description && <div style={{ fontSize: 12, color: "#bfbfbf", marginTop: 2 }}>{f.description}</div>}
                      <div style={{ fontSize: 12, color: "#d9d9d9", fontFamily: "monospace", marginTop: 2 }}>{f.key}</div>
                    </div>
                    <div style={f.type === "textarea" ? { width: "100%", marginTop: 8 } : {}}>{renderField(f)}</div>
                  </div>
                ))}
              </div>
            </Card>
          ))}
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Space>
              <Button disabled={!hasChanges()} onClick={() => setSettings({ ...originalSettings })}>重置</Button>
              {saveBtn}
            </Space>
          </div>
        </>
      )}
    </div>
  );
}
