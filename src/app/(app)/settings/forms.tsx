"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { inviteMember, saveCallPolicy, saveTemplate, saveWorkspace, type SettingsState } from "./actions";

function Msg({ s }: { s: SettingsState }) {
  return s.error ? <span className="text-sm text-crit-700" role="alert">{s.error}</span> : s.ok ? <span className="text-sm text-teal-700" role="status">{s.ok}</span> : null;
}

type WS = { name: string; default_sla_minutes: number; staff_hourly_cost_minor: number | null; call_window_start: string; call_window_end: string; timezone: string };

export function WorkspaceForm({ ws, disabled }: { ws: WS; disabled: boolean }) {
  const [s, action, pending] = useActionState(saveWorkspace, {});
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <fieldset disabled={disabled} className="contents">
        <div><label className="label" htmlFor="ws-name">Business name</label><input id="ws-name" name="name" defaultValue={ws.name} className="input" /></div>
        <div><label className="label" htmlFor="ws-sla">First-response SLA (minutes)</label><input id="ws-sla" name="sla" type="number" min={1} defaultValue={ws.default_sla_minutes} className="input" /></div>
        <div>
          <label className="label" htmlFor="ws-hourly">Loaded staff cost per hour</label>
          <input id="ws-hourly" name="staff_hourly_cost" defaultValue={ws.staff_hourly_cost_minor ? String(ws.staff_hourly_cost_minor / 100) : ""} className="input" placeholder="250" />
        </div>
        <div><label className="label" htmlFor="ws-start">Contact window starts</label><input id="ws-start" name="call_window_start" type="time" defaultValue={ws.call_window_start.slice(0, 5)} className="input" /></div>
        <div><label className="label" htmlFor="ws-end">Contact window ends</label><input id="ws-end" name="call_window_end" type="time" defaultValue={ws.call_window_end.slice(0, 5)} className="input" /></div>
        <div>
          <label className="label" htmlFor="ws-tz">Timezone</label>
          <select id="ws-tz" name="timezone" defaultValue={ws.timezone} className="input">
            {["Asia/Kolkata", "Asia/Dubai", "Europe/London", "America/New_York"].map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-3">
          <button className="btn-primary" disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />}Save workspace</button>
          <Msg s={s} />
        </div>
      </fieldset>
    </form>
  );
}

export function InviteForm() {
  const [s, action, pending] = useActionState(inviteMember, {});
  return (
    <form action={action} className="grid items-end gap-2 sm:grid-cols-[1.5fr_1fr_auto_auto]">
      <div><label className="label" htmlFor="inv-email">Email</label><input id="inv-email" name="email" type="email" required className="input" placeholder="meera@business.com" /></div>
      <div><label className="label" htmlFor="inv-name">Name</label><input id="inv-name" name="name" className="input" /></div>
      <select name="role" defaultValue="rep" className="input !w-auto" aria-label="Role">
        <option value="rep">Worker</option><option value="manager">Manager (admin)</option><option value="owner">Owner (admin)</option><option value="analyst">Analyst</option>
      </select>
      <button className="btn-primary" disabled={pending}>Invite</button>
      <div className="sm:col-span-4"><Msg s={s} /></div>
    </form>
  );
}

export function TemplateForm() {
  const [s, action, pending] = useActionState(saveTemplate, {});
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-3">
      <div><label className="label" htmlFor="t-name">Name</label><input id="t-name" name="name" className="input" placeholder="Site visit reminder" /></div>
      <div>
        <label className="label" htmlFor="t-ch">Channel</label>
        <select id="t-ch" name="channel" className="input"><option value="sms">SMS</option><option value="whatsapp">WhatsApp</option><option value="email">Email</option></select>
      </div>
      <div>
        <label className="label" htmlFor="t-lang">Language</label>
        <select id="t-lang" name="language" className="input"><option value="en">English</option><option value="hi">Hindi</option><option value="mr">Marathi</option><option value="ta">Tamil</option><option value="te">Telugu</option><option value="kn">Kannada</option></select>
      </div>
      <div className="sm:col-span-3">
        <label className="label" htmlFor="t-body">Message — use {"{name}"}, {"{service}"}, {"{business}"}</label>
        <textarea id="t-body" name="body" rows={3} className="input" placeholder="Hi {name}, thanks for your enquiry about {service}. Reply STOP to opt out. – {business}" />
      </div>
      <label className="flex items-center gap-2 text-xs text-muted sm:col-span-2"><input type="checkbox" name="transactional" className="size-4 accent-teal-600" />Transactional message (no opt-out line required)</label>
      <div className="flex items-center gap-3 sm:col-span-3">
        <button className="btn-secondary" disabled={pending}>Add template</button>
        <Msg s={s} />
      </div>
    </form>
  );
}

type Policy = { enabled: boolean; script_name: string; script_body: string; language: string; disclosure: string; recording_enabled: boolean; transfer_user_id: string | null; approved_at: string | null; provider: string | null };

export function CallPolicyForm({ policy, members, disabled }: { policy: Policy; members: Array<{ user_id: string; name: string }>; disabled: boolean }) {
  const [s, action, pending] = useActionState(saveCallPolicy, {});
  return (
    <form action={action} className="space-y-3">
      <fieldset disabled={disabled} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="label" htmlFor="p-name">Script name</label><input id="p-name" name="script_name" defaultValue={policy.script_name} className="input" /></div>
          <div>
            <label className="label" htmlFor="p-lang">Language</label>
            <select id="p-lang" name="language" defaultValue={policy.language} className="input"><option value="en">English</option><option value="hi">Hindi</option><option value="mr">Marathi</option></select>
          </div>
          <div className="sm:col-span-2"><label className="label" htmlFor="p-disc">Opening disclosure</label><input id="p-disc" name="disclosure" defaultValue={policy.disclosure} className="input" /></div>
          <div className="sm:col-span-2"><label className="label" htmlFor="p-body">Script</label><textarea id="p-body" name="script_body" rows={4} defaultValue={policy.script_body} className="input" /></div>
          <div>
            <label className="label" htmlFor="p-transfer">Human transfer to</label>
            <select id="p-transfer" name="transfer_user_id" defaultValue={policy.transfer_user_id ?? ""} className="input">
              <option value="">Lead owner</option>
              {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}
            </select>
          </div>
          <div>
            <span className="label">Voice provider</span>
            <p className="input !bg-stone-50 text-muted">{policy.provider ?? "Not connected"}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" name="recording" defaultChecked={policy.recording_enabled} className="size-4 accent-teal-600" />Record calls</label>
          <label className="flex items-center gap-2"><input type="checkbox" name="approve" defaultChecked={!!policy.approved_at} className="size-4 accent-teal-600" />I approve this script</label>
          <label className="flex items-center gap-2"><input type="checkbox" name="enabled" defaultChecked={policy.enabled} className="size-4 accent-teal-600" />Enable AI call policy</label>
        </div>
        <div className="flex items-center gap-3">
          <button className="btn-primary" disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />}Save policy</button>
          <Msg s={s} />
        </div>
      </fieldset>
    </form>
  );
}
