"use client";

import { useEffect, useState } from "react";
import { adminApi } from "@/lib/api";
import { Save, Settings, Loader2, CheckCircle, AlertCircle } from "lucide-react";

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
];

const ALL_FIELDS: SettingField[] = SETTING_GROUPS.flatMap((g) => g.fields);

export default function AdminSettingsPage() {
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [originalSettings, setOriginalSettings] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const res = await adminApi.settings.get();
      if (res.success && res.data) {
        setSettings(res.data);
        setOriginalSettings(res.data);
      }
    } catch (err) {
      setToast({ type: "error", message: err instanceof Error ? err.message : "加载设置失败" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const handleChange = (key: string, value: unknown) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const hasChanges = () => {
    return ALL_FIELDS.some((field) => {
      return String(settings[field.key] ?? "") !== String(originalSettings[field.key] ?? "");
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Only send changed values
      const changedValues: Record<string, unknown> = {};
      for (const field of ALL_FIELDS) {
        const current = settings[field.key];
        const original = originalSettings[field.key];
        if (String(current ?? "") !== String(original ?? "")) {
          changedValues[field.key] = current;
        }
      }

      if (Object.keys(changedValues).length === 0) {
        setToast({ type: "success", message: "没有需要保存的更改" });
        return;
      }

      const res = await adminApi.settings.update(changedValues);
      if (res.success) {
        setOriginalSettings({ ...settings });
        setToast({ type: "success", message: "设置已保存" });
      } else {
        setToast({ type: "error", message: res.message || "保存失败" });
      }
    } catch {
      setToast({ type: "error", message: "保存失败，请重试" });
    } finally {
      setSaving(false);
    }
  };

  const renderField = (field: SettingField) => {
    const value = settings[field.key];

    if (field.type === "toggle") {
      const isEnabled = value === true || value === "true" || value === 1 || value === "1";
      return (
        <button
          onClick={() => handleChange(field.key, !isEnabled)}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            isEnabled ? "bg-green-500" : "bg-neutral-300 dark:bg-neutral-600"
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              isEnabled ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      );
    }

    if (field.type === "number") {
      return (
        <input
          type="number"
          value={value !== undefined && value !== null ? String(value) : ""}
          onChange={(e) => handleChange(field.key, e.target.value === "" ? "" : Number(e.target.value))}
          className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900"
        />
      );
    }

    if (field.type === "textarea") {
      return (
        <textarea
          value={String(value ?? "")}
          onChange={(e) => handleChange(field.key, e.target.value)}
          rows={4}
          placeholder={field.placeholder}
          spellCheck={false}
          className="w-full resize-y rounded-lg border border-neutral-200 px-3 py-2 font-mono text-xs leading-relaxed outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900"
        />
      );
    }

    return (
      <input
        type="text"
        value={String(value ?? "")}
        onChange={(e) => handleChange(field.key, e.target.value)}
        placeholder={field.placeholder}
        className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900"
      />
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">系统设置</h2>
          <p className="mt-1 text-sm text-neutral-500">站点基础配置和功能开关</p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving || !hasChanges()}
          className="inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-white dark:text-neutral-900"
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {saving ? "保存中..." : "保存设置"}
        </button>
      </div>

      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800" />
          ))}
        </div>
      ) : (
        <>
          {SETTING_GROUPS.map((group) => (
            <div key={group.title} className="rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
              <div className="border-b border-neutral-100 px-6 py-4 dark:border-neutral-800">
                <h3 className="font-semibold">{group.title}</h3>
                {group.description && (
                  <p className="mt-1 text-xs text-neutral-400">{group.description}</p>
                )}
              </div>
              <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {group.fields.map((field) => (
                  <div
                    key={field.key}
                    className={
                      field.type === "textarea"
                        ? "space-y-3 px-6 py-5"
                        : "flex items-center justify-between gap-8 px-6 py-5"
                    }
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Settings className="h-4 w-4 text-neutral-400" />
                        <label className="text-sm font-medium">{field.label}</label>
                      </div>
                      {field.description && (
                        <p className="mt-1 pl-6 text-xs text-neutral-400">{field.description}</p>
                      )}
                      <p className="mt-0.5 pl-6 font-mono text-xs text-neutral-400">{field.key}</p>
                    </div>
                    <div className={field.type === "textarea" ? "" : "w-64 flex-shrink-0"}>
                      {renderField(field)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* 底部保存栏 */}
          <div className="flex items-center justify-end gap-3">
            <button
              onClick={() => {
                setSettings({ ...originalSettings });
              }}
              disabled={!hasChanges()}
              className="rounded-lg px-4 py-2 text-sm text-neutral-600 hover:bg-neutral-100 disabled:opacity-50 dark:text-neutral-400 dark:hover:bg-neutral-800"
            >
              重置
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !hasChanges()}
              className="inline-flex items-center gap-1 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-white dark:text-neutral-900"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {saving ? "保存中..." : "保存"}
            </button>
          </div>
        </>
      )}

      {/* Toast 提示 */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium shadow-lg transition-all ${
            toast.type === "success"
              ? "bg-green-50 text-green-700 border border-green-200 dark:bg-green-950/80 dark:text-green-300 dark:border-green-800"
              : "bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/80 dark:text-red-300 dark:border-red-800"
          }`}
        >
          {toast.type === "success" ? (
            <CheckCircle className="h-4 w-4" />
          ) : (
            <AlertCircle className="h-4 w-4" />
          )}
          {toast.message}
        </div>
      )}
    </div>
  );
}
