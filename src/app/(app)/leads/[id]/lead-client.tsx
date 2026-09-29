"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { Bot, CheckCircle2, Eye, Loader2, MessageSquare, Phone, XCircle } from "lucide-react";
import { Modal } from "@/components/modal";
import { Notice } from "@/components/ui";
import { formatPhone, maskPhone } from "@/lib/format";
import type { PolicyCheck } from "@/lib/policy";
import { addNote, logCall, logMessage, revealPhone, saveReview, updateOutcome, type ActionState } from "../actions";

type Template = { id: string; name: string; channel: string; language: string; preview: string };
type Policy = { allowed: boolean; checks: PolicyCheck[] };

function Feedback({ state }: { state: ActionState }) {
  if (state.error) return <p className="text-sm text-crit-700" role="alert">{state.error}</p>;
  if (state.ok) return <p className="text-sm text-teal-700" role="status">{state.ok}</p>;
  return null;
}

export function PhoneReveal({ id, contactId, phone, canReveal }: { id: string; contactId: string; phone: string | null; canReveal: boolean }) {
  const [shown, setShown] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!phone) return <span className="text-amber-700">No usable phone</span>;
  return (
    <span className="inline-flex items-center gap-2">
      <span className="tnum">{shown ? formatPhone(shown) : maskPhone(phone)}</span>
      {!shown && canReveal && (
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:underline"
          onClick={() => start(async () => setShown(await revealPhone(id, contactId)))}
          title="Reveals the full number. Access is recorded in the audit log."
        >
          {pending ? <Loader2 className="size-3 animate-spin" /> : <Eye className="size-3" />} Reveal
        </button>
      )}
    </span>
  );
}

function Checks({ checks }: { checks: PolicyCheck[] }) {
  return (
    <ul className="divide-y divide-line rounded-xl border border-line">
      {checks.map((c) => (
        <li key={c.key} className="flex items-start gap-3 px-3 py-2.5 text-sm">
          {c.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-teal-600" aria-label="Passed" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-crit-500" aria-label="Blocked" />}
          <span className="w-36 shrink-0 font-medium">{c.label}</span>
          <span className={c.ok ? "text-muted" : "text-crit-700"}>{c.detail}</span>
        </li>
      ))}
    </ul>
  );
}

export function ActionBar({
  id, phone, voicePolicy, aiPolicy, messagePolicies, templates, ai, disabled,
}: {
  id: string;
  phone: string | null;
  voicePolicy: Policy;
  aiPolicy: Policy;
  messagePolicies: Record<string, Policy>;
  templates: Template[];
  ai: { script_name: string; script_body: string; disclosure: string; language: string; recording: boolean; transfer: string };
  disabled: boolean;
}) {
  const [sheet, setSheet] = useState<null | "call" | "ai" | "message">(null);
  const [callState, callAction, callPending] = useActionState(logCall, {});
  const [msgState, msgAction, msgPending] = useActionState(logMessage, {});
  const [tplId, setTplId] = useState(templates[0]?.id ?? "");
  const tpl = templates.find((t) => t.id === tplId);
  const msgPolicy = tpl ? messagePolicies[tpl.channel] : undefined;

  useEffect(() => { if (callState.ok) setSheet(null); }, [callState]);
  useEffect(() => { if (msgState.ok) setSheet(null); }, [msgState]);

  const suppressed = voicePolicy.checks.find((c) => c.key === "suppression" && !c.ok);
  const waLink = tpl && phone ? `https://wa.me/${phone.replace("+", "")}?text=${encodeURIComponent(tpl.preview)}` : null;
  const smsLink = tpl && phone ? `sms:${phone}?body=${encodeURIComponent(tpl.preview)}` : null;

  return (
    <>
      <div id="act" className="grid grid-cols-3 gap-2">
        <button className="btn-primary" disabled={disabled || !!suppressed} onClick={() => setSheet("call")}><Phone className="size-4" aria-hidden />Call</button>
        <button className="btn-secondary" disabled={disabled} onClick={() => setSheet("ai")}><Bot className="size-4" aria-hidden />AI call</button>
        <button className="btn-secondary" disabled={disabled || !!suppressed} onClick={() => setSheet("message")}><MessageSquare className="size-4" aria-hidden />Message</button>
      </div>
      {suppressed && <p className="mt-2 text-xs text-crit-700">{suppressed.detail}</p>}

      <Modal open={sheet === "call"} onClose={() => setSheet(null)} title="Call and log outcome">
        <form action={callAction} id="call-form" className="space-y-4">
          <input type="hidden" name="id" value={id} />
          {!voicePolicy.allowed && (
            <Notice title="Check before calling">
              {voicePolicy.checks.filter((c) => !c.ok).map((c) => c.detail).join(" · ")}
            </Notice>
          )}
          {phone && (
            <a href={`tel:${phone}`} className="btn-teal w-full py-3 text-base"><Phone className="size-4" aria-hidden />Call {formatPhone(phone)}</a>
          )}
          <fieldset>
            <legend className="label">What happened?</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[["completed", "Connected"], ["no_answer", "No answer"], ["busy", "Busy"], ["failed", "Wrong / failed"]].map(([v, l], i) => (
                <label key={v} className="flex cursor-pointer items-center justify-center rounded-lg border border-line px-2 py-2 text-sm has-[:checked]:border-navy-900 has-[:checked]:bg-navy-50 has-[:checked]:font-medium">
                  <input type="radio" name="call_status" value={v} defaultChecked={i === 0} className="sr-only" />{l}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="outcome">Outcome</label>
              <select id="outcome" name="outcome" className="input" defaultValue="">
                <option value="">—</option>
                <option value="connected">Spoke, no decision</option>
                <option value="qualified">Qualified</option>
                <option value="appointment">Appointment booked</option>
                <option value="callback">Asked for callback</option>
                <option value="not_interested">Not interested</option>
                <option value="opt_out">Asked not to be contacted</option>
                <option value="invalid">Invalid enquiry</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="duration">Talk time (minutes)</label>
              <input id="duration" name="duration_minutes" type="number" min={0} step={0.5} defaultValue={2} className="input" />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="summary">Summary</label>
            <textarea id="summary" name="summary" rows={2} className="input" placeholder="Budget, timeline, next step…" />
          </div>
          <div>
            <label className="label" htmlFor="follow_up">Schedule follow-up</label>
            <select id="follow_up" name="follow_up" className="input" defaultValue="">
              <option value="">No follow-up</option>
              <option value="1h">In 1 hour</option>
              <option value="4h">In 4 hours</option>
              <option value="tomorrow">Tomorrow</option>
              <option value="3d">In 3 days</option>
              <option value="1w">Next week</option>
            </select>
          </div>
          <Feedback state={callState} />
          <button className="btn-primary w-full" disabled={callPending}>{callPending && <Loader2 className="size-4 animate-spin" />}Save call</button>
        </form>
      </Modal>

      <Modal
        open={sheet === "ai"}
        onClose={() => setSheet(null)}
        title="Start AI call"
        wide
        footer={
          <>
            <button className="btn-secondary" onClick={() => setSheet(null)}>Cancel</button>
            <button className="btn-teal" disabled={!aiPolicy.allowed} title={aiPolicy.allowed ? undefined : "Blocked by the checks above"}>
              <Bot className="size-4" aria-hidden />Start AI call
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <Checks checks={aiPolicy.checks} />
          <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-2 text-sm">
            <dt className="text-muted">Script</dt><dd>{ai.script_name}</dd>
            <dt className="text-muted">Language</dt><dd>{ai.language === "hi" ? "Hindi" : ai.language === "en" ? "English" : ai.language}</dd>
            <dt className="text-muted">Disclosure</dt><dd>“{ai.disclosure}”</dd>
            <dt className="text-muted">Recording</dt><dd>{ai.recording ? "On" : "Off"}</dd>
            <dt className="text-muted">Human transfer</dt><dd>{ai.transfer}</dd>
          </dl>
          <details className="rounded-lg bg-stone-50 p-3 text-sm">
            <summary className="cursor-pointer font-medium">Open full script</summary>
            <p className="mt-2 whitespace-pre-wrap text-muted">{ai.script_body || "No script written yet."}</p>
          </details>
          {!aiPolicy.allowed && (
            <Notice tone="navy" title="AI calling isn't available for this lead yet">
              Owners can enable it under Settings → AI calling once a voice provider is connected, provider compliance is complete and the script is approved. Until then, use a human call.
            </Notice>
          )}
        </div>
      </Modal>

      <Modal open={sheet === "message"} onClose={() => setSheet(null)} title="Send approved message">
        {templates.length === 0 ? (
          <p className="text-sm text-muted">No approved templates yet. A manager can add one in Settings → Templates.</p>
        ) : (
          <form action={msgAction} className="space-y-4">
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="channel" value={tpl?.channel ?? "sms"} />
            <div>
              <label className="label" htmlFor="template_id">Template</label>
              <select id="template_id" name="template_id" className="input" value={tplId} onChange={(e) => setTplId(e.target.value)}>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name} · {t.channel.toUpperCase()} · {t.language}</option>)}
              </select>
            </div>
            {tpl && (
              <div>
                <div className="label">Exact message · {tpl.channel === "whatsapp" ? "WhatsApp" : "SMS"} to {phone ? formatPhone(phone) : "—"}</div>
                <p className="rounded-xl rounded-tl-sm bg-teal-50 px-3 py-2.5 text-sm whitespace-pre-wrap text-ink">{tpl.preview}</p>
              </div>
            )}
            {msgPolicy && <Checks checks={msgPolicy.checks} />}
            <p className="text-xs text-muted">
              No SMS provider is connected, so the message opens on your phone. LeadLens records it on the timeline and counts it as the first response.
            </p>
            <Feedback state={msgState} />
            <div className="flex flex-wrap gap-2">
              {msgPolicy?.allowed && (tpl?.channel === "whatsapp" ? waLink : smsLink) && (
                <a href={(tpl?.channel === "whatsapp" ? waLink : smsLink)!} target="_blank" rel="noreferrer" className="btn-teal">
                  Open {tpl?.channel === "whatsapp" ? "WhatsApp" : "SMS app"}
                </a>
              )}
              <button className="btn-primary" disabled={msgPending || !msgPolicy?.allowed}>
                {msgPending && <Loader2 className="size-4 animate-spin" />}Log as sent
              </button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}

const STATUSES: Array<[string, string]> = [
  ["new", "New"], ["assigned", "Assigned"], ["attempting_contact", "Attempting contact"], ["contacted", "Contacted"],
  ["qualified", "Qualified"], ["appointment", "Appointment"], ["proposal", "Proposal"], ["won", "Won"],
  ["lost", "Lost"], ["nurture", "Nurture"], ["invalid", "Invalid"], ["spam", "Spam"], ["do_not_contact", "Do not contact"],
];

export function OutcomeForm({ id, status, disabled }: { id: string; status: string; disabled: boolean }) {
  const [state, action, pending] = useActionState(updateOutcome, {});
  const [value, setValue] = useState(status);
  useEffect(() => setValue(status), [status]);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Quick outcome">
        {[["contacted", "Contacted"], ["qualified", "Qualified"], ["appointment", "Appointment"], ["won", "Won"], ["lost", "Lost"], ["nurture", "Nurture"]].map(([v, l]) => (
          <button key={v} type="button" role="radio" aria-checked={value === v} disabled={disabled} onClick={() => setValue(v)}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${value === v ? "border-navy-900 bg-navy-900 text-white" : "border-line bg-white text-muted hover:text-ink"}`}>
            {l}
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="status">Status</label>
          <select id="status" name="status" className="input" value={value} onChange={(e) => setValue(e.target.value)} disabled={disabled}>
            {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        {value === "lost" && (
          <div>
            <label className="label" htmlFor="lost_reason">Lost reason</label>
            <select id="lost_reason" name="lost_reason" className="input" defaultValue="no_response">
              {["price", "timing", "not_serviceable", "no_response", "competitor", "invalid", "other"].map((r) => <option key={r} value={r}>{r.replace(/_/g, " ")}</option>)}
            </select>
          </div>
        )}
        {value === "won" && (
          <>
            <div>
              <label className="label" htmlFor="revenue">Revenue</label>
              <input id="revenue" name="revenue" className="input" placeholder="e.g. 85000 or 1.2L" />
            </div>
            <div>
              <label className="label" htmlFor="gross_margin">Gross margin (optional)</label>
              <input id="gross_margin" name="gross_margin" className="input" placeholder="e.g. 40000" />
            </div>
          </>
        )}
        <div>
          <label className="label" htmlFor="fu">Next follow-up</label>
          <select id="fu" name="follow_up" className="input" defaultValue="" disabled={disabled}>
            <option value="">None</option><option value="4h">In 4 hours</option><option value="tomorrow">Tomorrow</option><option value="3d">In 3 days</option><option value="1w">Next week</option>
          </select>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button className="btn-primary" disabled={pending || disabled}>{pending && <Loader2 className="size-4 animate-spin" />}Save outcome</button>
        <Feedback state={state} />
      </div>
    </form>
  );
}

export function NoteForm({ id, disabled }: { id: string; disabled: boolean }) {
  const [state, action, pending] = useActionState(addNote, {});
  const [key, setKey] = useState(0);
  useEffect(() => { if (state.ok) setKey((k) => k + 1); }, [state]);
  return (
    <form action={action} key={key} className="flex gap-2">
      <input type="hidden" name="id" value={id} />
      <label className="sr-only" htmlFor="note">Add note</label>
      <input id="note" name="body" className="input" placeholder="Add note…" disabled={disabled} />
      <button className="btn-secondary" disabled={pending || disabled}>Add</button>
    </form>
  );
}

export function ReviewForm({ id, contactId, values }: { id: string; contactId: string; values: { full_name: string; phone: string; service: string; location: string } }) {
  const [state, action, pending] = useActionState(saveReview, {});
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="contact_id" value={contactId} />
      <div><label className="label" htmlFor="rv-name">Name</label><input id="rv-name" name="full_name" className="input" defaultValue={values.full_name} /></div>
      <div><label className="label" htmlFor="rv-phone">Phone</label><input id="rv-phone" name="phone" className="input" defaultValue={values.phone} placeholder="98765 43210" /></div>
      <div><label className="label" htmlFor="rv-svc">Service / requirement</label><input id="rv-svc" name="service" className="input" defaultValue={values.service} /></div>
      <div><label className="label" htmlFor="rv-loc">Location</label><input id="rv-loc" name="location" className="input" defaultValue={values.location} /></div>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button className="btn-primary" disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />}Confirm fields</button>
        <Feedback state={state} />
      </div>
    </form>
  );
}
