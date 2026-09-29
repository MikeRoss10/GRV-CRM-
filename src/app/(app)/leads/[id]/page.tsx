import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft, Ban, Bot, CalendarClock, CheckCircle2, CircleDollarSign, Copy, FileText, Inbox, MessageSquare, Phone, ShieldCheck, StickyNote, UserRound,
} from "lucide-react";
import { Badge, ConfidenceMeter, Notice, SectionTitle, SourceBadge, StatusBadge, STATUS_LABEL } from "@/components/ui";
import { ago, dateTime, humanize, minutes, money } from "@/lib/format";
import { evaluatePolicy, fillTemplate } from "@/lib/policy";
import { getEconomics } from "@/lib/economics";
import { can, requireWorkspace } from "@/lib/workspace";
import { assignOwner, completeTask, setSuppression } from "../actions";
import { ActionBar, NoteForm, OutcomeForm, PhoneReveal, ReviewForm } from "./lead-client";

type Contact = { id: string; full_name: string | null; phone_e164: string | null; phone_original: string | null; email: string | null; locality: string | null; language: string | null; do_not_contact: boolean; do_not_contact_reason: string | null };

export default async function LeadDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, workspace, role, members, user } = await requireWorkspace();
  const cur = workspace.default_currency;
  const tz = workspace.timezone;

  const { data: opp } = await supabase
    .from("opportunities")
    .select("*, contacts(*), source_touches(*, source_accounts(display_name, source_type))")
    .eq("id", id)
    .eq("workspace_id", workspace.id)
    .single();
  if (!opp) notFound();
  const contact = opp.contacts as unknown as Contact;

  const now = Date.now();
  const business = can.seeBusiness(role);
  const [msgs, calls, tasks, audits, consents, costs, raws, templates, policyRow, dupOf, dupChildren, econ, otherOpps] = await Promise.all([
    supabase.from("messages").select("*").eq("opportunity_id", id).order("sent_at"),
    supabase.from("calls").select("*").eq("opportunity_id", id).order("started_at"),
    supabase.from("tasks").select("*").eq("opportunity_id", id).order("due_at"),
    supabase.from("audit_events").select("*").eq("workspace_id", workspace.id).eq("entity_id", id).order("created_at"),
    supabase.from("consent_events").select("*").eq("opportunity_id", id),
    business ? supabase.from("cost_events").select("*").eq("opportunity_id", id) : Promise.resolve({ data: [] as Array<{ amount_minor: number; occurred_at: string; cost_type: string; notes: string | null }> }),
    can.seeRaw(role) ? supabase.from("raw_events").select("id, event_type, payload, parse_status, parser_version, received_at, provider_occurred_at").eq("opportunity_id", id) : Promise.resolve({ data: null }),
    supabase.from("message_templates").select("*").eq("workspace_id", workspace.id).eq("approved", true).order("name"),
    supabase.from("call_policies").select("*").eq("workspace_id", workspace.id).maybeSingle(),
    opp.duplicate_of_id ? supabase.from("opportunities").select("id, title, received_at, status, source_touches(source_accounts(display_name, source_type))").eq("id", opp.duplicate_of_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("opportunities").select("id, title, received_at, duplicate_status").eq("duplicate_of_id", id),
    getEconomics(new Date(now - 30 * 86400000).toISOString(), new Date(now).toISOString()),
    supabase.from("opportunities").select("id, title, received_at, status").eq("contact_id", contact.id).neq("id", id).order("received_at", { ascending: false }).limit(5),
  ]);

  const touches = ((opp.source_touches as unknown as Array<{ id: string; source_account_id: string; provider_lead_id: string | null; campaign_name: string | null; observed_at: string; shared_lead_evidence: string; touch_type: string; source_accounts: { display_name: string; source_type: string } }>) ?? [])
    .sort((a, b) => a.observed_at.localeCompare(b.observed_at));
  const primary = touches[0];
  const direct = (costs.data ?? []).reduce((s, c) => s + Number(c.amount_minor), 0);
  const srcEcon = primary ? econ.rows.find((r) => r.source_account_id === primary.source_account_id) : undefined;
  const estCost = (costs.data ?? []).length ? direct : srcEcon?.cpl ?? null;
  const costIsActual = (costs.data ?? []).length > 0;

  const policyInput = {
    contact,
    opportunity: { status: opp.status, parser_confidence: opp.parser_confidence, received_at: opp.received_at },
    consents: consents.data ?? [],
    workspace,
  };
  const cp = policyRow.data;
  const voicePolicy = evaluatePolicy({ ...policyInput, channel: "voice" });
  const aiPolicy = evaluatePolicy({ ...policyInput, channel: "voice", ai: true, callPolicy: cp });
  const messagePolicies = {
    sms: evaluatePolicy({ ...policyInput, channel: "sms" }),
    whatsapp: evaluatePolicy({ ...policyInput, channel: "whatsapp" }),
    email: evaluatePolicy({ ...policyInput, channel: "email" }),
  };
  const vars = { name: contact.full_name?.split(" ")[0] ?? "there", service: opp.service ?? "your enquiry", business: workspace.name };
  const tplList = (templates.data ?? []).map((t) => ({ id: t.id, name: t.name, channel: t.channel, language: t.language, preview: fillTemplate(t.body, vars) }));
  const memberName = (uid: string | null) => (uid ? members.find((m) => m.user_id === uid)?.name ?? "Someone" : "LeadLens");
  const readOnly = !can.work(role);
  const responseMin = opp.first_response_at ? (new Date(opp.first_response_at).getTime() - new Date(opp.received_at).getTime()) / 60000 : null;

  // Timeline: every state change, message, call, task and cost in one ordered list.
  type Item = { at: string; icon: React.ReactNode; title: React.ReactNode; body?: React.ReactNode; tone?: string };
  const items: Item[] = [
    { at: opp.received_at, icon: <Inbox className="size-3.5" />, title: <>Lead received{primary && <> from <b>{primary.source_accounts.display_name}</b></>}</>, body: [opp.service, opp.location].filter(Boolean).join(" · ") },
    ...(raws.data ?? []).map((r) => ({ at: r.received_at, icon: <FileText className="size-3.5" />, title: <>Parsed {r.event_type} with {r.parser_version ?? "parser"}</>, body: `Status: ${humanize(r.parse_status)} · confidence ${Math.round((opp.parser_confidence ?? 1) * 100)}%` })),
    ...touches.slice(1).map((t) => ({ at: t.observed_at, icon: <Copy className="size-3.5" />, title: <>Also seen via <b>{t.source_accounts.display_name}</b></> })),
    ...(msgs.data ?? []).map((m) => ({
      at: m.sent_at ?? opp.received_at,
      icon: m.channel === "internal_note" ? <StickyNote className="size-3.5" /> : <MessageSquare className="size-3.5" />,
      title: m.channel === "internal_note" ? <>{memberName(m.author_user_id)} added a note</> : <>{m.direction === "outbound" ? `${memberName(m.author_user_id)} sent` : "Received"} {m.channel.toUpperCase()}</>,
      body: m.body_redacted,
    })),
    ...(calls.data ?? []).map((c) => ({
      at: c.started_at ?? opp.received_at,
      icon: c.call_type.startsWith("ai") ? <Bot className="size-3.5" /> : <Phone className="size-3.5" />,
      title: <>{memberName(c.user_id)} called · {humanize(c.status)}{c.outcome && <> · <b>{humanize(c.outcome)}</b></>}{c.duration_seconds ? ` · ${minutes(c.duration_seconds / 60)}` : ""}</>,
      body: c.summary,
    })),
    ...(tasks.data ?? []).map((t) => ({ at: t.created_at, icon: <CalendarClock className="size-3.5" />, title: <>Task “{t.title ?? humanize(t.task_type)}” for {memberName(t.assignee_user_id)} · due {dateTime(t.due_at, tz)}</>, body: t.status !== "open" ? humanize(t.status) : undefined })),
    ...(costs.data ?? []).map((c) => ({ at: c.occurred_at, icon: <CircleDollarSign className="size-3.5" />, title: <>Source cost {money(Number(c.amount_minor), cur)} ({humanize(c.cost_type)})</>, body: c.notes })),
    ...(audits.data ?? []).map((a) => {
      const d = a.details as Record<string, string | null>;
      const title =
        a.action === "status_changed" ? <>{memberName(a.actor_user_id)} changed status: {STATUS_LABEL[d.from ?? ""] ?? d.from} → <b>{STATUS_LABEL[d.to ?? ""] ?? d.to}</b>{d.lost_reason && d.to === "lost" ? ` (${humanize(d.lost_reason)})` : ""}</>
        : a.action === "owner_changed" ? <>{memberName(a.actor_user_id)} assigned to <b>{d.to ? memberName(d.to) : "nobody"}</b></>
        : a.action === "revenue_changed" ? <>Revenue set to <b>{money(Number(d.to), cur)}</b></>
        : a.action === "phone_revealed" ? <>{memberName(a.actor_user_id)} revealed the phone number</>
        : <>{memberName(a.actor_user_id)}: {humanize(a.action)}</>;
      return { at: a.created_at, icon: <UserRound className="size-3.5" />, title };
    }),
  ].sort((a, b) => a.at.localeCompare(b.at));

  const openTasks = (tasks.data ?? []).filter((t) => t.status === "open");
  const voiceBasis = (consents.data ?? []).find((c) => c.channel === "voice" && !c.revoked_at);

  return (
    <div className="pb-28 lg:pb-0">
      <Link href="/leads" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4" aria-hidden />Leads</Link>

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{contact.full_name ?? "Unknown name"}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
            <StatusBadge status={opp.status} />
            {primary && <SourceBadge type={primary.source_accounts.source_type} name={primary.source_accounts.display_name} />}
            <span>· received {ago(opp.received_at)} ago</span>
            {business && <span>· {estCost === null ? <span className="text-amber-700">source cost unknown</span> : <>{money(estCost, cur)} {costIsActual ? "actual" : "estimated"} source cost</>}</span>}
          </div>
        </div>
        {can.work(role) && (
          <form action={assignOwner} className="flex items-center gap-2">
            <input type="hidden" name="id" value={id} />
            <label className="sr-only" htmlFor="owner">Owner</label>
            <select id="owner" name="owner_user_id" defaultValue={opp.owner_user_id ?? ""} className="input !w-auto !py-1.5">
              <option value="">Unassigned</option>
              {members.filter((m) => m.active && m.role !== "analyst").map((m) => <option key={m.user_id} value={m.user_id}>{m.user_id === user.id ? `${m.name} (me)` : m.name}</option>)}
            </select>
            <button className="btn-secondary !py-1.5">Assign</button>
          </form>
        )}
      </div>

      <div className="space-y-3">
        {contact.do_not_contact && <Notice tone="crit" title="Do not contact">This contact is suppressed ({humanize(contact.do_not_contact_reason)}). Calls and messages are blocked.</Notice>}
        {opp.data_quality_status === "needs_review" && !readOnly && (
          <div className="card border-amber-100 p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-amber-700"><ShieldCheck className="size-4" aria-hidden />Parser confidence is low — confirm these fields before contacting</div>
            <ReviewForm id={id} contactId={contact.id} values={{ full_name: contact.full_name ?? "", phone: contact.phone_e164 ?? contact.phone_original ?? "", service: opp.service ?? "", location: opp.location ?? "" }} />
          </div>
        )}
        {opp.duplicate_status === "probable" && dupOf.data && (
          <Notice title={`Probable duplicate (${Math.round((opp.duplicate_confidence ?? 0) * 100)}% match)`} action={<Link href={`/leads/duplicates?focus=${id}`} className="btn-secondary !py-1 text-xs whitespace-nowrap">Compare</Link>}>
            Same {Number(opp.duplicate_confidence) >= 0.9 ? "phone number" : "email"} as <Link className="underline" href={`/leads/${dupOf.data.id}`}>{dupOf.data.title}</Link> received {ago(dupOf.data.received_at)} ago. Not merged until someone reviews it.
          </Notice>
        )}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
        <div className="space-y-4">
          <section className="card p-4">
            <SectionTitle>Contact</SectionTitle>
            <dl className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-2 text-sm">
              <dt className="text-muted">Phone</dt>
              <dd><PhoneReveal id={id} contactId={contact.id} phone={contact.phone_e164} canReveal={!readOnly} /></dd>
              <dt className="text-muted">Email</dt><dd className="truncate">{contact.email ?? "—"}</dd>
              <dt className="text-muted">Language</dt><dd>{contact.language ?? "Not known"}</dd>
              <dt className="text-muted">Locality</dt><dd>{contact.locality ?? "—"}</dd>
            </dl>
            {(otherOpps.data ?? []).length > 0 && (
              <div className="mt-3 border-t border-line pt-3 text-xs text-muted">
                Other enquiries from this person:{" "}
                {(otherOpps.data ?? []).map((o, i) => <span key={o.id}>{i > 0 && ", "}<Link href={`/leads/${o.id}`} className="text-navy-700 underline">{o.title}</Link> ({ago(o.received_at)})</span>)}
              </div>
            )}
          </section>

          <section className="card p-4">
            <SectionTitle>Enquiry</SectionTitle>
            <dl className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-2 text-sm">
              <dt className="text-muted">Service</dt><dd>{opp.service ?? <span className="text-amber-700">Missing</span>}</dd>
              <dt className="text-muted">Location</dt><dd>{opp.location ?? "—"}</dd>
              <dt className="text-muted">Budget</dt><dd className="tnum">{money(opp.budget_minor, cur, { compact: true })}</dd>
              <dt className="text-muted">Details</dt><dd>{opp.requirement_text ?? "—"}</dd>
              {opp.revenue_minor !== null && <><dt className="text-muted">Revenue</dt><dd className="font-medium tnum">{money(opp.revenue_minor, cur)}</dd></>}
            </dl>
          </section>

          <section className="card p-4">
            <SectionTitle>Source evidence</SectionTitle>
            <ul className="space-y-3 text-sm">
              {touches.map((t) => (
                <li key={t.id} className="rounded-lg bg-stone-50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <SourceBadge type={t.source_accounts.source_type} name={t.source_accounts.display_name} className="font-medium" />
                    <span className="text-xs text-muted">{dateTime(t.observed_at, tz)}</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                    <span>{humanize(t.touch_type)}</span>
                    {t.provider_lead_id && <span>Lead ID {t.provider_lead_id}</span>}
                    {t.campaign_name && <span>{t.campaign_name}</span>}
                  </div>
                  {t.shared_lead_evidence !== "none" && (
                    <div className="mt-2"><Badge tone="navy">{t.shared_lead_evidence === "source_stated" ? "Source says this lead was shared with other businesses" : humanize(t.shared_lead_evidence)}</Badge></div>
                  )}
                </li>
              ))}
            </ul>
            <div className="mt-3 flex items-center justify-between text-sm">
              <span className="text-muted">Parser confidence</span>
              <ConfidenceMeter value={opp.parser_confidence} />
            </div>
            {business && (
            <div className="mt-2 flex items-center justify-between text-sm">
              <span className="text-muted">Source cost</span>
              <span className="tnum">
                {estCost === null ? <span className="text-amber-700">Unknown — no cost recorded</span> : costIsActual ? `${money(estCost, cur)} (stated by source)` : `${money(estCost, cur)} (30-day CPL, allocated)`}
              </span>
            </div>
            )}
            {raws.data?.map((r) => (
              <details key={r.id} className="mt-3 text-sm">
                <summary className="cursor-pointer text-xs font-medium text-teal-700">View raw {r.event_type} message</summary>
                <pre className="mt-2 max-h-60 overflow-auto rounded-lg bg-navy-950 p-3 text-xs whitespace-pre-wrap text-white/85">{r.payload}</pre>
              </details>
            ))}
            {!can.seeRaw(role) && <p className="mt-3 text-xs text-faint">Raw messages are hidden for analysts.</p>}
          </section>
        </div>

        <div className="order-first space-y-4 lg:order-none">
          <section className="card p-4">
            {!readOnly ? (
              <ActionBar
                id={id}
                phone={contact.phone_e164}
                voicePolicy={voicePolicy}
                aiPolicy={aiPolicy}
                messagePolicies={messagePolicies}
                templates={tplList}
                disabled={false}
                ai={{
                  script_name: cp?.script_name ?? "Not configured",
                  script_body: cp?.script_body ?? "",
                  disclosure: fillTemplate(cp?.disclosure ?? "", vars),
                  language: cp?.language ?? contact.language ?? "en",
                  recording: !!cp?.recording_enabled,
                  transfer: memberName(cp?.transfer_user_id ?? opp.owner_user_id),
                }}
              />
            ) : (
              <p className="text-sm text-muted">Analysts have read-only access to leads.</p>
            )}
            <div className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-4 text-center text-xs">
              <div><div className="text-muted">First response</div><div className="mt-0.5 font-medium tnum">{responseMin === null ? "Waiting" : minutes(responseMin)}</div></div>
              <div><div className="text-muted">SLA</div><div className={`mt-0.5 font-medium ${responseMin === null ? "" : responseMin <= workspace.default_sla_minutes ? "text-teal-700" : "text-crit-700"}`}>{responseMin === null ? `${workspace.default_sla_minutes} min` : responseMin <= workspace.default_sla_minutes ? "Met" : "Missed"}</div></div>
              <div><div className="text-muted">Owner</div><div className="mt-0.5 truncate font-medium">{opp.owner_user_id ? memberName(opp.owner_user_id) : "Unassigned"}</div></div>
            </div>
          </section>

          {openTasks.length > 0 && (
            <section className="card p-4">
              <SectionTitle>Next action</SectionTitle>
              <ul className="space-y-2">
                {openTasks.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <CalendarClock className={`size-4 ${new Date(t.due_at).getTime() < now ? "text-crit-500" : "text-faint"}`} aria-hidden />
                    <span className="flex-1">{t.title ?? humanize(t.task_type)} · <span className={new Date(t.due_at).getTime() < now ? "font-medium text-crit-700" : "text-muted"}>{dateTime(t.due_at, tz)}</span></span>
                    {!readOnly && (
                      <form action={completeTask} className="flex gap-1">
                        <input type="hidden" name="task_id" value={t.id} />
                        <button name="action" value="complete" className="btn-secondary !px-2 !py-1 text-xs"><CheckCircle2 className="size-3.5" />Done</button>
                        <button name="action" value="snooze" className="btn-ghost !px-2 !py-1 text-xs">Snooze</button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="card p-4">
            <SectionTitle>Outcome</SectionTitle>
            <OutcomeForm id={id} status={opp.status} disabled={readOnly} />
          </section>

          <section className="card p-4">
            <SectionTitle>Timeline</SectionTitle>
            <NoteForm id={id} disabled={readOnly} />
            <ol className="relative mt-4 space-y-4 border-l border-line pl-5">
              {items.map((it, i) => (
                <li key={i} className="relative">
                  <span className="absolute top-0.5 -left-[1.95rem] flex size-6 items-center justify-center rounded-full border border-line bg-white text-muted" aria-hidden>{it.icon}</span>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                    <span>{it.title}</span>
                    <time className="text-xs text-faint tnum" dateTime={it.at}>{dateTime(it.at, tz)}</time>
                  </div>
                  {it.body && <p className="mt-0.5 text-sm text-muted">{it.body}</p>}
                </li>
              ))}
            </ol>
          </section>

          {(dupChildren.data ?? []).length > 0 && (
            <section className="card p-4 text-sm">
              <SectionTitle>Linked duplicates</SectionTitle>
              <ul className="space-y-1">
                {(dupChildren.data ?? []).map((d) => (
                  <li key={d.id}><Link href={`/leads/${d.id}`} className="text-navy-700 underline">{d.title}</Link> · {humanize(d.duplicate_status)} · {ago(d.received_at)} ago</li>
                ))}
              </ul>
            </section>
          )}

          {!readOnly && (
            <form action={setSuppression} className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-line p-3 text-sm">
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="contact_id" value={contact.id} />
              <input type="hidden" name="suppress" value={contact.do_not_contact ? "0" : "1"} />
              <span className="text-muted">{contact.do_not_contact ? "Contact is suppressed." : "Customer asked not to be contacted?"}</span>
              <button className={contact.do_not_contact ? "btn-secondary !py-1 text-xs" : "btn-danger !py-1 text-xs"}>
                <Ban className="size-3.5" aria-hidden />{contact.do_not_contact ? "Remove suppression" : "Mark do not contact"}
              </button>
            </form>
          )}
        </div>
      </div>

      {/* Sticky status bar: status, owner and consent basis at a glance. */}
      <div className="no-print fixed inset-x-0 bottom-16 z-30 border-t border-line bg-white/95 px-4 py-2.5 text-xs backdrop-blur lg:sticky lg:bottom-0 lg:mt-6 lg:rounded-xl lg:border">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>Status: <b>{STATUS_LABEL[opp.status]}</b></span>
          <span>Owner: <b>{opp.owner_user_id ? memberName(opp.owner_user_id) : "Unassigned"}</b></span>
          <span className={voiceBasis ? "text-teal-700" : "text-amber-700"}>Consent: <b>{voiceBasis ? `${humanize(voiceBasis.basis_type)} ✓` : "No basis"}</b></span>
          <a href="#act" className="ml-auto font-medium text-teal-700 lg:hidden">Call / message ↑</a>
        </div>
      </div>
    </div>
  );
}
