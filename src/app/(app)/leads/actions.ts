"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/workspace";
import { normalizePhone } from "@/lib/parsers";
import { parseMoneyToMinor } from "@/lib/format";
import { evaluatePolicy, fillTemplate, type Channel } from "@/lib/policy";

export type ActionState = { error?: string; ok?: string };

async function ctx() {
  const c = await requireWorkspace();
  if (c.role === "analyst") throw new Error("Analysts have read-only access to leads.");
  return c;
}

function done(id?: string) {
  revalidatePath("/leads");
  if (id) revalidatePath(`/leads/${id}`);
  revalidatePath("/overview");
  revalidatePath("/follow-up");
}

export async function claimLead(form: FormData) {
  const { supabase, workspace, user } = await ctx();
  const id = String(form.get("id"));
  await supabase.from("opportunities").update({ owner_user_id: user.id }).eq("id", id).eq("workspace_id", workspace.id);
  done(id);
}

export async function assignOwner(form: FormData) {
  const { supabase, workspace } = await ctx();
  const id = String(form.get("id"));
  const owner = String(form.get("owner_user_id") || "") || null;
  await supabase.from("opportunities").update({ owner_user_id: owner }).eq("id", id).eq("workspace_id", workspace.id);
  done(id);
}

export async function updateOutcome(_: ActionState, form: FormData): Promise<ActionState> {
  const { supabase, workspace } = await ctx();
  const id = String(form.get("id"));
  const status = String(form.get("status"));
  const patch: Record<string, unknown> = { status };
  if (status === "lost") patch.lost_reason = String(form.get("lost_reason") || "other");
  if (status === "won") {
    const rev = String(form.get("revenue") ?? "").trim();
    if (rev) {
      const minor = parseMoneyToMinor(rev);
      if (minor === null) return { error: "Revenue must be a number, e.g. 85000 or 1.2L" };
      patch.revenue_minor = minor;
    }
    const gm = String(form.get("gross_margin") ?? "").trim();
    if (gm) patch.gross_margin_minor = parseMoneyToMinor(gm);
  }
  const { error } = await supabase.from("opportunities").update(patch).eq("id", id).eq("workspace_id", workspace.id);
  if (error) return { error: error.message };
  const followUp = String(form.get("follow_up") ?? "");
  if (followUp) await createFollowUp(supabase, workspace.id, id, followUp, String(form.get("follow_up_title") || "Follow up"));
  done(id);
  return { ok: "Outcome saved" };
}

async function createFollowUp(supabase: Awaited<ReturnType<typeof ctx>>["supabase"], workspaceId: string, oppId: string, when: string, title: string) {
  const hours: Record<string, number> = { "1h": 1, "4h": 4, tomorrow: 20, "3d": 72, "1w": 168 };
  const due = hours[when] ? new Date(Date.now() + hours[when] * 3600000) : new Date(when);
  if (Number.isNaN(due.getTime())) return;
  const { data: opp } = await supabase.from("opportunities").select("owner_user_id").eq("id", oppId).single();
  const { data: auth } = await supabase.auth.getUser();
  await supabase.from("tasks").insert({
    workspace_id: workspaceId, opportunity_id: oppId, assignee_user_id: opp?.owner_user_id ?? auth.user?.id,
    task_type: "follow_up", title, due_at: due.toISOString(), priority: "normal",
  });
}

export async function addNote(_: ActionState, form: FormData): Promise<ActionState> {
  const { supabase, workspace } = await ctx();
  const id = String(form.get("id"));
  const body = String(form.get("body") ?? "").trim();
  if (!body) return { error: "Write a note first" };
  const { error } = await supabase.from("messages").insert({ workspace_id: workspace.id, opportunity_id: id, channel: "internal_note", direction: "outbound", body_redacted: body });
  if (error) return { error: error.message };
  done(id);
  return { ok: "Note added" };
}

export async function logCall(_: ActionState, form: FormData): Promise<ActionState> {
  const { supabase, workspace } = await ctx();
  const id = String(form.get("id"));
  const outcome = String(form.get("outcome") || "") || null;
  const status = String(form.get("call_status") || "completed");
  const mins = Number(form.get("duration_minutes") || 0);

  const { data: opp } = await supabase.from("opportunities").select("status, contacts(do_not_contact)").eq("id", id).single();
  if ((opp?.contacts as unknown as { do_not_contact: boolean } | null)?.do_not_contact || opp?.status === "do_not_contact")
    return { error: "This contact is suppressed. Calls can't be logged as outreach." };

  const started = new Date(Date.now() - mins * 60000);
  const { error } = await supabase.from("calls").insert({
    workspace_id: workspace.id, opportunity_id: id, provider: "manual", call_type: "human", direction: "outbound",
    status, outcome, started_at: started.toISOString(), ended_at: new Date().toISOString(),
    duration_seconds: Math.round(mins * 60), summary: String(form.get("summary") || "") || null,
  });
  if (error) return { error: error.message };

  // Outcome drives the funnel.
  const next: Record<string, string> = { qualified: "qualified", appointment: "appointment", not_interested: "lost", invalid: "invalid" };
  if (outcome && next[outcome]) {
    await supabase.from("opportunities").update({ status: next[outcome], ...(outcome === "not_interested" ? { lost_reason: "other" } : {}) }).eq("id", id);
  }
  const followUp = String(form.get("follow_up") ?? "");
  if (followUp) await createFollowUp(supabase, workspace.id, id, followUp, outcome === "callback" ? "Call back" : "Follow up");
  done(id);
  return { ok: "Call logged" };
}

export async function logMessage(_: ActionState, form: FormData): Promise<ActionState> {
  const { supabase, workspace } = await ctx();
  const id = String(form.get("id"));
  const templateId = String(form.get("template_id"));
  const channel = String(form.get("channel")) as Channel;

  const [{ data: opp }, { data: tpl }, { data: consents }] = await Promise.all([
    supabase.from("opportunities").select("status, parser_confidence, received_at, service, contacts(full_name, phone_e164, email, do_not_contact, do_not_contact_reason)").eq("id", id).single(),
    supabase.from("message_templates").select("*").eq("id", templateId).eq("approved", true).single(),
    supabase.from("consent_events").select("*").eq("opportunity_id", id),
  ]);
  if (!opp || !tpl) return { error: "Lead or approved template not found" };
  const contact = opp.contacts as unknown as { full_name: string | null; phone_e164: string | null; email: string | null; do_not_contact: boolean; do_not_contact_reason: string | null };

  // Re-check the policy server-side; the client preview is not trusted.
  const policy = evaluatePolicy({ channel, contact, opportunity: opp, consents: consents ?? [], workspace });
  if (!policy.allowed) return { error: `Blocked: ${policy.checks.filter((c) => !c.ok).map((c) => c.detail).join("; ")}` };

  const body = fillTemplate(tpl.body, { name: contact.full_name?.split(" ")[0] ?? "there", service: opp.service ?? "your enquiry", business: workspace.name });
  const basis = (consents ?? []).find((c) => c.channel === channel && !c.revoked_at);
  const { error } = await supabase.from("messages").insert({
    workspace_id: workspace.id, opportunity_id: id, channel, direction: "outbound", body_redacted: body,
    recipient_ref: contact.phone_e164, template_id: tpl.id, consent_basis_id: basis?.id ?? null,
  });
  if (error) return { error: error.message };
  done(id);
  return { ok: "Message logged" };
}

export async function setSuppression(form: FormData) {
  const { supabase, workspace } = await ctx();
  const id = String(form.get("id"));
  const contactId = String(form.get("contact_id"));
  const suppress = form.get("suppress") === "1";
  await supabase.from("contacts").update({
    do_not_contact: suppress, do_not_contact_reason: suppress ? String(form.get("reason") || "manual_block") : null, updated_at: new Date().toISOString(),
  }).eq("id", contactId).eq("workspace_id", workspace.id);
  if (suppress) {
    await supabase.from("consent_events").update({ revoked_at: new Date().toISOString() }).eq("opportunity_id", id).is("revoked_at", null);
  }
  await supabase.from("audit_events").insert({ workspace_id: workspace.id, entity_type: "contact", entity_id: contactId, action: suppress ? "suppressed" : "unsuppressed", details: { opportunity_id: id } });
  done(id);
}

export async function revealPhone(id: string, contactId: string) {
  const { supabase, workspace, user } = await requireWorkspace();
  await supabase.from("audit_events").insert({ workspace_id: workspace.id, actor_user_id: user.id, entity_type: "contact", entity_id: contactId, action: "phone_revealed", details: { opportunity_id: id } });
  const { data } = await supabase.from("contacts").select("phone_e164").eq("id", contactId).single();
  return data?.phone_e164 ?? null;
}

export async function saveReview(_: ActionState, form: FormData): Promise<ActionState> {
  const { supabase, workspace } = await ctx();
  const id = String(form.get("id"));
  const contactId = String(form.get("contact_id"));
  const phoneInput = String(form.get("phone") ?? "").trim();
  const phone = phoneInput ? normalizePhone(phoneInput).e164 : null;
  if (phoneInput && !phone) return { error: "That phone number doesn't look valid" };
  const name = String(form.get("full_name") ?? "").trim() || null;
  const service = String(form.get("service") ?? "").trim() || null;
  const location = String(form.get("location") ?? "").trim() || null;

  const { error: ce } = await supabase.from("contacts").update({ full_name: name, phone_e164: phone, updated_at: new Date().toISOString() }).eq("id", contactId).eq("workspace_id", workspace.id);
  if (ce) return { error: ce.message };
  const { error } = await supabase.from("opportunities").update({
    service, location, title: [service, location].filter(Boolean).join(" · ") || "New enquiry",
    parser_confidence: 1, data_quality_status: phone && service ? "complete" : phone ? "incomplete" : "needs_review",
  }).eq("id", id).eq("workspace_id", workspace.id);
  if (error) return { error: error.message };
  await supabase.from("raw_events").update({ parse_status: "parsed" }).eq("opportunity_id", id).eq("parse_status", "needs_review");
  await supabase.from("audit_events").insert({ workspace_id: workspace.id, entity_type: "opportunity", entity_id: id, action: "fields_reviewed", details: { full_name: name, phone_set: !!phone, service, location } });
  done(id);
  return { ok: "Reviewed — lead is ready for outreach" };
}

export async function createTask(_: ActionState, form: FormData): Promise<ActionState> {
  const { supabase, workspace, user } = await ctx();
  const id = String(form.get("id"));
  const due = new Date(String(form.get("due_at")));
  if (Number.isNaN(due.getTime())) return { error: "Pick a due date" };
  const { error } = await supabase.from("tasks").insert({
    workspace_id: workspace.id, opportunity_id: id, assignee_user_id: String(form.get("assignee") || user.id),
    task_type: String(form.get("task_type") || "follow_up"), title: String(form.get("title") || "Follow up"),
    due_at: due.toISOString(), priority: String(form.get("priority") || "normal"),
  });
  if (error) return { error: error.message };
  done(id);
  return { ok: "Task scheduled" };
}

export async function completeTask(form: FormData) {
  const { supabase, workspace } = await ctx();
  const taskId = String(form.get("task_id"));
  const action = String(form.get("action") || "complete");
  const patch =
    action === "snooze"
      ? { due_at: new Date(Date.now() + 20 * 3600000).toISOString(), status: "open" }
      : action === "cancel"
        ? { status: "cancelled" }
        : { status: "completed", completed_at: new Date().toISOString() };
  const { data } = await supabase.from("tasks").update(patch).eq("id", taskId).eq("workspace_id", workspace.id).select("opportunity_id").single();
  done(data?.opportunity_id);
}

export async function mergeDuplicate(form: FormData) {
  const { supabase } = await ctx();
  const primary = String(form.get("primary"));
  const secondary = String(form.get("secondary"));
  const { error } = await supabase.rpc("merge_opportunities", { p_primary: primary, p_secondary: secondary });
  if (error) throw new Error(error.message);
  done(primary);
  revalidatePath("/leads/duplicates");
}

export async function unmergeDuplicate(form: FormData) {
  const { supabase } = await ctx();
  const id = String(form.get("id"));
  const { error } = await supabase.rpc("unmerge_opportunity", { p_secondary: id });
  if (error) throw new Error(error.message);
  done(id);
}

export async function dismissDuplicate(form: FormData) {
  const { supabase, workspace } = await ctx();
  const id = String(form.get("id"));
  await supabase.from("opportunities").update({ duplicate_status: "none", duplicate_confidence: null }).eq("id", id).eq("workspace_id", workspace.id);
  done(id);
  revalidatePath("/leads/duplicates");
}

export async function confirmDuplicate(form: FormData) {
  const { supabase, workspace } = await ctx();
  const id = String(form.get("id"));
  await supabase.from("opportunities").update({ duplicate_status: "confirmed", duplicate_confidence: 1 }).eq("id", id).eq("workspace_id", workspace.id);
  done(id);
  revalidatePath("/leads/duplicates");
}

export async function createManualLead(_: ActionState, form: FormData): Promise<ActionState> {
  const { supabase, workspace } = await ctx();
  const phoneRaw = String(form.get("phone") ?? "").trim();
  const phone = normalizePhone(phoneRaw);
  if (phoneRaw && !phone.e164) return { error: "That phone number doesn't look valid" };
  const cost = String(form.get("cost") ?? "").trim();
  const budget = String(form.get("budget") ?? "").trim();
  const received = String(form.get("received_at") ?? "");
  const { data, error } = await supabase.rpc("create_lead", {
    p_workspace: workspace.id,
    p: {
      source_type: String(form.get("source_type") || "other"),
      event_type: "manual",
      raw: String(form.get("notes") || "Added manually"),
      full_name: String(form.get("full_name") || "").trim() || null,
      phone_e164: phone.e164,
      phone_original: phoneRaw || null,
      email: String(form.get("email") || "").trim() || null,
      service: String(form.get("service") || "").trim() || null,
      location: String(form.get("location") || "").trim() || null,
      requirement: String(form.get("notes") || "").trim() || null,
      budget_minor: budget ? parseMoneyToMinor(budget) : null,
      cost_minor: cost ? parseMoneyToMinor(cost) : null,
      provider_lead_id: String(form.get("provider_lead_id") || "").trim() || null,
      received_at: received ? new Date(received).toISOString() : undefined,
      confidence: 1,
      touch_type: "manual",
      idempotency_key: `manual-${crypto.randomUUID()}`,
    },
  });
  if (error) return { error: error.message };
  const res = data as { opportunity_id: string };
  done();
  redirect(`/leads/${res.opportunity_id}`);
}
