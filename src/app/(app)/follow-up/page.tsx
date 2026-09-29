import Link from "next/link";
import { Bot, CalendarCheck, CheckCircle2, Circle, XCircle } from "lucide-react";
import { Badge, EmptyState, PageHeader, SectionTitle, SourceBadge, Tabs } from "@/components/ui";
import { dateTime, humanize, maskPhone } from "@/lib/format";
import { evaluatePolicy, localMinutes } from "@/lib/policy";
import { can, requireWorkspace } from "@/lib/workspace";
import { completeTask } from "../leads/actions";

export const metadata = { title: "Follow-up" };

type Task = {
  id: string; title: string | null; task_type: string; due_at: string; priority: string; assignee_user_id: string | null;
  opportunities: { id: string; title: string; status: string; contacts: { full_name: string | null } };
};

export default async function FollowUpPage({ searchParams }: { searchParams: Promise<{ who?: string; tab?: string }> }) {
  const sp = await searchParams;
  const tab = sp.tab === "ai" ? "ai" : "tasks";
  const who = sp.who === "all" ? "all" : "mine";
  const { supabase, workspace, user, role, members } = await requireWorkspace();
  const now = new Date();

  let tq = supabase.from("tasks")
    .select("id, title, task_type, due_at, priority, assignee_user_id, opportunities(id, title, status, contacts(full_name))")
    .eq("workspace_id", workspace.id).eq("status", "open").order("due_at").limit(200);
  if (who === "mine") tq = tq.eq("assignee_user_id", user.id);
  const { data: taskRows } = await tq;
  const tasks = (taskRows ?? []) as unknown as Task[];

  // End of "today" in the workspace timezone, independent of the server's timezone.
  const minsLeft = 24 * 60 - localMinutes(now, workspace.timezone);
  const endOfDay = new Date(now.getTime() + minsLeft * 60000 - 1000);
  const groups = [
    { key: "overdue", label: "Overdue", items: tasks.filter((t) => new Date(t.due_at) < now) },
    { key: "today", label: "Today", items: tasks.filter((t) => new Date(t.due_at) >= now && new Date(t.due_at) <= endOfDay) },
    { key: "later", label: "Upcoming", items: tasks.filter((t) => new Date(t.due_at) > endOfDay) },
  ];
  const memberName = (id: string | null) => members.find((m) => m.user_id === id)?.name ?? "Unassigned";

  return (
    <div>
      <PageHeader title="Follow-up" description="Tasks, callbacks and the AI call queue." />
      <Tabs
        active={tab}
        items={[
          { key: "tasks", label: "Tasks", href: `/follow-up?who=${who}`, count: tasks.length },
          { key: "ai", label: "AI call queue", href: "/follow-up?tab=ai" },
        ]}
      />
      {tab === "tasks" ? (
        <>
          <div className="mt-3 flex gap-2 text-sm">
            <Link href="/follow-up?who=mine" className={who === "mine" ? "font-medium text-ink underline" : "text-muted"}>My tasks</Link>
            <span className="text-faint">·</span>
            <Link href="/follow-up?who=all" className={who === "all" ? "font-medium text-ink underline" : "text-muted"}>Everyone</Link>
          </div>
          {tasks.length === 0 ? (
            <div className="card mt-4"><EmptyState icon={<CalendarCheck className="size-5" />} title="Nothing scheduled">Follow-ups you schedule from a lead appear here.</EmptyState></div>
          ) : (
            <div className="mt-4 space-y-5">
              {groups.filter((g) => g.items.length).map((g) => (
                <section key={g.key}>
                  <SectionTitle><span className={g.key === "overdue" ? "text-crit-700" : ""}>{g.label} · {g.items.length}</span></SectionTitle>
                  <ul className="card divide-y divide-line">
                    {g.items.map((t) => (
                      <li key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                        <div className="min-w-0 flex-1">
                          <Link href={`/leads/${t.opportunities.id}`} className="font-medium hover:underline">{t.title ?? humanize(t.task_type)} · {t.opportunities.contacts.full_name ?? "Unknown"}</Link>
                          <div className="text-xs text-muted">
                            {t.opportunities.title} · due <span className={g.key === "overdue" ? "font-medium text-crit-700" : ""}>{dateTime(t.due_at, workspace.timezone)}</span>
                            {who === "all" && <> · {memberName(t.assignee_user_id)}</>}
                          </div>
                        </div>
                        {t.priority !== "normal" && <Badge tone={t.priority === "high" || t.priority === "urgent" ? "amber" : "neutral"}>{humanize(t.priority)}</Badge>}
                        {can.work(role) && (
                          <form action={completeTask} className="flex gap-1">
                            <input type="hidden" name="task_id" value={t.id} />
                            <button name="action" value="complete" className="btn-secondary !px-2 !py-1 text-xs"><CheckCircle2 className="size-3.5" />Done</button>
                            <button name="action" value="snooze" className="btn-ghost !px-2 !py-1 text-xs">Tomorrow</button>
                            <button name="action" value="cancel" className="btn-ghost !px-2 !py-1 text-xs">Cancel</button>
                          </form>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </>
      ) : (
        <AiQueue />
      )}
    </div>
  );
}

async function AiQueue() {
  const { supabase, workspace } = await requireWorkspace();
  const [{ data: policy }, { data: leads }] = await Promise.all([
    supabase.from("call_policies").select("*").eq("workspace_id", workspace.id).maybeSingle(),
    supabase.from("opportunities")
      .select("id, title, status, parser_confidence, received_at, contacts(full_name, phone_e164, do_not_contact, do_not_contact_reason), consent_events(channel, basis_type, captured_at, expires_at, revoked_at, purpose), source_touches(source_accounts(display_name, source_type))")
      .eq("workspace_id", workspace.id).in("status", ["new", "assigned", "attempting_contact"])
      .gte("received_at", new Date(Date.now() - 14 * 86400000).toISOString()).order("received_at", { ascending: false }).limit(25),
  ]);

  const setup = [
    { ok: !!policy?.provider, label: "Connect a voice provider (KYC, India number series, media anchoring)" },
    { ok: !!policy?.provider_compliance_complete, label: "Complete provider compliance review" },
    { ok: !!policy?.script_body, label: "Write the qualification script with disclosure and opt-out" },
    { ok: !!policy?.approved_at, label: "Owner approves the script" },
    { ok: !!policy?.enabled, label: "Turn on the AI call policy" },
  ];

  return (
    <div className="mt-4 space-y-4">
      {!setup.every((s) => s.ok) && (
        <section className="card p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-navy-50 p-2 text-navy-700"><Bot className="size-5" aria-hidden /></div>
            <div className="flex-1">
              <h2 className="font-semibold">AI calling setup</h2>
              <p className="mt-1 text-sm text-muted">AI calls are limited to following up on a customer&apos;s own enquiry, inside allowed hours, with a human transfer option. Every item below must be complete.</p>
              <ul className="mt-3 space-y-1.5 text-sm">
                {setup.map((s) => (
                  <li key={s.label} className="flex items-center gap-2">
                    {s.ok ? <CheckCircle2 className="size-4 text-teal-600" aria-label="Done" /> : <Circle className="size-4 text-faint" aria-label="Not done" />}
                    <span className={s.ok ? "text-muted line-through" : ""}>{s.label}</span>
                  </li>
                ))}
              </ul>
              <Link href="/settings#ai" className="btn-secondary mt-4">Open AI call settings</Link>
            </div>
          </div>
        </section>
      )}
      <section className="card overflow-hidden">
        <div className="px-4 pt-4"><SectionTitle>Leads awaiting contact · eligibility</SectionTitle></div>
        <ul className="divide-y divide-line">
          {(leads ?? []).map((l) => {
            const contact = l.contacts as unknown as { full_name: string | null; phone_e164: string | null; do_not_contact: boolean; do_not_contact_reason: string | null };
            const src = (l.source_touches as unknown as Array<{ source_accounts: { display_name: string; source_type: string } }>)[0]?.source_accounts;
            const r = evaluatePolicy({
              channel: "voice", ai: true, contact, callPolicy: policy,
              opportunity: { status: l.status, parser_confidence: l.parser_confidence, received_at: l.received_at },
              consents: (l.consent_events as unknown as Parameters<typeof evaluatePolicy>[0]["consents"]) ?? [], workspace,
            });
            const leadBlocks = r.checks.filter((c) => !c.ok && !["policy", "provider", "script"].includes(c.key));
            return (
              <li key={l.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <Link href={`/leads/${l.id}`} className="font-medium hover:underline">{contact.full_name ?? "Unknown"}</Link>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                    <span className="tnum">{maskPhone(contact.phone_e164)}</span>
                    {src && <SourceBadge type={src.source_type} name={src.display_name} className="!text-xs" />}
                    <span>{l.title}</span>
                  </div>
                </div>
                {r.allowed ? (
                  <Badge tone="teal"><CheckCircle2 className="size-3" />Eligible</Badge>
                ) : leadBlocks.length ? (
                  <Badge tone="crit" title={leadBlocks.map((c) => c.detail).join(" · ")}><XCircle className="size-3" />{leadBlocks[0].label}: {leadBlocks[0].detail.split(" — ")[0]}</Badge>
                ) : (
                  <Badge tone="amber">Lead OK · waiting on AI setup</Badge>
                )}
              </li>
            );
          })}
          {!leads?.length && <li className="px-4 py-6 text-center text-sm text-muted">No open leads in the last 14 days.</li>}
        </ul>
      </section>
    </div>
  );
}
