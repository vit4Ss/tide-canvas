"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Coins, CreditCard, Loader2, Check, Smartphone,
} from "lucide-react";
import { orderApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const PACKAGES = [
  { amount: 10, points: 100 },
  { amount: 30, points: 300 },
  { amount: 50, points: 500 },
  { amount: 100, points: 1000 },
];

const PAYMENT_METHODS = [
  { key: "alipay", label: "支付宝", icon: CreditCard },
  { key: "wechat", label: "微信支付", icon: Smartphone },
];

export default function RechargePage() {
  const router = useRouter();
  const [selectedPackage, setSelectedPackage] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("alipay");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const finalAmount = selectedPackage !== null
    ? PACKAGES[selectedPackage].amount
    : Number(customAmount) || 0;

  const handleSelectPackage = (index: number) => {
    setSelectedPackage(index);
    setCustomAmount("");
  };

  const handleCustomAmountChange = (value: string) => {
    setCustomAmount(value);
    setSelectedPackage(null);
  };

  const handleSubmit = async () => {
    if (finalAmount <= 0) {
      setError("请选择充值金额");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const res = await orderApi.create({
        amount: finalAmount,
        paymentMethod,
      });
      if (res.success) {
        setSuccess(true);
      } else {
        setError(res.message || "创建订单失败");
      }
    } catch {
      setError("网络错误，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
        <div className="flex flex-col items-center justify-center py-16">
          <div className="rounded-full bg-green-100 p-4 dark:bg-green-900">
            <Check className="h-8 w-8 text-green-600 dark:text-green-400" />
          </div>
          <h2 className="mt-4 text-xl font-semibold">订单创建成功</h2>
          <p className="mt-2 text-sm text-neutral-500">
            订单已创建，请等待支付确认（管理员确认或自动回调）
          </p>
          <div className="mt-6 flex gap-3">
            <Button variant="outline" onClick={() => router.push("/user/orders")}>
              查看订单
            </Button>
            <Button onClick={() => router.push("/user/points")}>
              返回积分中心
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <Button variant="ghost" onClick={() => router.back()}>
        <ArrowLeft className="mr-1 h-4 w-4" />
        返回
      </Button>

      <h1 className="mt-4 text-2xl font-bold">充值积分</h1>
      <p className="mt-1 text-sm text-neutral-500">选择充值套餐或自定义金额</p>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Packages */}
      <div className="mt-6">
        <Label>选择套餐</Label>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {PACKAGES.map((pkg, index) => (
            <button
              key={index}
              onClick={() => handleSelectPackage(index)}
              className={`rounded-xl border-2 p-4 text-center transition-all ${
                selectedPackage === index
                  ? "border-blue-500 bg-blue-50 dark:bg-blue-950/30"
                  : "border-neutral-200 bg-white hover:border-neutral-300 dark:border-neutral-800 dark:bg-neutral-950 dark:hover:border-neutral-700"
              }`}
            >
              <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                {pkg.points}
              </p>
              <p className="text-xs text-neutral-500">积分</p>
              <div className="mt-2 rounded-full bg-neutral-100 px-2 py-0.5 text-sm font-medium dark:bg-neutral-800">
                {pkg.amount} 元
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Custom Amount */}
      <div className="mt-6 space-y-2">
        <Label htmlFor="customAmount">自定义金额（元）</Label>
        <Input
          id="customAmount"
          type="number"
          placeholder="输入自定义充值金额"
          value={customAmount}
          onChange={(e) => handleCustomAmountChange(e.target.value)}
          min={1}
        />
        {customAmount && Number(customAmount) > 0 && (
          <p className="text-sm text-neutral-500">
            将获得 <span className="font-semibold text-blue-600">{Number(customAmount) * 10}</span> 积分
          </p>
        )}
      </div>

      {/* Payment Method */}
      <div className="mt-6">
        <Label>支付方式</Label>
        <div className="mt-3 flex gap-3">
          {PAYMENT_METHODS.map((method) => (
            <button
              key={method.key}
              onClick={() => setPaymentMethod(method.key)}
              className={`flex flex-1 items-center gap-2 rounded-xl border-2 p-4 transition-all ${
                paymentMethod === method.key
                  ? "border-blue-500 bg-blue-50 dark:bg-blue-950/30"
                  : "border-neutral-200 bg-white hover:border-neutral-300 dark:border-neutral-800 dark:bg-neutral-950 dark:hover:border-neutral-700"
              }`}
            >
              <method.icon className="h-5 w-5" />
              <span className="font-medium">{method.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Summary + Submit */}
      <div className="mt-8 rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-950">
        <div className="flex items-center justify-between">
          <span className="text-neutral-500">充值金额</span>
          <span className="text-lg font-bold">{finalAmount} 元</span>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <span className="text-neutral-500">获得积分</span>
          <span className="text-lg font-bold text-blue-600 dark:text-blue-400">
            {finalAmount * 10} 积分
          </span>
        </div>
        <Button
          className="mt-4 w-full"
          size="lg"
          onClick={handleSubmit}
          disabled={finalAmount <= 0 || submitting}
        >
          {submitting ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Coins className="mr-1 h-4 w-4" />
          )}
          确认充值
        </Button>
      </div>
    </div>
  );
}
