import Link from "next/link";
import { Badge, PageHeader, SectionTitle } from "@/components/ui";
import { ago, humanize, maskPhone } from "@/lib/format";
import { can, requireBusinessAccess, ROLE_LABEL } from "@/lib/workspace";
import { demoData, revokeInvite, toggleTemplate, unsuppress, updateMember } from "./actions";
import { CallPolicyForm, InviteForm, TemplateForm, WorkspaceForm } from "./forms";

export const metadata = { title: "Settings" };

const ROLE_HELP: Record<string, string> = {
  owner: "Admin: everything, including team, exports, ingest token and AI call policy",
  manager: "Admin: dashboards, spend and costs, reports, connections, templates, duplicate merges",
  rep: "Worker: only customers and leads — call, message, log outcomes, follow-ups. No spend, reports or settings",
  analyst: "Dashboards, spend and reports; read-only leads; no raw messages",
};

export default async function SettingsPage() {
  const { supabase, workspace, role, members, user } = await requireBusinessAccess();
  const isOwner = can.own(role);
  const [{ data: invites }, { data: templates }, { data: policy }, { data: suppressed }, { data: audits }, { count: demoCount }] = await Promise.all([
    isOwner ? supabase.from("workspace_invites").select("*").eq("workspace_id", workspace.id).is("accepted_at", null) : Promise.resolve({ data: [] }),
    supabase.from("message_templates").select("*").eq("workspace_id", workspace.id).order("created_at"),
    supabase.from("call_policies").select("*").eq("workspace_id", workspace.id).maybeSingle(),
    supabase.from("contacts").select("id, full_name, phone_e164, do_not_contact_reason, updated_at").eq("workspace_id", workspace.id).eq("do_not_contact", true).order("updated_at", { ascending: false }).limit(50),
    supabase.from("audit_events").select("id, actor_user_id, entity_type, action, details, created_at").eq("workspace_id", workspace.id).order("created_at", { ascending: false }).limit(40),
    supabase.from("opportunities").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id).contains("tags", ["demo"]),
  ]);
  const nameOf = (id: string | null) => (id ? members.find((m) => m.user_id === id)?.name ?? "Former member" : "System");

  return (
    <div className="space-y-5">
      <PageHeader title="Settings" description={`You are signed in as ${ROLE_LABEL[role]} in ${workspace.name}.`} actions={<Link href="/onboarding?new=1" className="btn-secondary">New workspace</Link>} />

      <section className="card p-4 sm:p-5">
        <SectionTitle>Workspace</SectionTitle>
        <WorkspaceForm ws={workspace} disabled={!isOwner} />
        <p className="mt-3 text-xs text-muted">Currency: {workspace.default_currency}. Staff cost turns talk time into response cost for CAC. The contact window applies to calls and messages.</p>
      </section>

      <section className="card p-4 sm:p-5">
        <SectionTitle>Users and roles</SectionTitle>
        <ul className="divide-y divide-line">
          {members.map((m) => (
            <li key={m.user_id} className="py-2.5">
              <form action={updateMember} className="flex flex-wrap items-center gap-3 text-sm">
                <input type="hidden" name="user_id" value={m.user_id} />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{m.name}{m.user_id === user.id && <span className="text-muted"> (you)</span>}</div>
                  <div className="text-xs text-muted">{m.email}</div>
                </div>
                {isOwner && m.user_id !== user.id ? (
                  <>
                    <select name="role" defaultValue={m.role} className="input !w-auto !py-1" aria-label={`Role for ${m.name}`}>
                      {(Object.keys(ROLE_LABEL) as Array<keyof typeof ROLE_LABEL>).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                    </select>
                    <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" name="active" defaultChecked={m.active} className="size-4 accent-teal-600" />Active</label>
                    <button className="btn-secondary !py-1 text-xs">Save</button>
                  </>
                ) : (
                  <Badge tone="navy">{ROLE_LABEL[m.role]}</Badge>
                )}
              </form>
            </li>
          ))}
          {(invites ?? []).map((i) => (
            <li key={i.id} className="flex items-center gap-3 py-2.5 text-sm">
              <div className="flex-1"><div className="font-medium">{i.name ?? i.email}</div><div className="text-xs text-muted">{i.email} · invited {ago(i.created_at)} ago</div></div>
              <Badge tone="amber">Pending · {ROLE_LABEL[i.role as keyof typeof ROLE_LABEL]}</Badge>
              <form action={revokeInvite}><input type="hidden" name="id" value={i.id} /><button className="btn-ghost !py-1 text-xs">Revoke</button></form>
            </li>
          ))}
        </ul>
        {isOwner && <div className="mt-4 rounded-xl bg-stone-50 p-3"><InviteForm /></div>}
        <dl className="mt-3 grid gap-1 text-xs text-muted sm:grid-cols-2">
          {Object.entries(ROLE_HELP).map(([r, h]) => <div key={r}><dt className="inline font-medium text-ink">{ROLE_LABEL[r as keyof typeof ROLE_LABEL]}: </dt><dd className="inline">{h}</dd></div>)}
        </dl>
      </section>

      <section className="card p-4 sm:p-5">
        <SectionTitle>Message templates</SectionTitle>
        <ul className="divide-y divide-line">
          {(templates ?? []).map((t) => (
            <li key={t.id} className="flex flex-wrap items-start gap-3 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{t.name} <span className="font-normal text-muted">· {t.channel.toUpperCase()} · {t.language}</span></div>
                <p className="mt-0.5 text-muted">{t.body}</p>
              </div>
              <Badge tone={t.approved ? "teal" : "amber"}>{t.approved ? "Approved" : "Draft"}</Badge>
              {can.manage(role) && (
                <form action={toggleTemplate} className="flex gap-1">
                  <input type="hidden" name="id" value={t.id} />
                  <button name="approved" value={t.approved ? "0" : "1"} className="btn-secondary !py-1 text-xs">{t.approved ? "Unapprove" : "Approve"}</button>
                  <button name="delete" value="1" className="btn-ghost !py-1 text-xs">Delete</button>
                </form>
              )}
            </li>
          ))}
        </ul>
        {can.manage(role) && <div className="mt-3 rounded-xl bg-stone-50 p-3"><TemplateForm /></div>}
      </section>

      <section id="ai" className="card scroll-mt-20 p-4 sm:p-5">
        <SectionTitle action={<Badge tone={policy?.enabled ? "teal" : "neutral"}>{policy?.enabled ? "Enabled" : "Off"}</Badge>}>AI calling policy</SectionTitle>
        <p className="mb-3 text-sm text-muted">
          AI calls may only follow up on a customer&apos;s own enquiry, inside the contact window, with disclosure, human transfer and immediate opt-out. Calls stay blocked until a compliant voice provider is connected.
          {policy?.approved_at && <> Script approved by {nameOf(policy.approved_by)} {ago(policy.approved_at)} ago.</>}
        </p>
        {policy && <CallPolicyForm policy={policy} members={members.filter((m) => m.role !== "analyst")} disabled={!isOwner} />}
      </section>

      <section className="card p-4 sm:p-5">
        <SectionTitle>Consent and suppression</SectionTitle>
        <p className="mb-3 text-sm text-muted">Contacts who opted out or were blocked. No call or message can be started for them. Each lead&apos;s enquiry is recorded as its communication basis for 30 days.</p>
        {!suppressed?.length ? <p className="text-sm text-muted">No suppressed contacts.</p> : (
          <ul className="divide-y divide-line text-sm">
            {suppressed.map((c) => (
              <li key={c.id} className="flex items-center gap-3 py-2">
                <span className="flex-1">{c.full_name ?? "Unknown"} <span className="text-muted tnum">· {maskPhone(c.phone_e164)}</span></span>
                <Badge tone="crit">{humanize(c.do_not_contact_reason ?? "blocked")}</Badge>
                {can.manage(role) && <form action={unsuppress}><input type="hidden" name="contact_id" value={c.id} /><button className="btn-ghost !py-1 text-xs">Remove</button></form>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {isOwner && (
        <section className="card p-4 sm:p-5">
          <SectionTitle>Sample data</SectionTitle>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="flex-1 text-muted">{demoCount ? `${demoCount} sample leads are loaded (tagged “demo”).` : "No sample data loaded."}</span>
            <form action={demoData}>
              {demoCount ? (
                <button name="op" value="clear" className="btn-danger">Remove sample data</button>
              ) : (
                <button name="op" value="seed" className="btn-secondary">Load 90 days of sample data</button>
              )}
            </form>
          </div>
        </section>
      )}

      <section className="card p-4 sm:p-5">
        <SectionTitle>Audit log</SectionTitle>
        <p className="mb-2 text-xs text-muted">Status, owner, cost, consent and mapping changes, phone reveals and exports. Raw messages are retained for review; retention controls are planned.</p>
        <ul className="divide-y divide-line text-sm">
          {(audits ?? []).map((a) => (
            <li key={a.id} className="flex flex-wrap items-baseline gap-x-3 py-1.5">
              <span className="w-14 text-xs text-faint tnum">{ago(a.created_at)}</span>
              <span className="font-medium">{nameOf(a.actor_user_id)}</span>
              <span className="text-muted">{humanize(a.action)} · {a.entity_type}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
