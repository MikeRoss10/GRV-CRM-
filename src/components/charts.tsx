import clsx from "clsx";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";

/** KPI tile: value, comparison and the denominator always visible (not hover-only). */
export function MetricCard({
  label, value, delta, deltaGoodWhen = "up", sub, title, warn,
}: {
  label: string;
  value: ReactNode;
  delta?: number | null;
  deltaGoodWhen?: "up" | "down";
  sub?: ReactNode;
  title?: string;
  warn?: ReactNode;
}) {
  const good = delta === null || delta === undefined ? null : deltaGoodWhen === "up" ? delta >= 0 : delta <= 0;
  return (
    <div className="card flex flex-col gap-1 p-4" title={title}>
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className="text-2xl font-semibold tracking-tight text-ink tnum">{value}</div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
        {delta !== null && delta !== undefined && (
          <span className={clsx("inline-flex items-center gap-0.5 font-medium tnum", good ? "text-teal-700" : "text-crit-700")}>
            {delta >= 0 ? <ArrowUpRight className="size-3.5" aria-hidden /> : <ArrowDownRight className="size-3.5" aria-hidden />}
            {Math.abs(Math.round(delta * 100))}%
            <span className="sr-only">{delta >= 0 ? "increase" : "decrease"} vs previous period</span>
          </span>
        )}
        {sub}
      </div>
      {warn && <div className="mt-1 text-xs font-medium text-amber-700">{warn}</div>}
    </div>
  );
}

/** Funnel as horizontal bars: one hue, exact counts and step conversion as direct labels. */
export function FunnelBars({ steps, color = "#2a78d6" }: { steps: Array<{ label: string; value: number }>; color?: string }) {
  const max = Math.max(1, steps[0]?.value ?? 1);
  return (
    <ol className="space-y-2.5">
      {steps.map((s, i) => {
        const prev = i > 0 ? steps[i - 1].value : null;
        const conv = prev ? Math.round((s.value / prev) * 100) : null;
        return (
          <li key={s.label} className="grid grid-cols-[6.5rem_1fr_5.5rem] items-center gap-3 text-sm" title={`${s.label}: ${s.value}${conv !== null ? ` (${conv}% of ${steps[i - 1].label.toLowerCase()})` : ""}`}>
            <span className="text-muted">{s.label}</span>
            <span className="h-3 rounded-r bg-stone-100">
              <span className="block h-full rounded-r" style={{ width: `${Math.max(s.value ? 2 : 0, (s.value / max) * 100)}%`, background: color }} />
            </span>
            <span className="text-right tnum">
              <span className="font-medium text-ink">{s.value}</span>
              {conv !== null && <span className="ml-1.5 text-xs text-faint">{conv}%</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Horizontal bars ranked by value; unknown values listed with a reason, never drawn as zero. */
export function RankedBars({
  rows, format, color = "#2a78d6", emptyLabel = "Unknown",
}: {
  rows: Array<{ key: string; label: ReactNode; value: number | null; note?: string }>;
  format: (v: number) => string;
  color?: string;
  emptyLabel?: string;
}) {
  const known = rows.filter((r) => r.value !== null) as Array<{ key: string; label: ReactNode; value: number; note?: string }>;
  const max = Math.max(1, ...known.map((r) => r.value));
  const sorted = [...known].sort((a, b) => b.value - a.value);
  const unknown = rows.filter((r) => r.value === null);
  return (
    <ul className="space-y-2.5">
      {sorted.map((r) => (
        <li key={r.key} className="grid grid-cols-[7.5rem_1fr_5.5rem] items-center gap-3 text-sm" title={r.note}>
          <span className="truncate">{r.label}</span>
          <span className="h-3 rounded-r bg-stone-100">
            <span className="block h-full rounded-r" style={{ width: `${Math.max(2, (r.value / max) * 100)}%`, background: color }} />
          </span>
          <span className="text-right font-medium tnum">{format(r.value)}</span>
        </li>
      ))}
      {unknown.map((r) => (
        <li key={r.key} className="grid grid-cols-[7.5rem_1fr_5.5rem] items-center gap-3 text-sm" title={r.note}>
          <span className="truncate">{r.label}</span>
          <span className="truncate text-xs text-faint">{r.note}</span>
          <span className="text-right text-xs font-medium text-amber-700">{emptyLabel}</span>
        </li>
      ))}
    </ul>
  );
}
