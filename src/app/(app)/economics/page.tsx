import Link from "next/link";
import { Download, Receipt } from "lucide-react";
import { AutoForm } from "@/components/auto-form";
import { FunnelBars } from "@/components/charts";
import { Badge, PageHeader, SectionTitle, SourceBadge, SOURCE_COLORS } from "@/components/ui";
import { WeeklyChart } from "@/components/weekly-chart";
import { RANGES, resolveRange } from "@/lib/dates";
import { getEconomics } from "@/lib/economics";
import { minutes, money, pct } from "@/lib/format";
import { DECISION_LABEL } from "@/lib/metrics";
import { requireWorkspace } from "@/lib/workspace";
import { weeklyCount, weeklySpend } from "@/lib/weekly";

export const metadata = { title: "Source Economics" };

const DECISION_TONE = { scale: "teal", optimize: "navy", test: "sky", reduce: "crit", fix_costs: "amber", not_enough_data: "neutral" } as const;

type SP = { range?: string; attribution?: string; response?: string; focus?: string };

export default async function EconomicsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const range = resolveRange(sp.range, "90d");
  const attribution = sp.attribution === "last" ? "last" : "first";
  const includeResponse = sp.response !== "off";
  const { supabase, workspace } = await requireWorkspace();
  const cur = workspace.default_currency;

  const [{ rows, totals: t }, costs, wins, leads] = await Promise.all([
    getEconomics(range.from.toISOString(), range.to.toISOString(), attribution, includeResponse),
    supabase.from("cost_events").select("amount_minor, occurred_at, period_start, period_end").eq("workspace_id", workspace.id).not("cost_type", "in", "(staff_time,message,call)"),
    supabase.from("opportunities").select("won_at").eq("workspace_id", workspace.id).gte("won_at", range.from.toISOString()).lt("won_at", range.to.toISOString()),
    supabase.from("opportunities").select("received_at").eq("workspace_id", workspace.id).neq("duplicate_status", "merged").gte("received_at", range.from.toISOString()).lt("received_at", range.to.toISOString()),
  ]);

  const shown = rows.filter((r) => r.leads > 0 || r.cost_event_count > 0);
  const focus = shown.find((r) => r.source_account_id === sp.focus) ?? [...shown].sort((a, b) => (a.decision === "reduce" ? -1 : b.decision === "reduce" ? 1 : b.leads - a.leads))[0];
  const spendWeeks = weeklySpend(costs.data ?? [], range.from, range.to);
  const winWeeks = weeklyCount((wins.data ?? []).map((w) => w.won_at), range.from, range.to);
  const leadWeeks = weeklyCount((leads.data ?? []).map((w) => w.received_at), range.from, range.to);
  const qs = (patch: Partial<SP>) => `/economics?${new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][])}`;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Source Economics"
        description="Spend, conversion and cost per customer on the same definitions for every source."
        actions={
          <>
            <Link href="/economics/costs" className="btn-secondary"><Receipt className="size-4" aria-hidden />Cost assumptions</Link>
            <a href={`/api/export/economics?range=${range.key}&attribution=${attribution}&response=${includeResponse ? "on" : "off"}`} className="btn-secondary"><Download className="size-4" aria-hidden />Export CSV</a>
          </>
        }
      />

      <AutoForm action="/economics" className="card flex flex-wrap items-end gap-3 p-3">
        <label className="text-sm">
          <span className="label">Period</span>
          <select name="range" defaultValue={range.key} className="input !w-auto !py-1.5">
            {Object.entries(RANGES).map(([k, r]) => <option key={k} value={k}>{r.label}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="label">Attribution</span>
          <select name="attribution" defaultValue={attribution} className="input !w-auto !py-1.5">
            <option value="first">First touch</option>
            <option value="last">Last touch</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="label">Response cost in CAC</span>
          <select name="response" defaultValue={includeResponse ? "on" : "off"} className="input !w-auto !py-1.5">
            <option value="on">On (staff time + calls + messages)</option>
            <option value="off">Off (source spend only)</option>
          </select>
        </label>
        <p className="ml-auto max-w-xs text-xs text-muted">
          Packages are spread evenly per day over their period. Unknown costs stay <b>Unknown</b>, never ₹0.
        </p>
      </AutoForm>

      <section className="card overflow-hidden" aria-label="Source comparison">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[64rem] text-sm">
            <thead className="bg-stone-50">
              <tr className="border-b border-line">
                <th className="table-head sticky left-0 z-10 bg-stone-50 pl-4">Source</th>
                <th className="table-head text-right">Spend</th>
                <th className="table-head text-right">Leads</th>
                <th className="table-head text-right">Contacted</th>
                <th className="table-head text-right">Qualified</th>
                <th className="table-head text-right">Appts</th>
                <th className="table-head text-right">Wins</th>
                <th className="table-head text-right">CPL</th>
                <th className="table-head text-right">CPQL</th>
                <th className="table-head text-right">CAC</th>
                <th className="table-head text-right">Revenue</th>
                <th className="table-head text-right">ROAS</th>
                <th className="table-head text-right">Median resp.</th>
                <th className="table-head pr-4">Decision</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.source_account_id} className={`border-b border-line/70 hover:bg-navy-50/40 ${focus?.source_account_id === r.source_account_id ? "bg-navy-50/60" : ""}`}>
                  <td className="sticky left-0 z-10 bg-white py-2.5 pl-4">
                    <Link href={qs({ focus: r.source_account_id })} scroll={false} className="hover:underline"><SourceBadge type={r.source_type} name={r.display_name} className="font-medium" /></Link>
                  </td>
                  <td className="px-3 text-right tnum">
                    {r.spend_minor === null ? <Link href="/economics/costs" className="text-amber-700 underline">Unknown</Link> : <>{money(r.spend_minor, cur, { compact: true })}{r.spend_has_allocated && <span className="text-faint" title="Allocated pro-rata from a package"> *</span>}</>}
                  </td>
                  <td className="px-3 text-right tnum">{r.leads}</td>
                  <td className="px-3 text-right tnum" title={`${r.contacted} of ${r.leads}`}>{r.contacted} <span className="text-xs text-faint">{pct(r.contacted, r.leads)}</span></td>
                  <td className="px-3 text-right tnum">{r.qualified} <span className="text-xs text-faint">{pct(r.qualified, r.contacted)}</span></td>
                  <td className="px-3 text-right tnum">{r.appointments}</td>
                  <td className="px-3 text-right font-medium tnum">{r.wins}</td>
                  <td className="px-3 text-right tnum">{money(r.cpl, cur)}</td>
                  <td className="px-3 text-right tnum">{money(r.cpql, cur)}</td>
                  <td className="px-3 text-right font-medium tnum">{r.cac === null ? (r.spend_known ? "—" : <span className="text-amber-700">Unknown</span>) : money(r.cac, cur)}</td>
                  <td className="px-3 text-right tnum">{money(r.revenue_minor, cur, { compact: true })}</td>
                  <td className="px-3 text-right tnum">{r.roas === null ? "—" : `${r.roas.toFixed(1)}×`}</td>
                  <td className="px-3 text-right tnum">{minutes(r.median_response_minutes)}</td>
                  <td className="pr-4"><Badge tone={DECISION_TONE[r.decision]}>{DECISION_LABEL[r.decision]}</Badge></td>
                </tr>
              ))}
              <tr className="bg-stone-50 font-medium">
                <td className="sticky left-0 bg-stone-50 py-2.5 pl-4">All sources</td>
                <td className="px-3 text-right tnum">{money(t.spend_minor, cur, { compact: true })}{!t.spend_complete && <span className="text-amber-700">+?</span>}</td>
                <td className="px-3 text-right tnum">{t.leads}</td>
                <td className="px-3 text-right tnum">{t.contacted}</td>
                <td className="px-3 text-right tnum">{t.qualified}</td>
                <td className="px-3 text-right tnum">{t.appointments}</td>
                <td className="px-3 text-right tnum">{t.wins}</td>
                <td className="px-3 text-right tnum">{money(t.cpl, cur)}</td>
                <td className="px-3 text-right">—</td>
                <td className="px-3 text-right tnum">{t.cac === null ? (t.spend_complete ? "—" : <span className="text-amber-700">Unknown</span>) : money(t.cac, cur)}</td>
                <td className="px-3 text-right tnum">{money(t.revenue_minor, cur, { compact: true })}</td>
                <td className="px-3 text-right">{t.spend_complete && t.spend_minor ? `${(t.revenue_minor / t.spend_minor).toFixed(1)}×` : "—"}</td>
                <td className="px-3" colSpan={2} />
              </tr>
            </tbody>
          </table>
        </div>
        <p className="border-t border-line px-4 py-2 text-xs text-muted">
          {range.label} · {attribution === "first" ? "first-touch" : "last-touch"} attribution · CAC {includeResponse ? "includes" : "excludes"} response cost ({money(t.response_cost_minor, cur)} in period).
          {" "}* part of the spend is allocated from a package spanning the period edge. Rates show conversion from the previous step.
        </p>
      </section>

      {focus && (
        <section className="card p-4 sm:p-5" aria-labelledby="why">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 id="why" className="eyebrow">Why the recommendation?</h2>
              <div className="mt-2 flex items-center gap-2">
                <Badge tone={DECISION_TONE[focus.decision]}>{DECISION_LABEL[focus.decision]}</Badge>
                <SourceBadge type={focus.source_type} name={focus.display_name} className="font-medium" />
              </div>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <Link href={`/economics/${focus.source_account_id}?range=${range.key}`} className="btn-secondary !py-1 text-xs">Open evidence</Link>
              <Link href={`/leads?source=${focus.source_account_id}&view=duplicates`} className="btn-secondary !py-1 text-xs">Duplicate evidence</Link>
              <Link href="/economics/costs" className="btn-secondary !py-1 text-xs">Cost assumptions</Link>
            </div>
          </div>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
            {focus.reasons.map((x) => <li key={x}>{x}</li>)}
          </ul>
          <p className="mt-3 text-xs text-muted">
            Evidence: {focus.leads} leads · {focus.duplicates_probable} probable duplicates · median response {minutes(focus.median_response_minutes)} · {focus.cost_event_count} cost entries.
            Recommendations compare CAC with the median paid source and need at least 5 leads.
          </p>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="card p-4" aria-label="Spend by week">
          <SectionTitle>Source spend by week</SectionTitle>
          <WeeklyChart data={spendWeeks} label="Spend" currency={cur} color="#2a78d6" />
        </section>
        <section className="card p-4" aria-label="Leads by week">
          <SectionTitle>Leads by week</SectionTitle>
          <WeeklyChart data={leadWeeks} label="Leads" color="#2a78d6" />
        </section>
        <section className="card p-4" aria-label="Wins by week">
          <SectionTitle>Wins by week</SectionTitle>
          <WeeklyChart data={winWeeks} label="Wins" color="#0e9384" />
        </section>
      </div>

      <section aria-labelledby="funnels">
        <SectionTitle><span id="funnels">Funnel by source</span></SectionTitle>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {shown.filter((r) => r.leads > 0).map((r) => (
            <div key={r.source_account_id} className="card p-4">
              <div className="mb-3 flex items-center justify-between">
                <SourceBadge type={r.source_type} name={r.display_name} className="font-medium" />
                <span className="text-xs text-muted tnum">{pct(r.wins, r.leads)} lead → win</span>
              </div>
              <FunnelBars
                color={SOURCE_COLORS[r.source_type] ?? "#2a78d6"}
                steps={[
                  { label: "Leads", value: r.leads },
                  { label: "Contacted", value: r.contacted },
                  { label: "Qualified", value: r.qualified },
                  { label: "Appointment", value: r.appointments },
                  { label: "Won", value: r.wins },
                ]}
              />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
