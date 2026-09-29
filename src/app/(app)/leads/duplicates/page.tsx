import Link from "next/link";
import { ArrowLeft, Copy } from "lucide-react";
import { Badge, EmptyState, PageHeader, SourceBadge, StatusBadge } from "@/components/ui";
import { ago, dateTime, maskPhone, money } from "@/lib/format";
import { can, requireWorkspace } from "@/lib/workspace";
import { confirmDuplicate, dismissDuplicate, mergeDuplicate, unmergeDuplicate } from "../actions";

export const metadata = { title: "Duplicate review" };

type Opp = {
  id: string; title: string; status: string; received_at: string; service: string | null; location: string | null; budget_minor: number | null;
  duplicate_status: string; duplicate_confidence: number | null; duplicate_of_id: string | null;
  contacts: { full_name: string | null; phone_e164: string | null; email: string | null };
  source_touches: Array<{ provider_lead_id: string | null; shared_lead_evidence: string; source_accounts: { display_name: string; source_type: string } }>;
};

const SEL = "id, title, status, received_at, service, location, budget_minor, duplicate_status, duplicate_confidence, duplicate_of_id, contacts(full_name, phone_e164, email), source_touches(provider_lead_id, shared_lead_evidence, source_accounts(display_name, source_type))";

export default async function DuplicatesPage({ searchParams }: { searchParams: Promise<{ focus?: string }> }) {
  const { focus } = await searchParams;
  const { supabase, workspace, role } = await requireWorkspace();
  const cur = workspace.default_currency;

  const { data: dups } = await supabase.from("opportunities").select(SEL).eq("workspace_id", workspace.id)
    .in("duplicate_status", ["probable", "confirmed"]).neq("status", "duplicate").order("received_at", { ascending: false }).limit(50);
  const { data: merged } = await supabase.from("opportunities").select("id, title, received_at, duplicate_of_id").eq("workspace_id", workspace.id).eq("duplicate_status", "merged").order("updated_at", { ascending: false }).limit(10);

  const list = ((dups ?? []) as unknown as Opp[]).sort((a, b) => (a.id === focus ? -1 : b.id === focus ? 1 : 0));
  const parentIds = [...new Set(list.map((d) => d.duplicate_of_id).filter(Boolean))] as string[];
  const { data: parents } = parentIds.length ? await supabase.from("opportunities").select(SEL).in("id", parentIds) : { data: [] };
  const parentById = new Map(((parents ?? []) as unknown as Opp[]).map((p) => [p.id, p]));
  const canMerge = can.manage(role);

  return (
    <div>
      <Link href="/leads" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4" aria-hidden />Leads</Link>
      <PageHeader
        title="Duplicate review"
        description="Same phone or email within 30 days. Nothing is merged automatically; merging keeps both source records and can be undone."
      />
      {list.length === 0 ? (
        <div className="card"><EmptyState icon={<Copy className="size-5" />} title="No duplicates to review">New matches appear here when a person enquires again within 30 days.</EmptyState></div>
      ) : (
        <div className="space-y-4">
          {list.map((d) => {
            const p = d.duplicate_of_id ? parentById.get(d.duplicate_of_id) : undefined;
            return (
              <article key={d.id} className={`card overflow-hidden ${d.id === focus ? "ring-2 ring-teal-500" : ""}`}>
                <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-stone-50 px-4 py-2.5 text-sm">
                  <div className="flex items-center gap-2">
                    <Badge tone={d.duplicate_status === "confirmed" ? "neutral" : "amber"}>{d.duplicate_status === "confirmed" ? "Confirmed" : "Probable"} · {Math.round((d.duplicate_confidence ?? 0) * 100)}%</Badge>
                    <span className="text-muted">Matched on {(d.duplicate_confidence ?? 0) >= 0.9 ? "phone number" : "email"}</span>
                  </div>
                  {canMerge && p && (
                    <div className="flex flex-wrap gap-2">
                      <form action={mergeDuplicate}>
                        <input type="hidden" name="primary" value={p.id} /><input type="hidden" name="secondary" value={d.id} />
                        <button className="btn-primary !py-1 text-xs">Merge into earlier lead</button>
                      </form>
                      {d.duplicate_status === "probable" && (
                        <form action={confirmDuplicate}><input type="hidden" name="id" value={d.id} /><button className="btn-secondary !py-1 text-xs">Confirm, keep separate</button></form>
                      )}
                      <form action={dismissDuplicate}><input type="hidden" name="id" value={d.id} /><button className="btn-ghost !py-1 text-xs">Not a duplicate</button></form>
                    </div>
                  )}
                </header>
                <div className="grid divide-y divide-line md:grid-cols-2 md:divide-x md:divide-y-0">
                  {[p, d].map((o, i) => o ? (
                    <div key={o.id} className="p-4 text-sm">
                      <div className="eyebrow mb-2">{i === 0 ? "Earlier lead" : "New enquiry"}</div>
                      <Link href={`/leads/${o.id}`} className="font-medium hover:underline">{o.contacts.full_name ?? "Unknown"}</Link>
                      <dl className="mt-2 grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1 text-muted">
                        <dt>Received</dt><dd className="text-ink">{dateTime(o.received_at, workspace.timezone)} ({ago(o.received_at)} ago)</dd>
                        <dt>Source</dt><dd>{o.source_touches.map((t, j) => <SourceBadge key={j} type={t.source_accounts.source_type} name={t.source_accounts.display_name} className="mr-2" />)}</dd>
                        <dt>Phone</dt><dd className="text-ink tnum">{maskPhone(o.contacts.phone_e164)}</dd>
                        <dt>Enquiry</dt><dd className="text-ink">{[o.service, o.location].filter(Boolean).join(" · ") || "—"}</dd>
                        <dt>Budget</dt><dd className="text-ink">{money(o.budget_minor, cur, { compact: true })}</dd>
                        <dt>Lead ID</dt><dd className="text-ink">{o.source_touches.map((t) => t.provider_lead_id).filter(Boolean).join(", ") || "—"}</dd>
                        <dt>Status</dt><dd><StatusBadge status={o.status} /></dd>
                      </dl>
                    </div>
                  ) : (
                    <div key={i} className="p-4 text-sm text-muted">Earlier lead is no longer available.</div>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {(merged ?? []).length > 0 && (
        <section className="mt-8">
          <h2 className="eyebrow mb-2">Recently merged</h2>
          <ul className="card divide-y divide-line text-sm">
            {(merged ?? []).map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span><Link href={`/leads/${m.id}`} className="hover:underline">{m.title}</Link> → <Link href={`/leads/${m.duplicate_of_id}`} className="text-navy-700 underline">earlier lead</Link></span>
                {canMerge && <form action={unmergeDuplicate}><input type="hidden" name="id" value={m.id} /><button className="btn-ghost !py-1 text-xs">Undo merge</button></form>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
