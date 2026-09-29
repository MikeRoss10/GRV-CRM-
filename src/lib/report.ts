import "server-only";
import { resolveRange } from "@/lib/dates";
import { getEconomics } from "@/lib/economics";
import { minutes, money, pct } from "@/lib/format";
import { DECISION_LABEL } from "@/lib/metrics";
import type { Workspace } from "@/lib/workspace";

export const DEFINITIONS: Array<[string, string]> = [
  ["Lead", "One normalized enquiry. The same person enquiring again within 30 days is flagged as a probable duplicate, never merged automatically."],
  ["Spend", "Source cost in the period. Packages and subscriptions are spread evenly per day; per-lead prices stated by the source are attached directly."],
  ["Unknown cost", "A source with leads but no recorded cost. Shown as Unknown — never as ₹0 — and excluded from blended CAC."],
  ["CPL / CPQL", "Spend ÷ leads, and spend ÷ qualified leads."],
  ["CAC", "(Spend + response cost) ÷ won customers. Response cost = human talk time × staff hourly cost + call and message charges."],
  ["ROAS", "Won revenue ÷ source spend."],
  ["Recommendation", "Compares each source's CAC with the median paid source. Needs at least 5 leads; sources without cost data are marked Fix costs."],
];

export async function buildReport(workspace: Workspace, rangeKey?: string) {
  const range = resolveRange(rangeKey, "30d");
  const { rows, totals } = await getEconomics(range.from.toISOString(), range.to.toISOString());
  return { range, rows: rows.filter((r) => r.leads > 0 || r.cost_event_count > 0), totals };
}

export function reportMarkdown(workspace: Workspace, r: Awaited<ReturnType<typeof buildReport>>) {
  const cur = workspace.default_currency;
  const t = r.totals;
  const lines = [
    `# ${workspace.name} — Lead economics report`,
    ``,
    `**Period:** ${r.range.label} (${r.range.from.toISOString().slice(0, 10)} to ${r.range.to.toISOString().slice(0, 10)})  `,
    `**Generated:** ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
    ``,
    `## Summary`,
    ``,
    `- Source spend: ${money(t.spend_minor, cur)}${t.spend_complete ? "" : ` (excludes unknown cost for ${t.unknown_sources.join(", ")})`}`,
    `- Leads: ${t.leads} · contacted ${t.contacted} (${pct(t.contacted, t.leads)}) · qualified ${t.qualified} · won ${t.wins}`,
    `- Revenue: ${money(t.revenue_minor, cur)}`,
    `- Blended CAC: ${t.cac === null ? (t.spend_complete ? "—" : "Unknown (cost data incomplete)") : money(t.cac, cur)}`,
    `- First response within SLA (${workspace.default_sla_minutes} min): ${t.sla_met} of ${t.leads} (${pct(t.sla_met, t.leads)})`,
    ``,
    `## Sources`,
    ``,
    `| Source | Spend | Leads | Qualified | Wins | CPL | CAC | Revenue | Median response | Decision |`,
    `| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |`,
    ...r.rows.map((s) => `| ${s.display_name} | ${s.spend_minor === null ? "Unknown" : money(s.spend_minor, cur)} | ${s.leads} | ${s.qualified} | ${s.wins} | ${money(s.cpl, cur)} | ${s.cac === null ? "—" : money(s.cac, cur)} | ${money(s.revenue_minor, cur)} | ${minutes(s.median_response_minutes)} | ${DECISION_LABEL[s.decision]} |`),
    ``,
    `## Recommendations`,
    ``,
    ...r.rows.filter((s) => s.decision !== "not_enough_data").flatMap((s) => [`### ${DECISION_LABEL[s.decision]}: ${s.display_name}`, ...s.reasons.map((x) => `- ${x}`), ``]),
    `## Definitions and caveats`,
    ``,
    ...DEFINITIONS.map(([k, v]) => `- **${k}:** ${v}`),
    ``,
  ];
  return lines.join("\n");
}
