import Link from "next/link";
import { Copy, Filter, Inbox, Plus, Upload } from "lucide-react";
import { AgeClock, Badge, EmptyState, PageHeader, SourceBadge, StatusBadge, STATUS_LABEL, Tabs } from "@/components/ui";
import { getEconomics } from "@/lib/economics";
import { maskPhone, money } from "@/lib/format";
import { can, requireWorkspace } from "@/lib/workspace";
import { claimLead } from "./actions";

export const metadata = { title: "Leads" };

const OPEN = ["new", "assigned", "attempting_contact", "contacted", "qualified", "appointment", "proposal", "nurture"];

type SP = { view?: string; source?: string; status?: string; owner?: string; q?: string; age?: string };

export default async function LeadsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const view = sp.view ?? "all";
  const { supabase, workspace, user, role, members } = await requireWorkspace();
  const now = Date.now();
  const business = can.seeBusiness(role);
  const sla = workspace.default_sla_minutes;
  const cur = workspace.default_currency;

  const [{ data: sources }, econ] = await Promise.all([
    supabase.from("source_accounts").select("id, display_name, source_type").eq("workspace_id", workspace.id).neq("status", "archived").order("display_name"),
    getEconomics(new Date(now - 30 * 86400000).toISOString(), new Date(now).toISOString()),
  ]);
  const cplBySource = new Map(econ.rows.map((r) => [r.source_account_id, r]));

  let q = supabase
    .from("opportunities")
    .select("id, title, status, owner_user_id, service, location, received_at, first_response_at, duplicate_status, data_quality_status, parser_confidence, revenue_minor, contact_id, contacts(full_name, phone_e164, do_not_contact), source_touches!inner(source_account_id, provider_lead_id, shared_lead_evidence, observed_at)", { count: "exact" })
    .eq("workspace_id", workspace.id)
    .order("received_at", { ascending: false })
    .limit(100);

  if (view === "new") q = q.eq("status", "new");
  if (view === "unassigned") q = q.is("owner_user_id", null).in("status", ["new", "assigned", "attempting_contact"]);
  if (view === "sla" || view === "attention") q = q.is("first_response_at", null).in("status", ["new", "assigned"]);
  if (view === "duplicates") q = q.in("duplicate_status", ["probable", "confirmed"]).neq("status", "duplicate");
  if (view === "review") q = q.eq("data_quality_status", "needs_review").in("status", ["new", "assigned", "attempting_contact"]);
  if (view === "mine") q = q.eq("owner_user_id", user.id).in("status", OPEN);
  if (view === "all" && !sp.status) q = q.neq("duplicate_status", "merged");
  if (sp.status) q = q.eq("status", sp.status);
  if (sp.owner) q = sp.owner === "none" ? q.is("owner_user_id", null) : q.eq("owner_user_id", sp.owner);
  if (sp.source) q = q.eq("source_touches.source_account_id", sp.source);
  if (sp.age) q = q.gte("received_at", new Date(now - Number(sp.age) * 3600000).toISOString());
  if (sp.q) {
    const term = sp.q.replace(/[%,()]/g, " ").trim();
    const digits = term.replace(/\D/g, "");
    let cq = supabase.from("contacts").select("id").eq("workspace_id", workspace.id).limit(200);
    cq = digits.length >= 4 ? cq.ilike("phone_e164", `%${digits}%`) : cq.or(`full_name.ilike.%${term}%,email.ilike.%${term}%`);
    const { data: cs } = await cq;
    const ids = (cs ?? []).map((c) => c.id);
    q = q.or([`title.ilike.%${term}%`, `service.ilike.%${term}%`, `location.ilike.%${term}%`, ids.length ? `contact_id.in.(${ids.join(",")})` : null].filter(Boolean).join(","));
  }

  const { data: leads, count, error } = await q;
  const ids = (leads ?? []).map((l) => l.id);
  const [{ data: costs }, { data: tasks }] = await Promise.all([
    ids.length && business ? supabase.from("cost_events").select("opportunity_id, amount_minor").in("opportunity_id", ids) : Promise.resolve({ data: [] }),
    ids.length ? supabase.from("tasks").select("opportunity_id, title, due_at").in("opportunity_id", ids).eq("status", "open").order("due_at") : Promise.resolve({ data: [] }),
  ]);
  const directCost = new Map<string, number>();
  (costs ?? []).forEach((c) => c.opportunity_id && directCost.set(c.opportunity_id, (directCost.get(c.opportunity_id) ?? 0) + Number(c.amount_minor)));
  const nextTask = new Map<string, { title: string | null; due_at: string }>();
  (tasks ?? []).forEach((t) => !nextTask.has(t.opportunity_id) && nextTask.set(t.opportunity_id, t));
  const memberName = new Map(members.map((m) => [m.user_id, m.name]));
  const sourceById = new Map((sources ?? []).map((s) => [s.id, s]));

  const qs = (patch: Partial<SP>) => {
    const p = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/leads${p.size ? `?${p}` : ""}`;
  };

  return (
    <div>
      <PageHeader
        title="Leads"
        description={`${count ?? 0} ${view === "all" ? "leads" : "matching leads"}${sp.q ? ` for “${sp.q}”` : ""}`}
        actions={
          can.work(role) && (
            <>
              <Link href="/leads/duplicates" className="btn-secondary"><Copy className="size-4" aria-hidden />Duplicates</Link>
              {business && <Link href="/connections#import" className="btn-secondary"><Upload className="size-4" aria-hidden />Import</Link>}
              <Link href="/leads/new" className="btn-primary"><Plus className="size-4" aria-hidden />Add lead</Link>
            </>
          )
        }
      />

      <Tabs
        active={view}
        items={[
          { key: "all", label: "All", href: qs({ view: undefined }) },
          { key: "new", label: "New", href: qs({ view: "new" }) },
          { key: "sla", label: "SLA risk", href: qs({ view: "sla" }) },
          { key: "unassigned", label: "Unassigned", href: qs({ view: "unassigned" }) },
          { key: "duplicates", label: "Duplicates", href: qs({ view: "duplicates" }) },
          { key: "review", label: "Needs review", href: qs({ view: "review" }) },
          { key: "mine", label: "Mine", href: qs({ view: "mine" }) },
        ]}
      />

      <form className="mt-3 flex flex-wrap items-end gap-2" action="/leads">
        {view !== "all" && <input type="hidden" name="view" value={view} />}
        <Filter className="mb-2.5 size-4 text-faint" aria-hidden />
        <Select name="source" label="Source" value={sp.source} options={(sources ?? []).map((s) => [s.id, s.display_name])} />
        <Select name="status" label="Status" value={sp.status} options={Object.entries(STATUS_LABEL)} />
        <Select name="owner" label="Owner" value={sp.owner} options={[["none", "Unassigned"], ...members.map((m) => [m.user_id, m.name] as [string, string])]} />
        <Select name="age" label="Age" value={sp.age} options={[["1", "Last hour"], ["24", "Last 24 h"], ["168", "Last 7 days"], ["720", "Last 30 days"]]} />
        <label className="min-w-40 flex-1 sm:max-w-56">
          <span className="sr-only">Search</span>
          <input name="q" defaultValue={sp.q} className="input !py-1.5" placeholder="Search leads" />
        </label>
        <button className="btn-secondary !py-1.5">Apply</button>
        {(sp.source || sp.status || sp.owner || sp.age || sp.q) && <Link href={qs({ source: undefined, status: undefined, owner: undefined, age: undefined, q: undefined })} className="btn-ghost !py-1.5">Clear</Link>}
      </form>

      <div className="card mt-4 overflow-hidden">
        {error && <p className="p-4 text-sm text-crit-700">{error.message}</p>}
        {!leads?.length ? (
          <EmptyState icon={<Inbox className="size-5" />} title="No leads match" action={<Link href="/connections" className="btn-secondary">Connect a source</Link>}>
            Try another view or filter — or connect a source so new enquiries arrive here automatically.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            <li className="hidden grid-cols-[4.5rem_minmax(0,2.2fr)_minmax(0,1.1fr)_7rem_minmax(0,1.2fr)] gap-4 bg-stone-50 md:grid" aria-hidden>
              <span className="table-head">Age</span><span className="table-head">Lead / enquiry</span><span className="table-head">Source</span><span className="table-head">Status</span><span className="table-head">Next</span>
            </li>
            {leads.map((l) => {
              const contact = l.contacts as unknown as { full_name: string | null; phone_e164: string | null; do_not_contact: boolean };
              const touches = (l.source_touches as unknown as Array<{ source_account_id: string; shared_lead_evidence: string; observed_at: string }>) ?? [];
              const first = [...touches].sort((a, b) => a.observed_at.localeCompare(b.observed_at))[0];
              const src = first ? sourceById.get(first.source_account_id) : undefined;
              const direct = directCost.get(l.id);
              const econRow = first ? cplBySource.get(first.source_account_id) : undefined;
              const est = direct ?? econRow?.cpl ?? null;
              const task = nextTask.get(l.id);
              const unanswered = !l.first_response_at && ["new", "assigned"].includes(l.status);
              return (
                <li key={l.id} className="relative grid grid-cols-[1fr_auto] gap-x-3 gap-y-2 px-4 py-3 hover:bg-navy-50/40 md:grid-cols-[4.5rem_minmax(0,2.2fr)_minmax(0,1.1fr)_7rem_minmax(0,1.2fr)] md:items-center md:gap-4">
                  <div className="order-2 md:order-none">
                    {unanswered ? <AgeClock receivedAt={l.received_at} respondedAt={null} slaMinutes={sla} now={now} /> : <AgeText iso={l.received_at} now={now} />}
                  </div>
                  <div className="order-1 min-w-0 md:order-none">
                    <Link href={`/leads/${l.id}`} className="font-medium text-ink after:absolute after:inset-0 hover:underline">
                      {contact?.full_name ?? "Unknown name"}
                    </Link>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                      <span className="tnum">{maskPhone(contact?.phone_e164)}</span>
                      <span aria-hidden>·</span>
                      <span className="truncate">{l.title}</span>
                      {l.duplicate_status === "probable" && <Badge tone="amber">Probable dup.</Badge>}
                      {l.duplicate_status === "confirmed" && <Badge tone="neutral">Duplicate</Badge>}
                      {first?.shared_lead_evidence === "source_stated" && <Badge tone="navy" title="The source said this lead was also sent to other businesses">Shared</Badge>}
                      {l.data_quality_status === "needs_review" && <Badge tone="amber">Review</Badge>}
                      {contact?.do_not_contact && <Badge tone="crit">Do not contact</Badge>}
                    </div>
                  </div>
                  <div className="order-3 col-span-2 flex items-center gap-2 text-xs md:order-none md:col-span-1 md:block">
                    {src ? <SourceBadge type={src.source_type} name={src.display_name} /> : <span className="text-faint">No source</span>}
                    {business && (
                      <div className="text-muted tnum md:mt-0.5">
                        {est === null ? <span className="text-amber-700">cost unknown</span> : <>{money(est, cur)} {direct === undefined && "est."}</>}
                      </div>
                    )}
                  </div>
                  <div className="order-4 md:order-none"><StatusBadge status={l.status} /></div>
                  <div className="relative z-10 order-5 flex items-center justify-end gap-2 text-xs md:order-none md:justify-start">
                    {l.status === "new" && !l.owner_user_id && can.work(role) ? (
                      <form action={claimLead}>
                        <input type="hidden" name="id" value={l.id} />
                        <button className="btn-teal !px-2.5 !py-1 text-xs">Claim</button>
                      </form>
                    ) : unanswered ? (
                      <Link href={`/leads/${l.id}#act`} className="btn-primary !px-2.5 !py-1 text-xs">Call now</Link>
                    ) : task ? (
                      <span className={new Date(task.due_at).getTime() < now ? "font-medium text-crit-700" : "text-muted"}>
                        {task.title ?? "Follow up"} · <AgeText iso={task.due_at} now={now} due />
                      </span>
                    ) : (
                      <span className="text-muted">{l.owner_user_id ? memberName.get(l.owner_user_id) ?? "Owner" : "Unassigned"}</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {(count ?? 0) > 100 && <p className="mt-2 text-xs text-muted">Showing the newest 100 of {count}. Use filters to narrow down.</p>}
    </div>
  );
}

function AgeText({ iso, now, due }: { iso: string; now: number; due?: boolean }) {
  const diff = (now - new Date(iso).getTime()) / 60000;
  const abs = Math.abs(diff);
  const t = abs < 60 ? `${Math.round(abs)}m` : abs < 1440 ? `${Math.round(abs / 60)}h` : `${Math.round(abs / 1440)}d`;
  return <span className="text-xs text-muted tnum">{due ? (diff > 0 ? `${t} overdue` : `in ${t}`) : t}</span>;
}

function Select({ name, label, value, options }: { name: string; label: string; value?: string; options: Array<[string, string]> }) {
  return (
    <label>
      <span className="sr-only">{label}</span>
      <select name={name} defaultValue={value ?? ""} className="input !w-auto !py-1.5">
        <option value="">{label}: all</option>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}
