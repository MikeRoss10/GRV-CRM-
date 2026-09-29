/**
 * Communication guardrails. No outreach is possible for suppressed or unverified contacts,
 * and AI calls additionally require an enabled, approved policy with a compliant provider.
 */

export type Channel = "voice" | "sms" | "whatsapp" | "email";

export interface PolicyCheck {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
}

export interface PolicyInput {
  channel: Channel;
  ai?: boolean;
  now?: Date;
  contact: { do_not_contact: boolean; do_not_contact_reason?: string | null; phone_e164: string | null; email?: string | null };
  opportunity: { status: string; parser_confidence: number | null; received_at: string };
  consents: Array<{ channel: string; basis_type: string; captured_at: string; expires_at: string | null; revoked_at: string | null; purpose: string }>;
  workspace: { timezone: string; call_window_start: string; call_window_end: string };
  callPolicy?: {
    enabled: boolean;
    provider: string | null;
    provider_compliance_complete: boolean;
    approved_at: string | null;
    script_name: string;
  } | null;
}

/** Minutes since local midnight in the given IANA timezone. */
export function localMinutes(now: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: tz }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

const toMinutes = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
};

export function evaluatePolicy(input: PolicyInput): { allowed: boolean; checks: PolicyCheck[] } {
  const now = input.now ?? new Date();
  const checks: PolicyCheck[] = [];
  const { contact, opportunity, channel } = input;

  const suppressed = contact.do_not_contact || opportunity.status === "do_not_contact";
  checks.push({
    key: "suppression",
    label: "Suppression check",
    ok: !suppressed,
    detail: suppressed ? `Suppressed${contact.do_not_contact_reason ? ` (${contact.do_not_contact_reason.replace(/_/g, " ")})` : ""} — no contact allowed` : "Not suppressed",
  });

  if (channel === "email") {
    checks.push({ key: "address", label: "Email address", ok: !!contact.email, detail: contact.email ? "Present" : "No email on file" });
  } else {
    const conf = opportunity.parser_confidence ?? 1;
    const phoneOk = !!contact.phone_e164 && conf >= 0.8;
    checks.push({
      key: "phone",
      label: "Verified phone",
      ok: phoneOk,
      detail: !contact.phone_e164 ? "No usable phone number — review the lead first" : conf < 0.8 ? `Parser confidence ${Math.round(conf * 100)}% — review the phone number first` : "Phone parsed with high confidence",
    });
  }

  const consentChannel = channel === "voice" ? "voice" : channel;
  const active = input.consents.find(
    (c) => c.channel === consentChannel && !c.revoked_at && (!c.expires_at || new Date(c.expires_at) > now) && c.basis_type !== "unknown",
  );
  checks.push({
    key: "basis",
    label: "Communication basis",
    ok: !!active,
    detail: active ? `${active.basis_type.replace(/_/g, " ")} · ${active.purpose}` : "No active consent or enquiry basis for this channel",
  });

  if (channel === "voice" || channel === "sms" || channel === "whatsapp") {
    const mins = localMinutes(now, input.workspace.timezone);
    const start = toMinutes(input.workspace.call_window_start);
    const end = toMinutes(input.workspace.call_window_end);
    const inWindow = mins >= start && mins < end;
    checks.push({
      key: "window",
      label: "Allowed window",
      ok: inWindow,
      detail: `${input.workspace.call_window_start.slice(0, 5)}–${input.workspace.call_window_end.slice(0, 5)} ${input.workspace.timezone}${inWindow ? "" : " — outside allowed hours now"}`,
    });
  }

  if (input.ai) {
    const p = input.callPolicy;
    checks.push({ key: "policy", label: "AI call policy", ok: !!p?.enabled, detail: p?.enabled ? "Enabled" : "AI calling is off for this workspace (Settings → AI calling)" });
    checks.push({
      key: "provider",
      label: "Voice provider",
      ok: !!p?.provider && !!p?.provider_compliance_complete,
      detail: !p?.provider ? "No voice provider connected" : p.provider_compliance_complete ? `${p.provider} · compliance complete` : `${p.provider} · provider compliance (KYC, caller ID, number series) incomplete`,
    });
    checks.push({
      key: "script",
      label: "Script approval",
      ok: !!p?.approved_at,
      detail: p?.approved_at ? `${p.script_name} · approved` : "Script needs owner approval before first use",
    });
  }

  return { allowed: checks.every((c) => c.ok), checks };
}

export function fillTemplate(body: string, vars: Record<string, string | null | undefined>): string {
  return body.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}
