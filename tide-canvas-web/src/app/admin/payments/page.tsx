"use client";

/* ============================================================================
   /admin/payments — 支付管理 (REAL data).

   Liuguang admin.js V.pay() skin, now backed by the real admin API
   (src/lib/admin-payments-api.ts):
     - 支付渠道 : GET/POST/PUT/DELETE /api/admin/pay/channels  (channel CRUD)
     - 最近交易 : GET /api/admin/orders (paged, 关键词搜订单号/交易号) +
                  POST /orders/:id/refund(账务退款:已支付 → 已退款,按结算
                  流水回收积分;渠道原路退回需在渠道后台另行操作)

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
  TableSkeleton,
} from "@/components/admin";
import type { Kpi, PillTone } from "@/mock/admin";
import { useAuthStore } from "@/stores/use-auth-store";
import { adminPaymentsApi } from "@/lib/admin-payments-api";
import { confirmDialog } from "@/components/shared/confirm";
import { toast } from "@/components/shared/toast";
import type {
  AdminOrder,
  AdminPayChannel,
  AdminPayChannelUpsertDTO,
} from "@/types/admin-payments";

const yuan = (n: number) =>
  `¥${n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
  // 订单搜索:query = 输入框实时值,keyword = 已提交的检索词(回车/按钮提交)
  const [orderQuery, setOrderQuery] = useState("");
  const [orderKeyword, setOrderKeyword] = useState("");

  // channel modal
  const [chOpen, setChOpen] = useState(false);
  const [editingCh, setEditingCh] = useState<AdminPayChannel | null>(null);
  const [chForm, setChForm] = useState<ChannelForm>(emptyChannelForm());

  const loadChannels = useCallback(async () => {
    const res = await adminPaymentsApi.listChannels();
    if (res.success && res.data) setChannels(res.data);
    else setError(res.message || "加载支付渠道失败");
  }, []);

  const loadOrders = useCallback(
    async (page: number, keyword: string = orderKeyword) => {
      setOrdersLoading(true);
      const res = await adminPaymentsApi.listOrders({
        pageNum: page,
        pageSize: ORDER_PAGE_SIZE,
        keyword: keyword.trim() || undefined,
      });
      if (res.success && res.data) {
        setOrders(res.data.records);
        setOrderTotal(res.data.total);
        setOrderPage(res.data.pageNum);
      } else {
        setError(res.message || "加载交易失败");
      }
      setOrdersLoading(false);
    },
    [orderKeyword],
  );

  // 提交搜索:记住检索词并回到第 1 页。
  const searchOrders = () => {
    setOrderKeyword(orderQuery);
    loadOrders(1, orderQuery);
  };

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

  /* ── KPIs derived from real data ─────────────────────────────────────── */
  const kpis: Kpi[] = useMemo(() => {
    const enabled = channels.filter((c) => c.enabled).length;
    const todaySum = channels.reduce((s, c) => s + c.todayAmount, 0);
    return [
      { k: "支付渠道", v: String(channels.length) },
      { k: "启用中", v: String(enabled) },
      { k: "今日金额", v: yuan(todaySum) },
      { k: "交易笔数", v: orderTotal.toLocaleString("zh-CN") },
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
  // 校验/接口失败 return false → AdminModal 保持打开,用户输入不丢。
  const saveCh = async (): Promise<boolean> => {
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
    if (!dto.name || !dto.type) {
      toast.error(!dto.name ? "请填写渠道名称" : "请填写渠道类型");
      return false;
    }
    try {
      const res = editingCh
        ? await adminPaymentsApi.updateChannel(editingCh.id, dto)
        : await adminPaymentsApi.createChannel(dto);
      if (res.success) {
        setChOpen(false);
        loadChannels();
        return true;
      }
      toast.error(res.message || "保存渠道失败");
      return false;
    } catch {
      toast.error("保存渠道失败，请稍后重试");
      return false;
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

  /* ── order refund(账务标记 + 积分回收;二次确认)──────────────────── */
  const refundOrder = async (o: AdminOrder) => {
    if (
      !(await confirmDialog({
        title: "订单退款",
        message: `确定将订单「${o.orderNo}」标记为已退款？将按结算流水回收该订单授予的积分（余额不足收至 0）。渠道侧的原路退回需在支付渠道后台另行操作。`,
        confirmText: "退款",
      }))
    )
      return;
    const res = await adminPaymentsApi.refundOrder(o.id);
    if (res.success) {
      toast.success("已标记退款并回收积分");
      loadOrders(orderPage);
    } else {
      toast.error(res.message || "退款失败");
    }
  };

  return (
    <div className="adm-page">
      <StatCardGrid items={kpis} />

      {error ? (
        <div className="adm-panel">
          <p style={{ padding: "12px 18px", color: "var(--danger)", margin: 0 }}>{error}</p>
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
          <TableSkeleton />
        ) : channels.length === 0 ? (
          <div style={{ padding: 18 }} className="muted">
            暂无支付渠道，点击「接入渠道」添加。
          </div>
        ) : (
          <AdminTable<AdminPayChannel>
            rows={channels}
            rowKey={(r) => r.id}
            columns={[
              // fixed 表格必须显式分配列宽，回调 URL 是无空格长串，不截断会溢进状态列
              { header: "渠道", width: "14%", className: "strong", cell: (r) => r.name },
              { header: "类型", width: "10%", className: "muted", cell: (r) => r.type || "—" },
              { header: "费率", width: "8%", className: "mono", cell: (r) => pct(r.rate) },
              { header: "今日金额", width: "12%", className: "mono", cell: (r) => yuan(r.todayAmount) },
              {
                header: "回调",
                width: "34%",
                className: "muted",
                cell: (r) =>
                  r.callback ? (
                    <span className="mono truncate" title={r.callback}>
                      {r.callback}
                    </span>
                  ) : (
                    <span className="muted">未配置</span>
                  ),
              },
              {
                header: "状态",
                width: "8%",
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
                width: "14%",
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

      {/* 最近交易 (server-paged, 关键词搜索 + 账务退款) */}
      <Panel
        title="最近交易"
        sub="全部用户的真实订单流水"
        tools={
          <>
            <div className="adm-search" style={{ margin: 0 }}>
              <span className="muted">⌕</span>
              <input
                placeholder="订单号 / 交易号"
                value={orderQuery}
                onChange={(e) => setOrderQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") searchOrders();
                }}
              />
            </div>
            <button type="button" className="adm-btn ghost" onClick={searchOrders}>
              搜索
            </button>
            <button
              type="button"
              className="adm-btn ghost"
              onClick={() => loadOrders(orderPage)}
              disabled={ordersLoading}
            >
              刷新
            </button>
          </>
        }
      >
        {loading || ordersLoading ? (
          <TableSkeleton />
        ) : orders.length === 0 ? (
          <div style={{ padding: 18 }} className="muted">
            {orderKeyword ? `没有匹配「${orderKeyword}」的订单。` : "暂无交易记录。"}
          </div>
        ) : (
          <>
            <AdminTable<AdminOrder>
              rows={orders}
              rowKey={(r) => r.id}
              columns={[
                {
                  header: "订单号",
                  width: "18%",
                  className: "mono muted",
                  cell: (r) => (
                    <span className="truncate" title={r.orderNo}>
                      {r.orderNo}
                    </span>
                  ),
                },
                {
                  header: "用户",
                  width: "12%",
                  cell: (r) => r.user?.nickname || r.user?.username || r.userId,
                },
                { header: "套餐 / 商品", width: "14%", cell: (r) => orderItemLabel(r) },
                {
                  header: "金额",
                  width: "10%",
                  align: "right",
                  className: "mono strong",
                  cell: (r) => yuan(r.amount),
                },
                { header: "渠道", width: "8%", cell: (r) => r.payMethod || "—" },
                {
                  header: "时间",
                  width: "16%",
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
                {
                  header: "操作",
                  width: "9%",
                  align: "right",
                  // 仅已支付订单可退款;其余状态无操作。
                  cell: (r) =>
                    r.status === 1 ? (
                      <RowActions actions={[{ label: "退款", onClick: () => refundOrder(r) }]} />
                    ) : (
                      <span className="muted">—</span>
                    ),
                },
              ]}
              server={{
                page: orderPage,
                pageSize: ORDER_PAGE_SIZE,
                total: orderTotal,
                onPage: loadOrders,
              }}
            />
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
    </div>
  );
}
