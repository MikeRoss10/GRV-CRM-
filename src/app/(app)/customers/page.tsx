import Link from "next/link";
import { Users } from "lucide-react";
import { Badge, EmptyState, PageHeader, SourceBadge, StatusBadge } from "@/components/ui";
import { ago, maskPhone } from "@/lib/format";
import { requireWorkspace } from "@/lib/workspace";

export const metadata = { title: "Customers" };

type Opp = {
  id: string; title: string; status: string; received_at: string; owner_user_id: string | null;
  source_touches: Array<{ source_accounts: { display_name: string; source_type: string } }>;
};
type Contact = {
  id: string; full_name: string | null; phone_e164: string | null; email: string | null; locality: string | null;
  do_not_contact: boolean; updated_at: string; opportunities: Opp[];
};

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; mine?: string }> }) {
  const { q, mine } = await searchParams;
  const { supabase, workspace, user, members } = await requireWorkspace();

  let query = supabase
    .from("contacts")
    .select("id, full_name, phone_e164, email, locality, do_not_contact, updated_at, opportunities(id, title, status, received_at, owner_user_id, source_touches(source_accounts(display_name, source_type)))", { count: "exact" })
    .eq("workspace_id", workspace.id)
    .order("updated_at", { ascending: false })
    .limit(100);
  if (q) {
    const term = q.replace(/[%,()]/g, " ").trim();
    const digits = term.replace(/\D/g, "");
    query = digits.length >= 4 ? query.ilike("phone_e164", `%${digits}%`) : query.or(`full_name.ilike.%${term}%,email.ilike.%${term}%,locality.ilike.%${term}%`);
  }
  const { data, count, error } = await query;
  let customers = ((data ?? []) as unknown as Contact[]).filter((c) => c.opportunities.length > 0);
  if (mine) customers = customers.filter((c) => c.opportunities.some((o) => o.owner_user_id === user.id));
  const ownerName = (id: string | null) => (id ? members.find((m) => m.user_id === id)?.name ?? "—" : "Unassigned");

  return (
    <div>
      <PageHeader title="Customers" description={`${count ?? 0} people who have enquired. Each can have several enquiries across sources.`} />

      <form action="/customers" className="mb-4 flex flex-wrap items-center gap-2">
        <label className="min-w-48 flex-1 sm:max-w-sm">
          <span className="sr-only">Search customers</span>
          <input name="q" defaultValue={q} className="input !py-1.5" placeholder="Name, phone, email or area" />
        </label>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" name="mine" value="1" defaultChecked={!!mine} className="size-4 accent-teal-600" />
          Only my customers
        </label>
        <button className="btn-secondary !py-1.5">Search</button>
        {(q || mine) && <Link href="/customers" className="btn-ghost !py-1.5">Clear</Link>}
      </form>

      <div className="card overflow-hidden">
        {error && <p className="p-4 text-sm text-crit-700">{error.message}</p>}
        {customers.length === 0 ? (
          <EmptyState icon={<Users className="size-5" />} title="No customers found">Customers appear here as soon as a lead comes in.</EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            <li className="hidden grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1.8fr)_minmax(0,0.9fr)] gap-4 bg-stone-50 md:grid" aria-hidden>
              <span className="table-head">Customer</span><span className="table-head">Area</span><span className="table-head">Latest enquiry</span><span className="table-head">Owner</span>
            </li>
            {customers.map((c) => {
              const opps = [...c.opportunities].sort((a, b) => b.received_at.localeCompare(a.received_at));
              const latest = opps[0];
              const src = latest.source_touches[0]?.source_accounts;
              return (
                <li key={c.id} className="relative grid gap-2 px-4 py-3 hover:bg-navy-50/40 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1.8fr)_minmax(0,0.9fr)] md:items-center md:gap-4">
                  <div className="min-w-0">
                    <Link href={`/leads/${latest.id}`} className="font-medium after:absolute after:inset-0 hover:underline">{c.full_name ?? "Unknown name"}</Link>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                      <span className="tnum">{maskPhone(c.phone_e164)}</span>
                      {c.email && <><span aria-hidden>·</span><span className="truncate">{c.email}</span></>}
                      {c.do_not_contact && <Badge tone="crit">Do not contact</Badge>}
                      {opps.length > 1 && <Badge tone="navy">{opps.length} enquiries</Badge>}
                    </div>
                  </div>
                  <div className="text-sm text-muted">{c.locality ?? "—"}</div>
                  <div className="min-w-0 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={latest.status} />
                      <span className="truncate">{latest.title}</span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                      {src && <SourceBadge type={src.source_type} name={src.display_name} className="!text-xs" />}
                      <span>· {ago(latest.received_at)} ago</span>
                    </div>
                  </div>
                  <div className="text-sm text-muted">{ownerName(latest.owner_user_id)}</div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {(count ?? 0) > 100 && <p className="mt-2 text-xs text-muted">Showing the 100 most recently active. Search to find others.</p>}
    </div>
  );
}
