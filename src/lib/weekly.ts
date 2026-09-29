/** Weekly buckets for spend (allocated equal-daily) and outcome counts. */

type CostEvent = { amount_minor: number; occurred_at: string; period_start: string | null; period_end: string | null };

const DAY = 86400000;

export function weekStarts(from: Date, to: Date): Date[] {
  const start = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7)); // Monday
  const out: Date[] = [];
  for (let d = start; d < to; d = new Date(d.getTime() + 7 * DAY)) out.push(d);
  return out;
}

export function weekLabel(d: Date) {
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(d);
}

export function weeklySpend(events: CostEvent[], from: Date, to: Date) {
  const weeks = weekStarts(from, to);
  return weeks.map((w) => {
    const wEnd = new Date(Math.min(w.getTime() + 7 * DAY, to.getTime()));
    const wStart = new Date(Math.max(w.getTime(), from.getTime()));
    let total = 0;
    for (const e of events) {
      if (e.period_start && e.period_end) {
        const ps = new Date(`${e.period_start}T00:00:00Z`).getTime();
        const pe = new Date(`${e.period_end}T00:00:00Z`).getTime() + DAY;
        const overlap = Math.max(0, Math.min(pe, wEnd.getTime()) - Math.max(ps, wStart.getTime()));
        total += (Number(e.amount_minor) * overlap) / (pe - ps);
      } else {
        const t = new Date(e.occurred_at).getTime();
        if (t >= wStart.getTime() && t < wEnd.getTime()) total += Number(e.amount_minor);
      }
    }
    return { week: weekLabel(w), value: Math.round(total / 100) };
  });
}

export function weeklyCount(dates: Array<string | null>, from: Date, to: Date) {
  const weeks = weekStarts(from, to);
  return weeks.map((w) => {
    const s = Math.max(w.getTime(), from.getTime());
    const e = Math.min(w.getTime() + 7 * DAY, to.getTime());
    return { week: weekLabel(w), value: dates.filter((d) => d && new Date(d).getTime() >= s && new Date(d).getTime() < e).length };
  });
}
