/** Individual historical messages; the current prompt is sent separately. */
export const TEXT_HISTORY_LIMIT = 3;

export function recentTextHistory<T>(messages: readonly T[]): T[] {
  return messages.slice(-TEXT_HISTORY_LIMIT);
}
