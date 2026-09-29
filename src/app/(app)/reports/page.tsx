import { Download, FileDown } from "lucide-react";
import { MetricCard } from "@/components/charts";
import { PrintButton } from "@/components/print-button";
import { RangeSelect } from "@/components/range-select";
import { Badge, PageHeader, SectionTitle, SourceBadge } from "@/components/ui";
import { dateOnly, minutes, money, pct } from "@/lib/format";
import { DECISION_LABEL } from "@/lib/metrics";
import { buildReport, DEFINITIONS } from "@/lib/report";
import { can, requireWorkspace } from "@/lib/workspace";

export const metadata = { title: "Reports" };

const TONE = { scale: "teal", optimize: "navy", test: "sky", reduce: "crit", fix_costs: "amber", not_enough_data: "neutral" } as const;

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const { range: rk } = await searchParams;
  const { workspace, role } = await requireWorkspace();
  const r = await buildReport(workspace, rk);
  const t = r.totals;
  const cur = workspace.default_currency;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader
        title="Owner report"
        description="A shareable summary with definitions and caveats. Every export is recorded in the audit log."
        actions={
          <div className="no-print flex flex-wrap gap-2">
            <RangeSelect />
            <PrintButton />
            <a href={`/api/export/report?range=${r.range.key}`} className="btn-secondary"><FileDown className="size-4" aria-hidden />Markdown</a>
            <a href={`/api/export/economics?range=${r.range.key}`} className="btn-secondary"><Download className="size-4" aria-hidden />Sources CSV</a>
            {can.own(role) && <a href={`/api/export/leads?range=${r.range.key}`} className="btn-secondary"><Download className="size-4" aria-hidden />Leads CSV</a>}
          </div>
        }
      />

      <article className="card space-y-6 p-5 sm:p-8">
        <header className="border-b border-line pb-4">
          <p className="eyebrow">Lead economics report</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight">{workspace.name}</h2>
          <p className="text-sm text-muted">{r.range.label} · {dateOnly(r.range.from.toISOString())} – {dateOnly(r.range.to.toISOString())}</p>
        </header>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <MetricCard label="Source spend" value={money(t.spend_minor, cur, { compact: true })} warn={!t.spend_complete ? `+ unknown: ${t.unknown_sources.join(", ")}` : undefined} />
          <MetricCard label="Leads" value={t.leads} sub={<span>{pct(t.contacted, t.leads)} contacted</span>} />
          <MetricCard label="Won" value={t.wins} sub={<span>{money(t.revenue_minor, cur, { compact: true })} revenue</span>} />
          <MetricCard label="Blended CAC" value={t.cac === null ? (t.spend_complete ? "—" : "Unknown") : money(t.cac, cur)} sub={<span>SLA met {pct(t.sla_met, t.leads)}</span>} />
        </div>

        <section>
          <SectionTitle>Sources</SectionTitle>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead><tr className="border-b border-line">
                <th className="table-head pl-0">Source</th><th className="table-head text-right">Spend</th><th className="table-head text-right">Leads</th>
                <th className="table-head text-right">Wins</th><th className="table-head text-right">CAC</th><th className="table-head text-right">Revenue</th>
                <th className="table-head text-right">Median resp.</th><th className="table-head">Decision</th>
              </tr></thead>
              <tbody>
                {r.rows.map((s) => (
                  <tr key={s.source_account_id} className="border-b border-line/70">
                    <td className="py-2"><SourceBadge type={s.source_type} name={s.display_name} /></td>
                    <td className="px-3 text-right tnum">{s.spend_minor === null ? <span className="text-amber-700">Unknown</span> : money(s.spend_minor, cur)}</td>
                    <td className="px-3 text-right tnum">{s.leads}</td>
                    <td className="px-3 text-right tnum">{s.wins}</td>
                    <td className="px-3 text-right tnum">{s.cac === null ? "—" : money(s.cac, cur)}</td>
                    <td className="px-3 text-right tnum">{money(s.revenue_minor, cur)}</td>
                    <td className="px-3 text-right tnum">{minutes(s.median_response_minutes)}</td>
                    <td className="px-3"><Badge tone={TONE[s.decision]}>{DECISION_LABEL[s.decision]}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <SectionTitle>Recommendations</SectionTitle>
          <div className="grid gap-3 md:grid-cols-2">
            {r.rows.filter((s) => s.decision !== "not_enough_data").map((s) => (
              <div key={s.source_account_id} className="rounded-xl border border-line p-4 break-inside-avoid">
                <div className="flex items-center gap-2"><Badge tone={TONE[s.decision]}>{DECISION_LABEL[s.decision]}</Badge><span className="font-medium">{s.display_name}</span></div>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">{s.reasons.map((x) => <li key={x}>{x}</li>)}</ul>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl bg-stone-50 p-4">
          <SectionTitle>Definitions and caveats</SectionTitle>
          <dl className="space-y-1.5 text-sm">
            {DEFINITIONS.map(([k, v]) => <div key={k}><dt className="inline font-medium">{k}: </dt><dd className="inline text-muted">{v}</dd></div>)}
          </dl>
        </section>
      </article>
    </div>
  );
}
