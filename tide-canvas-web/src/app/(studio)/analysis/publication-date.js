/**
 * Parse platform dates without turning YYYYMMDD into epoch seconds or missing
 * dates into January 2000. Day-only values use UTC for stable calendar axes;
 * callers must format those with UTC and must not infer a publication hour.
 * @param {string | undefined} value
 * @returns {{ timestamp: number, hasTime: boolean } | null}
 */
export function parsePublicationDate(value) {
  const source = value?.trim();
  if (!source) return null;
  if (/^(?:\d{10}|\d{13})$/.test(source)) {
    const timestamp = Number(source) * (source.length === 10 ? 1000 : 1);
    return timestamp > 0 && Number.isFinite(new Date(timestamp).valueOf()) ? { timestamp, hasTime: true } : null;
  }
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(source);
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(source);
  const parts = compact || iso;
  if (!parts) return null;
  const year = Number(parts[1]), month = Number(parts[2]), day = Number(parts[3]);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) return null;
  const hasTime = !!iso?.[4];
  if (!hasTime) return { timestamp: calendar.valueOf(), hasTime: false };
  if (Number(iso[4]) > 23 || Number(iso[5]) > 59 || Number(iso[6] || 0) > 59) return null;
  const timestamp = new Date(source.replace(' ', 'T')).valueOf();
  return Number.isFinite(timestamp) ? { timestamp, hasTime: true } : null;
}
