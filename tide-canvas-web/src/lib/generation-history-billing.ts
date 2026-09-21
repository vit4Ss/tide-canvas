type HistoryCost = { pointCost?: number; refundedPoints?: number };

export function generationNetPoints(record: HistoryCost): number | null {
  if (record.pointCost == null || !Number.isFinite(record.pointCost)) return null;
  return Math.max(0, record.pointCost - Math.max(0, record.refundedPoints ?? 0));
}

export function generationRefundNote(record: HistoryCost): string {
  if ((record.refundedPoints ?? 0) > 0) return `已退回 ${record.refundedPoints} 积分，详见积分流水。`;
  if (record.pointCost === 0) return "本次未扣除积分。";
  return "请以积分流水中的实际扣费和退款为准。";
}
