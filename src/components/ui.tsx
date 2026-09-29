import Link from "next/link";
import clsx from "clsx";
import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Clock, Info, XCircle } from "lucide-react";
import { humanize, minutes } from "@/lib/format";
import { SOURCE_LABELS, type SourceType } from "@/lib/parsers";

/* Categorical source colors: fixed per source (identity), never by rank. Validated default palette. */
export const SOURCE_COLORS: Record<string, string> = {
  justdial: "#2a78d6",
  sulekha: "#eb6834",
  "91acres": "#1baf7a",
  meta_ads: "#eda100",
  google_ads: "#e87ba4",
  website: "#008300",
  referral: "#4a3aa7",
  walk_in: "#e34948",
  other: "#8b909a",
};

export function SourceBadge({ type, name, className }: { type: string; name?: string; className?: string }) {
  return (
    <span className={clsx("inline-flex items-center gap-1.5 text-sm text-ink", className)}>
      <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: SOURCE_COLORS[type] ?? SOURCE_COLORS.other }} />
      {name ?? SOURCE_LABELS[type as SourceType] ?? humanize(type)}
    </span>
  );
}

const STATUS_STYLE: Record<string, string> = {
  new: "bg-sky-100 text-sky-700",
  assigned: "bg-navy-100 text-navy-800",
  attempting_contact: "bg-amber-50 text-amber-700 ring-1 ring-amber-100",
  contacted: "bg-teal-50 text-teal-700",
  qualified: "bg-teal-100 text-teal-700",
  appointment: "bg-teal-100 text-teal-700",
  proposal: "bg-teal-100 text-teal-700",
  won: "bg-teal-600 text-white",
  lost: "bg-stone-100 text-stone-600",
  nurture: "bg-navy-50 text-navy-700",
  invalid: "bg-stone-100 text-stone-500",
  duplicate: "bg-stone-100 text-stone-500",
  spam: "bg-stone-100 text-stone-500",
  do_not_contact: "bg-crit-100 text-crit-700",
};

export const STATUS_LABEL: Record<string, string> = {
  new: "New",
  assigned: "Assigned",
  attempting_contact: "Attempting",
  contacted: "Contacted",
  qualified: "Qualified",
  appointment: "Appointment",
  proposal: "Proposal",
  won: "Won",
  lost: "Lost",
  nurture: "Nurture",
  invalid: "Invalid",
  duplicate: "Duplicate",
  spam: "Spam",
  do_not_contact: "Do not contact",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={clsx("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap", STATUS_STYLE[status] ?? "bg-stone-100")}>
      {STATUS_LABEL[status] ?? humanize(status)}
    </span>
  );
}

type Tone = "neutral" | "teal" | "amber" | "crit" | "navy" | "sky";
const TONE: Record<Tone, string> = {
  neutral: "bg-stone-100 text-stone-700",
  teal: "bg-teal-50 text-teal-700",
  amber: "bg-amber-50 text-amber-700",
  crit: "bg-crit-50 text-crit-700",
  navy: "bg-navy-50 text-navy-700",
  sky: "bg-sky-100 text-sky-700",
};

export function Badge({ tone = "neutral", children, className, title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={clsx("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap", TONE[tone], className)}>
      {children}
    </span>
  );
}

/** SLA clock: the age of a lead, colored and labelled by SLA state (never color alone). */
export function AgeClock({ receivedAt, respondedAt, slaMinutes, now }: { receivedAt: string; respondedAt: string | null; slaMinutes: number; now: number }) {
  const start = new Date(receivedAt).getTime();
  const age = ((respondedAt ? new Date(respondedAt).getTime() : now) - start) / 60000;
  const state = respondedAt ? (age <= slaMinutes ? "met" : "late") : age > slaMinutes ? "breached" : age > slaMinutes * 0.6 ? "risk" : "ok";
  const tone = { ok: "text-sky-700", risk: "text-amber-700", breached: "text-crit-700", met: "text-teal-700", late: "text-muted" }[state];
  const label = { ok: "within SLA", risk: "SLA at risk", breached: "SLA breached", met: "responded within SLA", late: "responded after SLA" }[state];
  const Icon = state === "breached" ? AlertTriangle : state === "met" ? CheckCircle2 : Clock;
  return (
    <span className={clsx("inline-flex items-center gap-1 text-xs font-medium tnum", tone)} title={`${label} · SLA ${slaMinutes} min`}>
      <Icon className="size-3.5" aria-hidden />
      {minutes(age).replace(" min", "m")}
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function PageHeader({ title, description, actions, eyebrow }: { title: string; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-sm text-muted">{eyebrow}</div>}
        <h1 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      {icon && <div className="mb-3 rounded-full bg-navy-50 p-3 text-navy-700">{icon}</div>}
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {children && <div className="mt-1 max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Notice({ tone = "amber", title, children, action }: { tone?: "amber" | "crit" | "teal" | "navy"; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  const styles = {
    amber: "border-amber-100 bg-amber-50 text-amber-700",
    crit: "border-crit-100 bg-crit-50 text-crit-700",
    teal: "border-teal-100 bg-teal-50 text-teal-700",
    navy: "border-navy-100 bg-navy-50 text-navy-800",
  }[tone];
  const Icon = tone === "crit" ? XCircle : tone === "teal" ? CheckCircle2 : tone === "navy" ? Info : AlertTriangle;
  return (
    <div className={clsx("flex items-start gap-3 rounded-xl border px-4 py-3 text-sm", styles)} role="status">
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="font-medium">{title}</div>
        {children && <div className="mt-0.5 opacity-90">{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function Tabs({ items, active }: { items: Array<{ key: string; label: string; href: string; count?: number }>; active: string }) {
  return (
    <nav className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" aria-label="Views">
      {items.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === active ? "page" : undefined}
          className={clsx(
            "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors",
            t.key === active ? "bg-navy-900 text-white" : "text-muted hover:bg-white hover:text-ink",
          )}
        >
          {t.label}
          {t.count !== undefined && (
            <span className={clsx("rounded px-1.5 text-xs tnum", t.key === active ? "bg-white/15" : "bg-stone-200/70")}>{t.count}</span>
          )}
        </Link>
      ))}
    </nav>
  );
}

export function ConfidenceMeter({ value }: { value: number | null }) {
  if (value === null || value === undefined) return <span className="text-xs text-faint">—</span>;
  const p = Math.round(value * 100);
  const tone = p >= 90 ? "bg-teal-600" : p >= 80 ? "bg-teal-500" : "bg-amber-500";
  return (
    <span className="inline-flex items-center gap-2 text-xs text-muted tnum">
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-stone-200" aria-hidden>
        <span className={clsx("block h-full rounded-full", tone)} style={{ width: `${p}%` }} />
      </span>
      {p}%{p < 80 && <span className="text-amber-700">· review</span>}
    </span>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h2 className="eyebrow">{children}</h2>
      {action}
    </div>
  );
}
