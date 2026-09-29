import { NextResponse, type NextRequest } from "next/server";
import { resolveRange } from "@/lib/dates";
import { buildReport, reportMarkdown } from "@/lib/report";
import { can, requireWorkspace } from "@/lib/workspace";

function csv(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    // Neutralize spreadsheet formula injection.
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
}

const minor = (v: unknown) => (v === null || v === undefined ? "" : (Number(v) / 100).toFixed(2));

export async function GET(request: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const sp = request.nextUrl.searchParams;
  const { supabase, workspace, role, user } = await requireWorkspace();
  if (!can.seeBusiness(role)) return NextResponse.json({ error: "Exports are available to admins only." }, { status: 403 });
  const stamp = new Date().toISOString().slice(0, 10);
  const slug = workspace.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  let body = "";
  let type = "text/csv";
  let filename = "";

  if (kind === "economics") {
    const r = await buildReport(workspace, sp.get("range") ?? "90d");
    body = csv(r.rows.map((s) => ({
      source: s.display_name, source_type: s.source_type, spend: s.spend_known ? minor(s.spend_minor) : "unknown",
      spend_partly_allocated: s.spend_has_allocated, response_cost: minor(s.response_cost_minor), leads: s.leads, contacted: s.contacted,
      qualified: s.qualified, appointments: s.appointments, wins: s.wins, revenue: minor(s.revenue_minor), cpl: minor(s.cpl),
      cpql: minor(s.cpql), cost_per_appointment: minor(s.cost_per_appointment), cac: minor(s.cac), roas: s.roas?.toFixed(2) ?? "",
      median_response_minutes: s.median_response_minutes ?? "", probable_duplicates: s.duplicates_probable, decision: s.decision,
      reasons: s.reasons.join(" | "),
    })));
    filename = `${slug}-source-economics-${r.range.key}-${stamp}.csv`;
  } else if (kind === "report") {
    const r = await buildReport(workspace, sp.get("range") ?? "30d");
    body = reportMarkdown(workspace, r);
    type = "text/markdown";
    filename = `${slug}-report-${r.range.key}-${stamp}.md`;
  } else if (kind === "leads") {
    if (!can.own(role)) return NextResponse.json({ error: "Only owners can export lead data." }, { status: 403 });
    const range = resolveRange(sp.get("range") ?? "90d", "90d");
    const { data, error } = await supabase
      .from("opportunities")
      .select("id, title, status, service, location, received_at, first_response_at, qualified_at, won_at, lost_reason, revenue_minor, duplicate_status, data_quality_status, owner_user_id, contacts(full_name, phone_e164, email), source_touches(provider_lead_id, source_accounts(display_name))")
      .eq("workspace_id", workspace.id).gte("received_at", range.from.toISOString()).order("received_at", { ascending: false }).limit(10000);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    body = csv((data ?? []).map((o) => {
      const c = o.contacts as unknown as { full_name: string | null; phone_e164: string | null; email: string | null };
      const t = (o.source_touches as unknown as Array<{ provider_lead_id: string | null; source_accounts: { display_name: string } }>) ?? [];
      return {
        id: o.id, name: c?.full_name, phone: c?.phone_e164, email: c?.email, source: t.map((x) => x.source_accounts.display_name).join(" + "),
        source_lead_id: t.map((x) => x.provider_lead_id).filter(Boolean).join(" "), title: o.title, service: o.service, location: o.location,
        status: o.status, received_at: o.received_at, first_response_at: o.first_response_at, qualified_at: o.qualified_at, won_at: o.won_at,
        lost_reason: o.lost_reason, revenue: minor(o.revenue_minor), duplicate_status: o.duplicate_status, data_quality: o.data_quality_status,
      };
    }));
    filename = `${slug}-leads-${range.key}-${stamp}.csv`;
  } else {
    return NextResponse.json({ error: "Unknown export" }, { status: 404 });
  }

  await supabase.from("audit_events").insert({ workspace_id: workspace.id, actor_user_id: user.id, entity_type: "workspace", entity_id: workspace.id, action: "export", details: { kind, range: sp.get("range") } });
  return new NextResponse(body, { headers: { "Content-Type": `${type}; charset=utf-8`, "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" } });
}
