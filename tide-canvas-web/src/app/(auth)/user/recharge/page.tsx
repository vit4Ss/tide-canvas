"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Coins, Loader2, Check, Info, Ticket, Headphones } from "lucide-react";
import { orderApi, redeemApi } from "@/lib/api";
import { toast } from "@/components/shared/toast";

// 与后端 points.recharge.ratio 默认一致：1 元 = 100 积分（实际到账由后端按此比例计算）
const RATIO = 100;
const AMOUNTS = [10, 100, 500, 1000, 2000, 5000, 10000];

export default function RechargePage() {
  const router = useRouter();
  const [tab, setTab] = useState<"member" | "points">("points");
  const [buying, setBuying] = useState<number | null>(null);
  const [success, setSuccess] = useState(false);
  const [redeemCode, setRedeemCode] = useState("");
  const [redeeming, setRedeeming] = useState(false);

  const handleBuy = async (amount: number) => {
    if (buying !== null) return;
    setBuying(amount);
    try {
      const res = await orderApi.create({ amount, paymentMethod: "alipay" });
      if (res.success) setSuccess(true);
      else toast.error(res.message || "创建订单失败");
    } catch {
      toast.error("网络错误，请稍后重试");
    } finally {
      setBuying(null);
    }
  };

  const handleRedeem = async () => {
    const c = redeemCode.trim();
    if (!c || redeeming) return;
    setRedeeming(true);
    try {
      const res = await redeemApi.redeem(c);
      if (res.success) {
        toast.success(`兑换成功，获得 ${res.data.points} 积分（余额 ${res.data.balance}）`);
        setRedeemCode("");
      } else {
        toast.error(res.message || "兑换失败");
      }
    } catch {
      toast.error("兑换失败，请稍后重试");
    } finally {
      setRedeeming(false);
    }
  };

  if (success) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/40">
          <Check className="h-8 w-8 text-green-600 dark:text-green-400" />
        </div>
        <h2 className="mt-4 text-xl font-semibold">订单创建成功</h2>
        <p className="mt-2 text-sm text-neutral-500">订单已创建，请等待支付确认（管理员确认或自动回调）后积分到账</p>
        <div className="mt-6 flex justify-center gap-3">
          <button onClick={() => router.push("/user/orders")} className="rounded-lg border border-neutral-200 px-4 py-2 text-sm font-medium hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800">查看订单</button>
          <button onClick={() => router.push("/user/points")} className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900">返回积分中心</button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      {/* 标题 + 返回 */}
      <div className="relative mb-6 flex items-center justify-center">
        <button onClick={() => router.back()} className="absolute left-0 flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200">
          <ArrowLeft className="h-4 w-4" /> 返回
        </button>
        <h1 className="text-xl font-bold">轻松购买，极致体验</h1>
      </div>

      {/* 会员 / 积分 切换 */}
      <div className="mx-auto mb-6 flex w-fit rounded-lg bg-neutral-100 p-1 dark:bg-neutral-800">
        <button
          onClick={() => setTab("member")}
          className={`rounded-md px-10 py-1.5 text-sm font-medium transition-colors ${tab === "member" ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-white" : "text-neutral-500"}`}
        >
          会员
        </button>
        <button
          onClick={() => setTab("points")}
          className={`rounded-md px-10 py-1.5 text-sm font-medium transition-colors ${tab === "points" ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-white" : "text-neutral-500"}`}
        >
          积分
        </button>
      </div>

      {tab === "member" ? (
        <div className="py-20 text-center text-sm text-neutral-400">会员功能即将上线，敬请期待</div>
      ) : (
        <>
          {/* 温馨提示 */}
          <div className="mb-6 flex items-center gap-2 rounded-xl bg-neutral-100 px-4 py-3 text-sm text-neutral-500 dark:bg-neutral-800/60">
            <Info className="h-4 w-4 shrink-0 text-neutral-400" />
            温馨提示：积分自购入之日起，有效期 2 年
          </div>

          {/* 积分套餐网格 */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {AMOUNTS.map((amount) => (
              <div key={amount} className="rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
                <div className="flex items-center gap-1.5 text-base font-semibold">
                  <Coins className="h-4 w-4 text-amber-500" />
                  {(amount * RATIO).toLocaleString()} 积分
                </div>
                <div className="mt-3 text-3xl font-bold">¥{amount}</div>
                <button
                  onClick={() => handleBuy(amount)}
                  disabled={buying !== null}
                  className="mt-5 flex w-full items-center justify-center gap-1.5 rounded-lg bg-red-500 py-2 text-sm font-medium text-white transition-colors hover:bg-red-600 disabled:opacity-60"
                >
                  {buying === amount ? <Loader2 className="h-4 w-4 animate-spin" /> : "立即购买"}
                </button>
              </div>
            ))}

            {/* 更大额充值 */}
            <div className="flex flex-col justify-between rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
              <div className="text-2xl font-bold">更大额充值</div>
              <button
                onClick={() => toast.info("请联系客服获取大额充值折扣")}
                className="mt-5 flex w-full items-center justify-center gap-1.5 rounded-lg bg-red-500 py-2 text-sm font-medium text-white transition-colors hover:bg-red-600"
              >
                <Headphones className="h-4 w-4" /> 联系客服获取折扣
              </button>
            </div>
          </div>

          {/* 兑换码（精简置底） */}
          <div className="mt-8 flex flex-wrap items-center gap-2">
            <Ticket className="h-4 w-4 shrink-0 text-pink-500" />
            <input
              value={redeemCode}
              onChange={(e) => setRedeemCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => { if (e.key === "Enter") handleRedeem(); }}
              placeholder="有兑换码？输入直接兑换积分"
              className="w-full max-w-xs flex-1 rounded-lg border border-neutral-200 px-3 py-2 font-mono uppercase tracking-wider outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900"
            />
            <button
              onClick={handleRedeem}
              disabled={redeeming || !redeemCode.trim()}
              className="flex items-center gap-1.5 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-white dark:text-neutral-900"
            >
              {redeeming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ticket className="h-4 w-4" />}
              兑换
            </button>
          </div>
        </>
      )}
    </div>
  );
}
