"use client";

import { useState } from "react";
import { AdminAlert, AdminModal, Field, FormGrid } from "@/components/admin";
import type { ChatModelVO, ChatTokenPricing } from "@/types/admin-chat-providers";

export function ChatPriceEditor({ model, multiplier, disabled, save, onClose }: {
  model: ChatModelVO;
  multiplier: string;
  disabled: boolean;
  save: (pricing: ChatTokenPricing) => Promise<boolean>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<ChatTokenPricing>(() => model.pricing ? { ...model.pricing } : { enabled: true, inputPointsPerMillion: "", outputPointsPerMillion: "", maxInputTokens: 131072, maxOutputTokens: 8192 });
  const [error, setError] = useState("");
  return <AdminModal open onClose={onClose} title={`${model.name || model.modelKey} · 价格`} subtitle={`基准单价（积分 / 百万 Token）× 供应商倍率 ${multiplier.trim() || "1"} = 实际扣费单价`} saveDisabled={disabled} onSave={async () => {
      const input = draft.inputPointsPerMillion.trim();
      const output = draft.outputPointsPerMillion.trim();
      const cached = draft.cachedInputPointsPerMillion?.trim() || "";
      const rates = [input, output, ...(cached ? [cached] : [])];
      if (rates.some((rate) => rate === "" || !Number.isFinite(Number(rate)) || Number(rate) < 0 || Number(rate) > 1000000000)) {
        setError("请填写有效的非负单价，缓存单价可留空。单价最多支持六位小数。"); return false;
      }
      const limits = [[draft.maxInputTokens ?? 131072, 10000000], [draft.maxOutputTokens ?? 8192, 1000000]];
      if (limits.some(([value, max]) => !Number.isInteger(value) || value < 1 || value > max)) {
        setError("Token 上限需要填写正整数：输入最多 10000000，输出最多 1000000。"); return false;
      }
      setError("");
      return save({ ...draft, enabled: true, inputPointsPerMillion: input, outputPointsPerMillion: output, cachedInputPointsPerMillion: cached });
    }}>
      {error && <AdminAlert tone="error" title="请检查价格配置">{error}</AdminAlert>}
      <fieldset disabled={disabled} className="cp-price-fields">
      <FormGrid>
        <Field label="输入单价" span={2} hint="积分 / 百万 Token"><input aria-label="输入基准单价" inputMode="decimal" value={draft.inputPointsPerMillion} onChange={(e) => setDraft({ ...draft, inputPointsPerMillion: e.target.value })} /></Field>
        <Field label="输出单价" span={2} hint="积分 / 百万 Token"><input aria-label="输出基准单价" inputMode="decimal" value={draft.outputPointsPerMillion} onChange={(e) => setDraft({ ...draft, outputPointsPerMillion: e.target.value })} /></Field>
        <Field label="缓存读取单价" span={4} hint="积分 / 百万 Token，留空时沿用输入单价"><input aria-label="缓存读取基准单价" inputMode="decimal" value={draft.cachedInputPointsPerMillion ?? ""} onChange={(e) => setDraft({ ...draft, cachedInputPointsPerMillion: e.target.value })} /></Field>
        <Field label="输入 Token 上限" span={2}><input aria-label="输入 Token 上限" type="number" min={1} max={10000000} value={draft.maxInputTokens ?? 131072} onChange={(e) => setDraft({ ...draft, maxInputTokens: Number(e.target.value) })} /></Field>
        <Field label="输出 Token 上限" span={2}><input aria-label="输出 Token 上限" type="number" min={1} max={1000000} value={draft.maxOutputTokens ?? 8192} onChange={(e) => setDraft({ ...draft, maxOutputTokens: Number(e.target.value) })} /></Field>
      </FormGrid>
      </fieldset>
    </AdminModal>;
}
