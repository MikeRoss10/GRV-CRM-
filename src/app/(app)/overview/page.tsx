import Link from "next/link";
import { AlertTriangle, ArrowRight, Copy, FileText, Inbox, ScanSearch, Sparkles, UserPlus, CalendarClock } from "lucide-react";
import { FunnelBars, MetricCard, RankedBars } from "@/components/charts";
import { RangeSelect } from "@/components/range-select";
import { Badge, EmptyState, Notice, SectionTitle, SourceBadge } from "@/components/ui";
import { resolveRange } from "@/lib/dates";
import { getEconomics } from "@/lib/economics";
import { money, minutes, num, pct } from "@/lib/format";
import { DECISION_LABEL, change, type SourceMetrics } from "@/lib/metrics";
import { requireBusinessAccess } from "@/lib/workspace";

export const metadata = { title: "Overview" };

const DECISION_TONE = { scale: "teal", optimize: "navy", test: "sky", reduce: "crit", fix_costs: "amber", not_enough_data: "neutral" } as const;

function greeting(tz: string) {
  const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: tz }).format(new Date()));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ range?: string; welcome?: string }> }) {
  const sp = await searchParams;
  const range = resolveRange(sp.range);
  const { supabase, workspace, member } = await requireBusinessAccess();
  const cur = workspace.default_currency;
  const now = Date.now();

  const [econ, prev, pending, dupes, review, overdue] = await Promise.all([
    getEconomics(range.from.toISOString(), range.to.toISOString()),
    getEconomics(range.prevFrom.toISOString(), range.prevTo.toISOString()),
    supabase.from("opportunities").select("id, received_at, owner_user_id").eq("workspace_id", workspace.id)
      .is("first_response_at", null).in("status", ["new", "assigned"]).gte("received_at", new Date(now - 7 * 86400000).toISOString()),
    supabase.from("opportunities").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id).eq("duplicate_status", "probable").neq("status", "duplicate"),
    supabase.from("opportunities").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id).eq("data_quality_status", "needs_review").in("status", ["new", "assigned", "attempting_contact"]),
    supabase.from("tasks").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id).eq("status", "open").lt("due_at", new Date(now).toISOString()),
  ]);

  const t = econ.totals;
  const p = prev.totals;
  const sla = workspace.default_sla_minutes;
  const waiting = pending.data ?? [];
  const unassigned = waiting.filter((o) => !o.owner_user_id).length;
  const ageMin = (o: { received_at: string }) => (now - new Date(o.received_at).getTime()) / 60000;
  const nearBreach = waiting.filter((o) => ageMin(o) > sla * 0.6 && ageMin(o) <= sla).length;
  const breached = waiting.filter((o) => ageMin(o) > sla).length;
  const attention = waiting.length + (overdue.count ?? 0);

  const withLeads = econ.rows.filter((r) => r.leads > 0 || r.cost_event_count > 0);
  const recs = [...withLeads]
    .filter((r) => r.decision !== "not_enough_data")
    .sort((a, b) => order(a) - order(b))
    .slice(0, 3);

  const noData = t.leads === 0 && econ.rows.every((r) => r.cost_event_count === 0);

  return (
    <div className="space-y-6">
      {sp.welcome && (
        <Notice tone="teal" title="Your workspace is ready." action={<Link href="/connections" className="btn-secondary !py-1 text-xs whitespace-nowrap">Connect a source</Link>}>
          Next: forward aggregator alerts to LeadLens or import a CSV, then add source costs to unlock CAC.
        </Notice>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{greeting(workspace.timezone)}, {member.name.split(" ")[0]}</h1>
          <p className="mt-1 text-sm text-muted">
            <Link href="/leads?view=attention" className="font-medium text-ink hover:underline">{attention} need attention</Link>
            {" · "}
            <span className={breached ? "font-medium text-crit-700" : ""}>{breached} past SLA</span>
            {" · "}
            <span className={nearBreach ? "font-medium text-amber-700" : ""}>{nearBreach} close to SLA breach</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <RangeSelect />
          <Link href={`/reports?range=${range.key}`} className="btn-secondary"><FileText className="size-4" aria-hidden />Export report</Link>
        </div>
      </div>

      {noData ? (
        <div className="card">
          <EmptyState
            icon={<Inbox className="size-5" />}
            title="No leads in this period yet"
            action={<div className="flex gap-2"><Link href="/connections" className="btn-primary">Connect a source</Link><Link href="/leads/new" className="btn-secondary">Add a lead</Link></div>}
          >
            Forward Justdial, Sulekha or 91acres notifications, import a CSV, or add a lead by hand. Owners can also load sample data from Settings.
          </EmptyState>
        </div>
      ) : (
        <>
          <section aria-label="Key metrics" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MetricCard
              label="Source spend"
              value={money(t.spend_minor, cur, { compact: true })}
              delta={t.spend_complete && p.spend_complete ? change(t.spend_minor, p.spend_minor) : null}
              deltaGoodWhen="down"
              sub={<span>vs previous {range.label.replace("Last ", "")}</span>}
              warn={!t.spend_complete ? `Excludes ${t.unknown_sources.length} source${t.unknown_sources.length > 1 ? "s" : ""} with unknown cost` : undefined}
              title={`Allocated source spend in ${range.label.toLowerCase()}. Response cost (${money(t.response_cost_minor, cur)}) is added in CAC.`}
            />
            <MetricCard
              label="Leads"
              value={num(t.leads)}
              delta={change(t.leads, p.leads)}
              sub={<span>{t.contacted} contacted ({pct(t.contacted, t.leads)})</span>}
            />
            <MetricCard
              label="Won customers"
              value={num(t.wins)}
              delta={change(t.wins, p.wins)}
              sub={<span>{pct(t.wins, t.leads)} of {t.leads} leads · {money(t.revenue_minor, cur, { compact: true })} revenue</span>}
            />
            <MetricCard
              label="Blended CAC"
              value={t.cac === null ? (t.wins ? "Unknown" : "—") : money(t.cac, cur)}
              delta={change(t.cac, p.cac)}
              deltaGoodWhen="down"
              sub={<span>{t.cac === null ? (t.wins ? "Cost data incomplete" : "No wins in period") : `(spend + response) ÷ ${t.wins} wins`}</span>}
            />
          </section>

          <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
            <section className="card p-4 sm:p-5" aria-labelledby="health">
              <SectionTitle action={<Link href={`/economics?range=${range.key}`} className="text-xs font-medium text-teal-700 hover:underline">Source economics →</Link>}>
                <span id="health">Source health · {range.label.toLowerCase()}</span>
              </SectionTitle>
              <div className="-mx-4 overflow-x-auto sm:-mx-5">
                <table className="w-full min-w-[34rem] text-sm">
                  <thead>
                    <tr className="border-b border-line">
                      <th className="table-head pl-4 sm:pl-5">Source</th>
                      <th className="table-head text-right">Leads</th>
                      <th className="table-head text-right">CPL</th>
                      <th className="table-head text-right">Response</th>
                      <th className="table-head pr-4 sm:pr-5">Data</th>
                    </tr>
                  </thead>
                  <tbody>
                    {withLeads.map((r) => (
                      <tr key={r.source_account_id} className="border-b border-line/70 last:border-0 hover:bg-navy-50/50">
                        <td className="py-2.5 pl-4 sm:pl-5">
                          <Link href={`/leads?source=${r.source_account_id}`} className="hover:underline"><SourceBadge type={r.source_type} name={r.display_name} /></Link>
                        </td>
                        <td className="px-3 text-right tnum">{r.leads}</td>
                        <td className="px-3 text-right tnum">
                          {r.cpl === null ? <span className="text-amber-700">Unknown</span> : <>{money(r.cpl, cur)}{r.spend_has_allocated && <span className="text-faint"> est.</span>}</>}
                        </td>
                        <td className="px-3 text-right tnum" title={`${r.sla_met} of ${r.leads} leads answered within ${sla} min`}>
                          {minutes(r.median_response_minutes)}
                        </td>
                        <td className="pr-4 sm:pr-5">
                          {!r.spend_known ? <Badge tone="amber"><AlertTriangle className="size-3" aria-hidden />Cost missing</Badge>
                            : r.needs_review > 0 ? <Badge tone="amber">{r.needs_review} to review</Badge>
                            : <Badge tone="teal">Complete</Badge>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="card p-4 sm:p-5" aria-labelledby="funnel">
              <SectionTitle><span id="funnel">Funnel · {range.label.toLowerCase()}</span></SectionTitle>
              <FunnelBars
                steps={[
                  { label: "New leads", value: t.leads },
                  { label: "Contacted", value: t.contacted },
                  { label: "Qualified", value: t.qualified },
                  { label: "Appointment", value: t.appointments },
                  { label: "Won", value: t.wins },
                ]}
              />
              <p className="mt-3 text-xs text-faint">Percentages are conversion from the previous step.</p>
            </section>
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
            <section aria-labelledby="recs">
              <SectionTitle><span id="recs">Recommendations</span></SectionTitle>
              <div className="space-y-3">
                {recs.length === 0 && <div className="card p-4 text-sm text-muted">Not enough data yet. Recommendations appear once sources have at least 5 leads and recorded costs.</div>}
                {recs.map((r) => (
                  <article key={r.source_account_id} className="card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <Badge tone={DECISION_TONE[r.decision]}>{DECISION_LABEL[r.decision]}</Badge>
                          <SourceBadge type={r.source_type} name={r.display_name} className="font-medium" />
                        </div>
                        <p className="mt-2 text-sm text-ink">{r.reasons[0]}</p>
                      </div>
                      <Sparkles className="size-4 shrink-0 text-faint" aria-hidden />
                    </div>
                    <details className="group mt-2 text-sm">
                      <summary className="cursor-pointer list-none text-xs font-medium text-teal-700 hover:underline">Why this appears</summary>
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
                        {r.reasons.slice(1).map((x) => <li key={x}>{x}</li>)}
                        <li>{r.leads} leads · {r.qualified} qualified · {r.wins} won · spend {r.spend_minor === null ? "unknown" : money(r.spend_minor, cur)}{r.cac !== null ? ` · CAC ${money(r.cac, cur)}` : ""}.</li>
                      </ul>
                    </details>
                    <div className="mt-3 flex gap-3 text-xs font-medium">
                      <Link href={`/economics/${r.source_account_id}?range=${range.key}`} className="text-navy-700 hover:underline">View evidence →</Link>
                      {r.decision === "fix_costs" && <Link href="/economics/costs" className="text-amber-700 hover:underline">Add cost →</Link>}
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <div className="space-y-4">
              <section className="card p-4 sm:p-5" aria-labelledby="attention">
                <SectionTitle><span id="attention">Needs attention</span></SectionTitle>
                <ul className="divide-y divide-line/70 text-sm">
                  <AttentionRow href="/leads?view=unassigned" icon={<UserPlus className="size-4" />} label="New leads unassigned" value={unassigned} />
                  <AttentionRow href="/leads?view=sla" icon={<AlertTriangle className="size-4" />} label="Waiting for first response" value={waiting.length} tone={breached ? "crit" : undefined} />
                  <AttentionRow href="/follow-up" icon={<CalendarClock className="size-4" />} label="Overdue follow-ups" value={overdue.count ?? 0} tone={overdue.count ? "crit" : undefined} />
                  <AttentionRow href="/leads/duplicates" icon={<Copy className="size-4" />} label="Probable duplicates" value={dupes.count ?? 0} />
                  <AttentionRow href="/leads?view=review" icon={<ScanSearch className="size-4" />} label="Leads needing parser review" value={review.count ?? 0} />
                </ul>
              </section>
              <section className="card p-4 sm:p-5" aria-labelledby="cac">
                <SectionTitle><span id="cac">Cost per won customer</span></SectionTitle>
                <RankedBars
                  rows={withLeads.filter((r) => (r.spend_minor ?? 1) > 0).map((r) => ({
                    key: r.source_account_id,
                    label: <SourceBadge type={r.source_type} name={r.display_name} />,
                    value: r.cac,
                    note: !r.spend_known ? "No cost recorded" : r.wins === 0 ? `No wins from ${r.leads} leads` : `${money(r.total_cost_minor, cur)} ÷ ${r.wins} wins`,
                  }))}
                  format={(v) => money(v, cur)}
                  emptyLabel="—"
                />
                <p className="mt-3 text-xs text-faint">Includes response cost. Zero-cost sources (referrals, website) are excluded.</p>
              </section>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function order(r: SourceMetrics) {
  return { fix_costs: 0, reduce: 1, scale: 2, optimize: 3, test: 4, not_enough_data: 5 }[r.decision];
}

function AttentionRow({ href, icon, label, value, tone }: { href: string; icon: React.ReactNode; label: string; value: number; tone?: "crit" }) {
  return (
    <li>
      <Link href={href} className="flex items-center gap-3 py-2.5 hover:text-navy-700">
        <span className="text-faint" aria-hidden>{icon}</span>
        <span className="flex-1">{label}</span>
        <span className={`font-semibold tnum ${tone === "crit" && value ? "text-crit-700" : "text-ink"}`}>{value}</span>
        <ArrowRight className="size-3.5 text-faint" aria-hidden />
      </Link>
    </li>
  );
}
