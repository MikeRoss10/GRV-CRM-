import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { FunnelBars, MetricCard } from "@/components/charts";
import { RangeSelect } from "@/components/range-select";
import { Badge, SectionTitle, SourceBadge, StatusBadge, SOURCE_COLORS } from "@/components/ui";
import { resolveRange } from "@/lib/dates";
import { getEconomics } from "@/lib/economics";
import { ago, dateOnly, humanize, maskPhone, minutes, money, pct } from "@/lib/format";
import { DECISION_LABEL } from "@/lib/metrics";
import { requireWorkspace } from "@/lib/workspace";

export default async function SourceDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ range?: string }> }) {
  const { id } = await params;
  const range = resolveRange((await searchParams).range, "90d");
  const { supabase, workspace } = await requireWorkspace();
  const cur = workspace.default_currency;
  const { rows } = await getEconomics(range.from.toISOString(), range.to.toISOString());
  const r = rows.find((x) => x.source_account_id === id);
  if (!r) notFound();

  const [{ data: costs }, { data: leads }] = await Promise.all([
    supabase.from("cost_events").select("*").eq("source_account_id", id).is("opportunity_id", null).order("occurred_at", { ascending: false }).limit(50),
    supabase.from("opportunities").select("id, title, status, received_at, first_response_at, revenue_minor, duplicate_status, contacts(full_name, phone_e164), source_touches!inner(source_account_id)")
      .eq("workspace_id", workspace.id).eq("source_touches.source_account_id", id).gte("received_at", range.from.toISOString()).order("received_at", { ascending: false }).limit(60),
  ]);

  return (
    <div className="space-y-5">
      <Link href={`/economics?range=${range.key}`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4" aria-hidden />Source Economics</Link>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl"><SourceBadge type={r.source_type} name={r.display_name} className="!text-xl sm:!text-2xl" /></h1>
          <p className="mt-1 flex items-center gap-2 text-sm text-muted">Recommendation: <Badge tone="navy">{DECISION_LABEL[r.decision]}</Badge></p>
        </div>
        <RangeSelect fallback="90d" />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Spend" value={r.spend_minor === null ? "Unknown" : money(r.spend_minor, cur)} sub={<span>{r.cost_event_count} cost entries{r.spend_has_allocated ? " · part allocated" : ""}</span>} />
        <MetricCard label="Cost per lead" value={money(r.cpl, cur)} sub={<span>{r.leads} leads</span>} />
        <MetricCard label="Cost per qualified" value={money(r.cpql, cur)} sub={<span>{r.qualified} qualified ({pct(r.qualified, r.leads)})</span>} />
        <MetricCard label="CAC" value={r.cac === null ? "—" : money(r.cac, cur)} sub={<span>{r.wins} wins · {money(r.revenue_minor, cur, { compact: true })} revenue</span>} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card p-4">
          <SectionTitle>Why {DECISION_LABEL[r.decision].toLowerCase()}?</SectionTitle>
          <ul className="list-disc space-y-1 pl-5 text-sm">{r.reasons.map((x) => <li key={x}>{x}</li>)}</ul>
          <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
            <dt className="text-muted">Median first response</dt><dd className="tnum">{minutes(r.median_response_minutes)}</dd>
            <dt className="text-muted">Answered within SLA</dt><dd className="tnum">{r.sla_met} of {r.leads} ({pct(r.sla_met, r.leads)})</dd>
            <dt className="text-muted">Probable duplicates</dt><dd className="tnum">{r.duplicates_probable}</dd>
            <dt className="text-muted">Stated as shared by source</dt><dd className="tnum">{r.shared_stated}</dd>
            <dt className="text-muted">Response cost</dt><dd className="tnum">{money(r.response_cost_minor, cur)}</dd>
          </dl>
        </section>
        <section className="card p-4">
          <SectionTitle>Funnel</SectionTitle>
          <FunnelBars color={SOURCE_COLORS[r.source_type]} steps={[
            { label: "Leads", value: r.leads }, { label: "Contacted", value: r.contacted }, { label: "Qualified", value: r.qualified },
            { label: "Appointment", value: r.appointments }, { label: "Won", value: r.wins },
          ]} />
        </section>
      </div>

      <section className="card overflow-hidden">
        <div className="px-4 pt-4"><SectionTitle action={<Link href="/economics/costs" className="text-xs font-medium text-teal-700 hover:underline">Manage costs →</Link>}>Contributing cost entries</SectionTitle></div>
        {!costs?.length ? <p className="px-4 pb-4 text-sm text-amber-700">No pooled costs recorded. {r.zero_cost ? "Marked as a no-cost source." : "Spend is unknown until you add one."}</p> : (
          <ul className="divide-y divide-line text-sm">
            {costs.map((c) => (
              <li key={c.id} className="flex flex-wrap justify-between gap-2 px-4 py-2">
                <span>{humanize(c.cost_type)} · {c.period_start ? `${dateOnly(c.period_start)} – ${dateOnly(c.period_end)}` : dateOnly(c.occurred_at)}</span>
                <span className="font-medium tnum">{money(Number(c.amount_minor), cur)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card overflow-hidden">
        <div className="px-4 pt-4"><SectionTitle action={<Link href={`/leads?source=${id}`} className="text-xs font-medium text-teal-700 hover:underline">All leads →</Link>}>Leads in period</SectionTitle></div>
        <ul className="divide-y divide-line text-sm">
          {(leads ?? []).map((l) => {
            const c = l.contacts as unknown as { full_name: string | null; phone_e164: string | null };
            return (
              <li key={l.id} className="grid grid-cols-[1fr_auto] items-center gap-2 px-4 py-2 sm:grid-cols-[1.5fr_1fr_auto_auto]">
                <Link href={`/leads/${l.id}`} className="truncate font-medium hover:underline">{c.full_name ?? "Unknown"} <span className="font-normal text-muted">· {l.title}</span></Link>
                <span className="hidden text-muted tnum sm:block">{maskPhone(c.phone_e164)}</span>
                <span className="text-xs text-muted">{ago(l.received_at)}</span>
                <StatusBadge status={l.status} />
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
