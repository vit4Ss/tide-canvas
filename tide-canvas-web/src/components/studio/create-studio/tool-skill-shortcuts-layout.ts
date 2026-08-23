export function visibleShortcutCount(
  containerWidth: number,
  labelWidth: number,
  moreWidth: number,
  buttonWidths: readonly number[],
  gap: number,
): number {
  if (
    !Number.isFinite(containerWidth) || containerWidth <= 0 ||
    !Number.isFinite(labelWidth) || labelWidth < 0 ||
    !Number.isFinite(moreWidth) || moreWidth < 0
  ) return 0;
  const safeGap = Number.isFinite(gap) ? Math.max(0, gap) : 0;
  // With no skill there is still one gap between the label and “more”. Each
  // admitted skill contributes its own width plus one additional gap.
  let used = labelWidth + moreWidth + safeGap;
  let count = 0;
  for (const width of buttonWidths) {
    if (!Number.isFinite(width) || width <= 0 || used+safeGap+width > containerWidth+0.5) break;
    used += safeGap + width;
    count++;
  }
  return count;
}
