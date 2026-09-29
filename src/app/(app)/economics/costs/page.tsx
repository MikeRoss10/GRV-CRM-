import Link from "next/link";
import { ArrowLeft, Trash2 } from "lucide-react";
import { Badge, EmptyState, PageHeader, SectionTitle, SourceBadge } from "@/components/ui";
import { dateOnly, humanize, money } from "@/lib/format";
import { can, requireBusinessAccess } from "@/lib/workspace";
import { deleteCostEvent } from "../actions";
import { AddCostForm, SourceRowForm } from "./forms";

export const metadata = { title: "Cost assumptions" };

export default async function CostsPage() {
  const { supabase, workspace, role } = await requireBusinessAccess();
  const cur = workspace.default_currency;
  const editable = can.manageCosts(role);
  const [{ data: sources }, { data: costs }] = await Promise.all([
    supabase.from("source_accounts").select("*").eq("workspace_id", workspace.id).order("status").order("display_name"),
    supabase.from("cost_events").select("*, source_accounts(display_name, source_type)").eq("workspace_id", workspace.id).is("opportunity_id", null).order("occurred_at", { ascending: false }).limit(200),
  ]);
  const { count: perLead } = await supabase.from("cost_events").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id).not("opportunity_id", "is", null);
  const active = (sources ?? []).filter((s) => s.status !== "archived");

  return (
    <div className="space-y-6">
      <div>
        <Link href="/economics" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4" aria-hidden />Source Economics</Link>
        <PageHeader
          title="Cost assumptions"
          description="Every cost metric traces back to an entry on this page or to a per-lead price stated in a source message."
        />
      </div>

      {editable && (
        <section className="card p-4 sm:p-5">
          <SectionTitle>Add a cost</SectionTitle>
          <AddCostForm sources={active.filter((s) => !s.zero_cost)} currency={cur} />
        </section>
      )}

      <section className="card overflow-hidden">
        <div className="px-4 pt-4 sm:px-5"><SectionTitle>Cost entries</SectionTitle></div>
        {!costs?.length ? (
          <EmptyState title="No costs recorded yet">Add your Justdial package, Sulekha credits or monthly ad spend to calculate CPL and CAC.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-sm">
              <thead className="bg-stone-50"><tr className="border-b border-line">
                <th className="table-head pl-4 sm:pl-5">Source</th><th className="table-head">Type</th><th className="table-head text-right">Amount</th>
                <th className="table-head">Period / date</th><th className="table-head">Allocation</th><th className="table-head">Notes</th><th className="table-head pr-4" />
              </tr></thead>
              <tbody>
                {costs.map((c) => {
                  const s = c.source_accounts as unknown as { display_name: string; source_type: string };
                  return (
                    <tr key={c.id} className="border-b border-line/70">
                      <td className="py-2 pl-4 sm:pl-5"><SourceBadge type={s.source_type} name={s.display_name} /></td>
                      <td className="px-3">{humanize(c.cost_type)}</td>
                      <td className="px-3 text-right font-medium tnum">{money(Number(c.amount_minor), cur)}</td>
                      <td className="px-3 text-muted">{c.period_start ? `${dateOnly(c.period_start)} – ${dateOnly(c.period_end)}` : dateOnly(c.occurred_at)}</td>
                      <td className="px-3"><Badge tone={c.allocation_method === "direct" ? "teal" : "navy"}>{c.allocation_method === "equal_daily" ? "Equal daily" : humanize(c.allocation_method)}</Badge></td>
                      <td className="max-w-56 truncate px-3 text-muted" title={c.notes ?? ""}>{c.notes ?? c.provider_ref ?? "—"}</td>
                      <td className="pr-4 text-right">
                        {editable && (
                          <form action={deleteCostEvent}><input type="hidden" name="id" value={c.id} />
                            <button className="btn-ghost !p-1.5" aria-label="Delete cost entry"><Trash2 className="size-4" /></button>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="border-t border-line px-4 py-2 text-xs text-muted sm:px-5">
          Plus {perLead ?? 0} per-lead charges captured from source messages (shown on each lead). Deleting an entry is recorded in the audit log.
        </p>
      </section>

      <section className="card p-4 sm:p-5">
        <SectionTitle>Sources</SectionTitle>
        <div className="space-y-4">
          {(sources ?? []).map((s) => (
            <div key={s.id} className="border-b border-line pb-4 last:border-0">
              <div className="mb-2 flex items-center gap-2">
                <SourceBadge type={s.source_type} name={s.display_name} className="font-medium" />
                {s.zero_cost && <Badge tone="teal">No direct cost</Badge>}
                {s.status !== "active" && <Badge>{humanize(s.status)}</Badge>}
              </div>
              {editable && <SourceRowForm source={s} />}
            </div>
          ))}
          {editable && (
            <div className="rounded-xl bg-stone-50 p-3">
              <div className="mb-2 text-sm font-medium">Add a source account</div>
              <SourceRowForm />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
