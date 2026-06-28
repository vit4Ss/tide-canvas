"use client";

/* ============================================================================
   /admin/payments — 支付管理 (REAL data).

   Liuguang admin.js V.pay() skin, now backed by the real admin API
   (src/lib/admin-payments-api.ts):
     - 支付渠道 : GET/POST/PUT/DELETE /api/admin/pay/channels  (channel CRUD)
     - 最近交易 : GET /api/admin/orders (paged, read-only ledger — every real
                  purchase from the same `order` table the user flow writes)

   KEEPS the exact liuguang markup/classes + shared components. Mock import dropped.
   ============================================================================ */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AdminModal,
  AdminTable,
  Field,
  FormCard,
  FormGrid,
  Panel,
  RowActions,
  StatCardGrid,
  StatusPill,
  SwitchToggle,
} from "@/components/admin";
import type { Kpi, PillTone } from "@/mock/admin";
import { useAuthStore } from "@/stores/use-auth-store";
import { adminPaymentsApi } from "@/lib/admin-payments-api";
import type {
  AdminOrder,
  AdminPayChannel,
  AdminPayChannelUpsertDTO,
} from "@/types/admin-payments";

const yuan = (n: number) => `¥${n.toLocaleString("zh-CN")}`;
const pct = (n: number) => `${(n * 100).toFixed(2).replace(/\.?0+$/, "")}%`;
const toNum = (s: string) => {
  const v = Number(String(s).replace(/[^\d.-]/g, ""));
  return Number.isFinite(v) ? v : 0;
};

/** 0 待支付 / 1 已支付 / 2 已取消 / 3 已退款. */
const ORDER_STATUS: Record<number, { label: string; tone: PillTone }> = {
  0: { label: "待支付", tone: "amber" },
  1: { label: "已支付", tone: "green" },
  2: { label: "已取消", tone: "gray" },
  3: { label: "已退款", tone: "red" },
};

/** Order display time: prefer payTime, fall back to createTime. */
function fmtTime(s: string): string {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString("zh-CN", { hour12: false });
}

const orderItemLabel = (o: AdminOrder): string => {
  if (o.planId) return o.type ? `套餐 · ${o.type}` : "套餐";
  if (o.packageId) return "积分包";
  return o.type || "—";
};

const ORDER_PAGE_SIZE = 20;

/* ── channel modal form state ──────────────────────────────────────────── */
interface ChannelForm {
  name: string;
  type: string;
  rate: string;
  callback: string;
  enabled: boolean;
}
const emptyChannelForm = (): ChannelForm => ({
  name: "",
  type: "",
  rate: "",
  callback: "",
  enabled: true,
});
const channelToForm = (c: AdminPayChannel): ChannelForm => ({
  name: c.name,
  type: c.type,
  // store as percent for human-friendly editing (rate is fraction on the wire)
  rate: String(c.rate * 100),
  callback: c.callback,
  enabled: c.enabled,
});

export default function AdminPaymentsPage() {
  const ensureSession = useAuthStore((s) => s.ensureSession);

  const [channels, setChannels] = useState<AdminPayChannel[]>([]);
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [orderTotal, setOrderTotal] = useState(0);
  const [orderPage, setOrderPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // channel modal
  const [chOpen, setChOpen] = useState(false);
  const [editingCh, setEditingCh] = useState<AdminPayChannel | null>(null);
  const [chForm, setChForm] = useState<ChannelForm>(emptyChannelForm());

  const loadChannels = useCallback(async () => {
    const res = await adminPaymentsApi.listChannels();
    if (res.success && res.data) setChannels(res.data);
    else setError(res.message || "加载支付渠道失败");
  }, []);

  const loadOrders = useCallback(async (page: number) => {
    setOrdersLoading(true);
    const res = await adminPaymentsApi.listOrders({ pageNum: page, pageSize: ORDER_PAGE_SIZE });
    if (res.success && res.data) {
      setOrders(res.data.records);
      setOrderTotal(res.data.total);
      setOrderPage(res.data.pageNum);
    } else {
      setError(res.message || "加载交易失败");
    }
    setOrdersLoading(false);
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await ensureSession();
      await Promise.all([loadChannels(), loadOrders(1)]);
    } catch {
      setError("加载失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }, [ensureSession, loadChannels, loadOrders]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const pageCount = Math.max(1, Math.ceil(orderTotal / ORDER_PAGE_SIZE));

  /* ── KPIs derived from real data ─────────────────────────────────────── */
  const kpis: Kpi[] = useMemo(() => {
    const enabled = channels.filter((c) => c.enabled).length;
    const todaySum = channels.reduce((s, c) => s + c.todayAmount, 0);
    return [
      { k: "支付渠道", v: String(channels.length), dir: "up" },
      { k: "启用渠道", v: String(enabled), dir: "up" },
      { k: "渠道今日金额", v: yuan(todaySum), dir: "up" },
      { k: "交易总数", v: orderTotal.toLocaleString("zh-CN"), dir: "up" },
    ];
  }, [channels, orderTotal]);

  /* ── channel actions ─────────────────────────────────────────────────── */
  const openCreateCh = () => {
    setEditingCh(null);
    setChForm(emptyChannelForm());
    setChOpen(true);
  };
  const openEditCh = (c: AdminPayChannel) => {
    setEditingCh(c);
    setChForm(channelToForm(c));
    setChOpen(true);
  };
  const saveCh = async () => {
    const dto: AdminPayChannelUpsertDTO = {
      name: chForm.name.trim(),
      type: chForm.type.trim(),
      rate: toNum(chForm.rate) / 100, // percent → fraction
      callback: chForm.callback.trim(),
      enabled: chForm.enabled,
      // full-overwrite upsert: preserve sortOrder (not in the form) on edit, like
      // toggleCh does — otherwise editing a channel resets its order to 0.
      ...(editingCh ? { sortOrder: editingCh.sortOrder } : {}),
    };
    if (!dto.name || !dto.type) return;
    const res = editingCh
      ? await adminPaymentsApi.updateChannel(editingCh.id, dto)
      : await adminPaymentsApi.createChannel(dto);
    if (res.success) {
      setChOpen(false);
      loadChannels();
    } else {
      setError(res.message || "保存渠道失败");
    }
  };
  const toggleCh = async (c: AdminPayChannel, next: boolean) => {
    const dto: AdminPayChannelUpsertDTO = {
      name: c.name,
      type: c.type,
      rate: c.rate,
      callback: c.callback,
      sortOrder: c.sortOrder,
      enabled: next,
    };
    const res = await adminPaymentsApi.updateChannel(c.id, dto);
    if (res.success) loadChannels();
    else setError(res.message || "更新状态失败");
  };
  const deleteCh = async (c: AdminPayChannel) => {
    const res = await adminPaymentsApi.deleteChannel(c.id);
    if (res.success) loadChannels();
    else setError(res.message || "删除渠道失败");
  };

  return (
    <>
      <StatCardGrid items={kpis} />

      {error ? (
        <div className="adm-panel" style={{ padding: 16 }}>
          <span className="tag2 red">
            <i className="dot" />
            {error}
          </span>
        </div>
      ) : null}

      {/* 支付渠道 */}
      <Panel
        title="支付渠道"
        sub="渠道开关、费率与回调"
        tools={
          <button type="button" className="adm-btn" onClick={openCreateCh}>
            + 接入渠道
          </button>
        }
      >
        {loading ? (
          <div style={{ padding: 18 }} className="muted">
            加载中…
          </div>
        ) : channels.length === 0 ? (
          <div style={{ padding: 18 }} className="muted">
            暂无支付渠道，点击「接入渠道」添加。
          </div>
        ) : (
          <AdminTable<AdminPayChannel>
            rows={channels}
            rowKey={(r) => r.id}
            columns={[
              { header: "渠道", className: "strong", cell: (r) => r.name },
              { header: "类型", className: "muted", cell: (r) => r.type || "—" },
              { header: "费率", className: "mono", cell: (r) => pct(r.rate) },
              { header: "今日金额", className: "mono", cell: (r) => yuan(r.todayAmount) },
              {
                header: "回调",
                className: "muted",
                cell: (r) =>
                  r.callback ? (
                    <span className="mono">{r.callback}</span>
                  ) : (
                    <StatusPill tone="gray">未配置</StatusPill>
                  ),
              },
              {
                header: "状态",
                cell: (r) => (
                  <SwitchToggle
                    checked={r.enabled}
                    onChange={(next) => toggleCh(r, next)}
                    aria-label={`${r.name} 开关`}
                  />
                ),
              },
              {
                header: "操作",
                align: "right",
                cell: (r) => (
                  <RowActions
                    actions={[
                      { label: "配置", onClick: () => openEditCh(r) },
                      { label: "删除", onClick: () => deleteCh(r) },
                    ]}
                  />
                ),
              },
            ]}
          />
        )}
      </Panel>

      {/* 最近交易 (server-paged, read-only) */}
      <Panel
        title="最近交易"
        sub="全部用户的真实订单流水"
        tools={
          <button
            type="button"
            className="adm-btn ghost"
            onClick={() => loadOrders(orderPage)}
            disabled={ordersLoading}
          >
            刷新
          </button>
        }
      >
        {loading || ordersLoading ? (
          <div style={{ padding: 18 }} className="muted">
            加载中…
          </div>
        ) : orders.length === 0 ? (
          <div style={{ padding: 18 }} className="muted">
            暂无交易记录。
          </div>
        ) : (
          <>
            <AdminTable<AdminOrder>
              rows={orders}
              rowKey={(r) => r.id}
              columns={[
                { header: "订单号", className: "mono muted", cell: (r) => r.orderNo },
                {
                  header: "用户",
                  cell: (r) => r.user?.nickname || r.user?.username || r.userId,
                },
                { header: "套餐 / 商品", cell: (r) => orderItemLabel(r) },
                {
                  header: "金额",
                  align: "right",
                  className: "mono strong",
                  cell: (r) => yuan(r.amount),
                },
                { header: "渠道", cell: (r) => r.payMethod || "—" },
                {
                  header: "时间",
                  className: "muted",
                  cell: (r) => fmtTime(r.payTime || r.createTime),
                },
                {
                  header: "状态",
                  cell: (r) => {
                    const s = ORDER_STATUS[r.status] ?? { label: String(r.status), tone: "gray" as PillTone };
                    return <StatusPill tone={s.tone}>{s.label}</StatusPill>;
                  },
                },
              ]}
            />
            {/* server-side pager (the order list is paged by the backend) */}
            <div className="adm-pager">
              <span className="total">共 {orderTotal.toLocaleString("zh-CN")} 条</span>
              <div className="pgs">
                <button
                  type="button"
                  className="pg nav"
                  onClick={() => loadOrders(Math.max(1, orderPage - 1))}
                  disabled={orderPage <= 1}
                  aria-label="上一页"
                >
                  ‹
                </button>
                <button type="button" className="pg on">
                  {orderPage}
                </button>
                <span className="gap">/ {pageCount}</span>
                <button
                  type="button"
                  className="pg nav"
                  onClick={() => loadOrders(Math.min(pageCount, orderPage + 1))}
                  disabled={orderPage >= pageCount}
                  aria-label="下一页"
                >
                  ›
                </button>
              </div>
            </div>
          </>
        )}
      </Panel>

      {/* 接入 / 配置渠道 modal */}
      <AdminModal
        open={chOpen}
        title={editingCh ? "配置渠道" : "接入渠道"}
        subtitle="配置支付渠道的费率、回调与开关"
        onClose={() => setChOpen(false)}
        onSave={saveCh}
      >
        <FormCard title="渠道信息">
          <FormGrid>
            <Field label="渠道名称" required span={2}>
              <input
                placeholder="如：微信支付"
                value={chForm.name}
                onChange={(e) => setChForm((f) => ({ ...f, name: e.target.value }))}
              />
            </Field>
            <Field label="类型" required span={2}>
              <input
                placeholder="如：wechat / alipay / stripe"
                value={chForm.type}
                onChange={(e) => setChForm((f) => ({ ...f, type: e.target.value }))}
              />
            </Field>
            <Field label="费率 (%)" span={2} hint="如 0.6 表示 0.6%">
              <input
                type="number"
                placeholder="如：0.6"
                value={chForm.rate}
                onChange={(e) => setChForm((f) => ({ ...f, rate: e.target.value }))}
              />
            </Field>
            <Field label="回调地址" span={2}>
              <input
                placeholder="https://api.example.com/pay/callback"
                value={chForm.callback}
                onChange={(e) => setChForm((f) => ({ ...f, callback: e.target.value }))}
              />
            </Field>
            <Field label="状态" span={4} hint="关闭后该渠道停止收款">
              <SwitchToggle
                checked={chForm.enabled}
                onChange={(next) => setChForm((f) => ({ ...f, enabled: next }))}
                aria-label="渠道状态"
              />
            </Field>
          </FormGrid>
        </FormCard>
      </AdminModal>
    </>
  );
}
