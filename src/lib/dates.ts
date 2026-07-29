// Date helpers — all dates handled as YYYY-MM-DD strings (no TZ shenanigans)

export function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function fromISO(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(s: string, days: number): string {
  const d = fromISO(s);
  d.setDate(d.getDate() + days);
  return toISO(d);
}

export function formatHuman(s: string): string {
  const d = fromISO(s);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatRange(start: string, end: string): string {
  return `${formatHuman(start)} – ${formatHuman(end)}`;
}

/** Compact week-range label for chart axes, e.g. "May 10–16" or "Apr 28 – May 4". */
export function formatWeekShort(start: string, end: string): string {
  const s = fromISO(start), e = fromISO(end);
  const sMon = s.toLocaleDateString(undefined, { month: 'short' });
  const eMon = e.toLocaleDateString(undefined, { month: 'short' });
  return sMon === eMon
    ? `${sMon} ${s.getDate()}–${e.getDate()}`
    : `${sMon} ${s.getDate()} – ${eMon} ${e.getDate()}`;
}
