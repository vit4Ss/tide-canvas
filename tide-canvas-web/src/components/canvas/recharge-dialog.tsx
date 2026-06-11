"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Coins, Headphones, Loader2, Ticket, WalletCards } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { orderApi, redeemApi } from "@/lib/api";
import { submitPayForm } from "@/lib/pay";
import { toast } from "@/components/shared/toast";
import { useAuthStore } from "@/stores/use-auth-store";
import { PAY_TYPE_NAMES, type RechargeConfigVO, type RechargeOrderVO } from "@/types/order";

const DEFAULT_RATIO = 100;
const AMOUNTS = [10, 100, 500, 1000, 2000, 5000];

interface RechargeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RechargeDialog({ open, onOpenChange }: RechargeDialogProps) {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const [buying, setBuying] = useState<number | null>(null);
  const [createdOrder, setCreatedOrder] = useState<RechargeOrderVO | null>(null);
  const [paidOnline, setPaidOnline] = useState(false);
  const [redeemCode, setRedeemCode] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const [config, setConfig] = useState<RechargeConfigVO | null>(null);
  const [payType, setPayType] = useState<string>("");

  const ratio = config?.ratio ?? DEFAULT_RATIO;
  const onlinePay = config?.onlinePayEnabled ?? false;
  const payTypes = config?.payTypes ?? [];

  useEffect(() => {
    if (!open || config) return;
    orderApi.rechargeConfig().then((res) => {
      if (res.success && res.data) {
        setConfig(res.data);
        if (res.data.payTypes.length > 0) setPayType(res.data.payTypes[0]);
      }
    }).catch(() => {});
  }, [open, config]);

  const handleBuy = async (amount: number) => {
    if (buying !== null) return;
    setBuying(amount);
    try {
      const res = await orderApi.create({ amount, paymentMethod: onlinePay ? payType : "alipay" });
      if (!res.success) {
        toast.error(res.message || "创建订单失败");
        return;
      }
      if (onlinePay) {
        const payRes = await orderApi.pay(res.data.id, payType || undefined);
        if (payRes.success && payRes.data) {
          // 新标签页打开收银台，画布状态不丢失
          submitPayForm(payRes.data, { newTab: true });
          setPaidOnline(true);
        } else {
          toast.error(payRes.message || "发起支付失败，可在我的订单中重试");
        }
      } else {
        toast.success("订单已创建");
      }
      setCreatedOrder(res.data);
    } catch {
      toast.error("网络错误，请稍后重试");
    } finally {
      setBuying(null);
    }
  };

  const handleRedeem = async () => {
    const code = redeemCode.trim();
    if (!code || redeeming) return;
    setRedeeming(true);
    try {
      const res = await redeemApi.redeem(code);
      if (res.success) {
        if (user) setUser({ ...user, points: res.data.balance });
        setRedeemCode("");
        toast.success(`兑换成功，获得 ${res.data.points} 积分`);
      } else {
        toast.error(res.message || "兑换失败");
      }
    } catch {
      toast.error("兑换失败，请稍后重试");
    } finally {
      setRedeeming(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto p-0 sm:max-w-2xl">
        <div className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <WalletCards className="h-5 w-5 text-amber-500" />
              订购积分
            </DialogTitle>
            <DialogDescription>
              当前余额 {user?.points ?? 0} 积分，充值订单确认后积分到账。
            </DialogDescription>
          </DialogHeader>
        </div>

        {createdOrder ? (
          <div className="px-5 py-6 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/40">
              <Check className="h-7 w-7 text-green-600 dark:text-green-400" />
            </div>
            <h3 className="mt-4 text-base font-semibold">
              {paidOnline ? "请在新窗口完成支付" : "订单已创建"}
            </h3>
            <p className="mt-2 text-sm text-neutral-500">
              {paidOnline
                ? `订单号 ${createdOrder.orderNo}，支付完成后 ${createdOrder.pointsAmount.toLocaleString()} 积分将自动到账。`
                : `订单号 ${createdOrder.orderNo}，等待支付确认后到账 ${createdOrder.pointsAmount.toLocaleString()} 积分。`}
            </p>
            <div className="mt-6 flex justify-center gap-2">
              <button
                onClick={() => { setCreatedOrder(null); setPaidOnline(false); }}
                className="rounded-lg border border-neutral-200 px-4 py-2 text-sm font-medium hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
              >
                继续充值
              </button>
              <Link
                href="/user/orders"
                className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
              >
                查看订单
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-5 px-5 pb-5 pt-4">
            {onlinePay && payTypes.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-neutral-500">支付方式：</span>
                {payTypes.map((t) => (
                  <button
                    key={t}
                    onClick={() => setPayType(t)}
                    className={`rounded-lg border px-3 py-1 text-sm font-medium transition-colors ${
                      payType === t
                        ? "border-amber-500 bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                        : "border-neutral-200 text-neutral-600 hover:border-neutral-400 dark:border-neutral-700 dark:text-neutral-300"
                    }`}
                  >
                    {PAY_TYPE_NAMES[t] || t}
                  </button>
                ))}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {AMOUNTS.map((amount) => (
                <button
                  key={amount}
                  onClick={() => handleBuy(amount)}
                  disabled={buying !== null}
                  className="group rounded-lg border border-neutral-200 bg-white p-4 text-left transition-colors hover:border-amber-300 hover:bg-amber-50/50 disabled:opacity-60 dark:border-neutral-800 dark:bg-neutral-950 dark:hover:border-amber-700 dark:hover:bg-amber-950/20"
                >
                  <div className="flex items-center gap-1.5 text-sm font-semibold">
                    <Coins className="h-4 w-4 text-amber-500" />
                    {(amount * ratio).toLocaleString()} 积分
                  </div>
                  <div className="mt-3 flex items-end justify-between">
                    <span className="text-2xl font-bold">¥{amount}</span>
                    {buying === amount ? (
                      <Loader2 className="h-4 w-4 animate-spin text-neutral-500" />
                    ) : (
                      <span className="text-xs font-medium text-neutral-500 group-hover:text-amber-700 dark:group-hover:text-amber-300">
                        购买
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>

            <button
              onClick={() => toast.info("请联系客服获取大额充值折扣")}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-neutral-200 px-4 py-3 text-sm font-medium hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900"
            >
              <Headphones className="h-4 w-4" />
              更大额充值
            </button>

            <div className="flex flex-col gap-2 border-t border-neutral-200 pt-4 dark:border-neutral-800 sm:flex-row">
              <div className="relative flex-1">
                <Ticket className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-pink-500" />
                <input
                  value={redeemCode}
                  onChange={(e) => setRedeemCode(e.target.value.toUpperCase())}
                  onKeyDown={(e) => { if (e.key === "Enter") handleRedeem(); }}
                  placeholder="输入兑换码"
                  className="h-10 w-full rounded-lg border border-neutral-200 bg-white pl-9 pr-3 font-mono text-sm uppercase tracking-wider outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-950"
                />
              </div>
              <button
                onClick={handleRedeem}
                disabled={redeeming || !redeemCode.trim()}
                className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-neutral-900 px-4 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
              >
                {redeeming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ticket className="h-4 w-4" />}
                兑换
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
