/**
 * Source economics: derived metrics and scale / optimize / test / reduce recommendations.
 * Unknown costs stay null (never zero) and every rate keeps its denominator.
 */

export interface EconRow {
  source_account_id: string;
  display_name: string;
  source_type: string;
  zero_cost: boolean;
  spend_minor: number | null;
  spend_known: boolean;
  spend_has_allocated: boolean;
  cost_event_count: number;
  response_cost_minor: number;
  leads: number;
  contacted: number;
  qualified: number;
  appointments: number;
  wins: number;
  revenue_minor: number;
  gross_margin_minor: number;
  duplicates_probable: number;
  duplicates_confirmed: number;
  shared_stated: number;
  responded: number;
  sla_met: number;
  median_response_minutes: number | null;
  needs_review: number;
}

export type Decision = "scale" | "optimize" | "test" | "reduce" | "fix_costs" | "not_enough_data";

export const DECISION_LABEL: Record<Decision, string> = {
  scale: "Scale",
  optimize: "Optimize",
  test: "Test",
  reduce: "Reduce",
  fix_costs: "Fix costs",
  not_enough_data: "Too early",
};

export interface SourceMetrics extends EconRow {
  /** Source spend (+ response cost when enabled). Null when spend is unknown. */
  total_cost_minor: number | null;
  cpl: number | null;
  cpql: number | null;
  cost_per_appointment: number | null;
  cac: number | null;
  roas: number | null;
  gm_roas: number | null;
  decision: Decision;
  reasons: string[];
}

const div = (a: number | null, b: number): number | null => (a === null || !b ? null : a / b);

export function deriveMetrics(rows: EconRow[], opts: { slaMinutes: number; minLeads?: number } = { slaMinutes: 15 }): SourceMetrics[] {
  const minLeads = opts.minLeads ?? 5;
  const base = rows.map((r) => {
    const spend = r.spend_known ? Number(r.spend_minor ?? 0) : null;
    const total = spend === null ? null : spend + Number(r.response_cost_minor ?? 0);
    return {
      ...r,
      spend_minor: spend,
      total_cost_minor: total,
      cpl: div(spend, r.leads),
      cpql: div(spend, r.qualified),
      cost_per_appointment: div(spend, r.appointments),
      cac: div(total, r.wins),
      roas: spend ? r.revenue_minor / spend : null,
      gm_roas: spend ? r.gross_margin_minor / spend : null,
    };
  });

  // Benchmark: median CAC across paid sources that have wins and known cost.
  const cacs = base.filter((r) => r.cac !== null && (r.spend_minor ?? 0) > 0).map((r) => r.cac as number).sort((a, b) => a - b);
  const benchmark = cacs.length ? cacs[Math.floor((cacs.length - 1) / 2)] : null;

  return base.map((r) => {
    const reasons: string[] = [];
    let decision: Decision;
    if (r.leads === 0 && !r.cost_event_count) {
      decision = "not_enough_data";
      reasons.push("No leads or costs in this period.");
    } else if (!r.spend_known) {
      decision = "fix_costs";
      reasons.push(`${r.leads} leads but no cost recorded for this period — CAC can't be calculated. Add the package, subscription or per-lead cost.`);
    } else if (r.leads < minLeads) {
      decision = "not_enough_data";
      reasons.push(`Only ${r.leads} lead${r.leads === 1 ? "" : "s"} — too few to judge yet.`);
    } else if (r.wins === 0) {
      if ((r.spend_minor ?? 0) > 0 && r.leads >= 15) {
        decision = "reduce";
        reasons.push(`${r.leads} leads and ${r.qualified} qualified, but no wins yet for the spend.`);
      } else {
        decision = "test";
        reasons.push(`${r.leads} leads, no wins yet — keep testing before deciding.`);
      }
    } else if ((r.spend_minor ?? 0) === 0) {
      decision = "scale";
      reasons.push(`${r.wins} win${r.wins === 1 ? "" : "s"} with no direct source cost.`);
    } else if (benchmark !== null && r.cac !== null && r.cac <= benchmark * 0.9 && (r.roas ?? 0) >= 2) {
      decision = "scale";
      reasons.push(`Lowest-cost wins: CAC is ${Math.round((1 - r.cac / benchmark) * 100)}% below the median paid source, ROAS ${r.roas!.toFixed(1)}×.`);
    } else if (benchmark !== null && r.cac !== null && r.cac >= benchmark * 1.5) {
      decision = "reduce";
      reasons.push(`CAC is ${(r.cac / benchmark).toFixed(1)}× the median paid source.`);
    } else if (cacs.length < 2) {
      decision = "optimize";
      reasons.push(`The only paid source with wins so far (${r.wins}). Compare again once other sources convert before shifting budget.`);
    } else {
      decision = "optimize";
      reasons.push(`Wins at around the median cost — improve conversion before adding budget.`);
    }

    if (r.leads >= minLeads) {
      if (r.contacted / r.leads < 0.6) reasons.push(`Only ${Math.round((r.contacted / r.leads) * 100)}% of leads were reached (${r.contacted}/${r.leads}).`);
      if (r.median_response_minutes !== null && r.median_response_minutes > opts.slaMinutes)
        reasons.push(`Median first response ${Math.round(r.median_response_minutes)} min vs ${opts.slaMinutes} min SLA.`);
      const dup = r.duplicates_probable + r.duplicates_confirmed;
      if (dup / r.leads >= 0.05) reasons.push(`${dup} probable/confirmed duplicates (${Math.round((dup / r.leads) * 100)}%).`);
      if (r.shared_stated > 0) reasons.push(`${r.shared_stated} leads stated by the source as shared with other businesses.`);
      if (r.needs_review > 0) reasons.push(`${r.needs_review} leads still need parser review.`);
    }
    if (r.spend_has_allocated) reasons.push("Part of the spend is allocated pro-rata from a package outside this date range.");

    return { ...r, decision, reasons };
  });
}

export interface Totals {
  spend_minor: number;
  spend_complete: boolean;
  unknown_sources: string[];
  response_cost_minor: number;
  leads: number;
  contacted: number;
  qualified: number;
  appointments: number;
  wins: number;
  revenue_minor: number;
  responded: number;
  sla_met: number;
  cac: number | null;
  cpl: number | null;
}

export function totals(rows: SourceMetrics[]): Totals {
  const t = rows.reduce(
    (acc, r) => {
      acc.spend_minor += r.spend_minor ?? 0;
      acc.response_cost_minor += Number(r.response_cost_minor ?? 0);
      if (!r.spend_known && r.leads > 0) acc.unknown_sources.push(r.display_name);
      acc.leads += r.leads;
      acc.contacted += r.contacted;
      acc.qualified += r.qualified;
      acc.appointments += r.appointments;
      acc.wins += r.wins;
      acc.revenue_minor += Number(r.revenue_minor);
      acc.responded += r.responded;
      acc.sla_met += r.sla_met;
      return acc;
    },
    {
      spend_minor: 0, response_cost_minor: 0, unknown_sources: [] as string[], leads: 0, contacted: 0, qualified: 0,
      appointments: 0, wins: 0, revenue_minor: 0, responded: 0, sla_met: 0,
    },
  );
  const spend_complete = t.unknown_sources.length === 0;
  // CAC across all sources only when every source with leads has known cost.
  return {
    ...t,
    spend_complete,
    cac: spend_complete && t.wins ? (t.spend_minor + t.response_cost_minor) / t.wins : null,
    cpl: spend_complete && t.leads ? t.spend_minor / t.leads : null,
  };
}

/** Percentage change, null when the previous value is zero or unknown. */
export function change(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return (current - previous) / previous;
}
