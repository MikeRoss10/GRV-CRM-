import "server-only";
import { cache } from "react";
import { deriveMetrics, totals, type EconRow } from "@/lib/metrics";
import { can, requireWorkspace } from "@/lib/workspace";

/** Source economics for a period, cached per request. */
export const getEconomics = cache(
  async (fromIso: string, toIso: string, attribution: "first" | "last" = "first", includeResponse = true) => {
    const { supabase, workspace, role } = await requireWorkspace();
    // Workers never receive spend or economics data.
    if (!can.seeBusiness(role)) return { rows: [], totals: totals([]) };
    const { data, error } = await supabase.rpc("source_economics", {
      p_workspace: workspace.id,
      p_from: fromIso,
      p_to: toIso,
      p_attribution: attribution,
      p_include_response: includeResponse,
    });
    if (error) throw new Error(error.message);
    const rows = deriveMetrics((data ?? []) as EconRow[], { slaMinutes: workspace.default_sla_minutes });
    return { rows, totals: totals(rows) };
  },
);
