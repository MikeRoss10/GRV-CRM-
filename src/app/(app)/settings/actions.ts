"use server";

import { revalidatePath } from "next/cache";
import { parseMoneyToMinor } from "@/lib/format";
import { can, requireWorkspace } from "@/lib/workspace";

export type SettingsState = { error?: string; ok?: string };

async function owner() {
  const c = await requireWorkspace();
  if (!can.own(c.role)) throw new Error("Only the workspace owner can change this.");
  return c;
}

const audit = (c: Awaited<ReturnType<typeof requireWorkspace>>, action: string, details: Record<string, unknown> = {}) =>
  c.supabase.from("audit_events").insert({ workspace_id: c.workspace.id, entity_type: "workspace", entity_id: c.workspace.id, action, details });

export async function saveWorkspace(_: SettingsState, form: FormData): Promise<SettingsState> {
  const c = await owner();
  const hourly = String(form.get("staff_hourly_cost") ?? "").trim();
  const patch = {
    name: String(form.get("name") || c.workspace.name).trim(),
    default_sla_minutes: Math.max(1, Number(form.get("sla") || 15)),
    staff_hourly_cost_minor: hourly ? parseMoneyToMinor(hourly) : null,
    call_window_start: String(form.get("call_window_start") || "10:00"),
    call_window_end: String(form.get("call_window_end") || "19:00"),
    timezone: String(form.get("timezone") || c.workspace.timezone),
  };
  if (patch.call_window_start >= patch.call_window_end) return { error: "The allowed window must end after it starts" };
  const { error } = await c.supabase.from("workspaces").update(patch).eq("id", c.workspace.id);
  if (error) return { error: error.message };
  await audit(c, "workspace_updated", patch);
  revalidatePath("/", "layout");
  return { ok: "Saved" };
}

export async function inviteMember(_: SettingsState, form: FormData): Promise<SettingsState> {
  const c = await owner();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Enter a valid email" };
  const { error } = await c.supabase.from("workspace_invites").upsert(
    { workspace_id: c.workspace.id, email, name: String(form.get("name") || "") || null, role: String(form.get("role") || "rep"), invited_by: c.user.id, accepted_at: null },
    { onConflict: "workspace_id,email" },
  );
  if (error) return { error: error.message };
  await audit(c, "member_invited", { email, role: form.get("role") });
  revalidatePath("/settings");
  return { ok: `Invite saved. Ask ${email} to sign up with this email — they'll join automatically.` };
}

export async function revokeInvite(form: FormData) {
  const c = await owner();
  await c.supabase.from("workspace_invites").delete().eq("id", String(form.get("id"))).eq("workspace_id", c.workspace.id);
  revalidatePath("/settings");
}

export async function updateMember(form: FormData) {
  const c = await owner();
  const uid = String(form.get("user_id"));
  if (uid === c.user.id) return; // Owners can't demote or deactivate themselves.
  const patch = { role: String(form.get("role")), active: form.get("active") === "on" };
  await c.supabase.from("workspace_members").update(patch).eq("workspace_id", c.workspace.id).eq("user_id", uid);
  await audit(c, "member_updated", { user_id: uid, ...patch });
  revalidatePath("/settings");
}

export async function saveTemplate(_: SettingsState, form: FormData): Promise<SettingsState> {
  const c = await requireWorkspace();
  if (!can.manage(c.role)) return { error: "Only owners and managers can edit templates" };
  const body = String(form.get("body") ?? "").trim();
  if (!body) return { error: "Write the message" };
  const channel = String(form.get("channel") || "sms");
  if (channel === "sms" && !/stop/i.test(body) && form.get("transactional") !== "on") return { error: "SMS templates need opt-out wording (e.g. “Reply STOP to opt out”)" };
  const { error } = await c.supabase.from("message_templates").insert({
    workspace_id: c.workspace.id, name: String(form.get("name") || "Template"), channel, language: String(form.get("language") || "en"), body, approved: false, created_by: c.user.id,
  });
  if (error) return { error: error.message };
  revalidatePath("/settings");
  return { ok: "Template added — approve it to make it available" };
}

export async function toggleTemplate(form: FormData) {
  const c = await requireWorkspace();
  if (!can.manage(c.role)) return;
  const id = String(form.get("id"));
  if (form.get("delete") === "1") await c.supabase.from("message_templates").delete().eq("id", id).eq("workspace_id", c.workspace.id);
  else await c.supabase.from("message_templates").update({ approved: form.get("approved") === "1" }).eq("id", id).eq("workspace_id", c.workspace.id);
  await audit(c, "template_changed", { id, approved: form.get("approved"), deleted: form.get("delete") === "1" });
  revalidatePath("/settings");
}

export async function saveCallPolicy(_: SettingsState, form: FormData): Promise<SettingsState> {
  const c = await owner();
  const { data: current } = await c.supabase.from("call_policies").select("*").eq("workspace_id", c.workspace.id).single();
  const script_body = String(form.get("script_body") ?? "");
  const script_name = String(form.get("script_name") || "New enquiry qualification v1");
  const scriptChanged = current && (current.script_body !== script_body || current.script_name !== script_name);
  const approve = form.get("approve") === "on";
  const disclosure = String(form.get("disclosure") ?? "");
  if (!/ai|automated|assistant/i.test(disclosure)) return { error: "The disclosure must say the caller is an AI / automated assistant" };
  const patch = {
    enabled: form.get("enabled") === "on",
    script_name, script_body, disclosure,
    language: String(form.get("language") || "en"),
    recording_enabled: form.get("recording") === "on",
    transfer_user_id: String(form.get("transfer_user_id") || "") || null,
    // Approval is tied to the exact script: an edited script is re-approved at save time or not at all.
    approved_at: approve ? (scriptChanged || !current?.approved_at ? new Date().toISOString() : current.approved_at) : null,
    approved_by: approve ? (scriptChanged || !current?.approved_by ? c.user.id : current.approved_by) : null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await c.supabase.from("call_policies").update(patch).eq("workspace_id", c.workspace.id);
  if (error) return { error: error.message };
  await audit(c, "call_policy_updated", { enabled: patch.enabled, approved: !!patch.approved_at, script_name });
  revalidatePath("/settings");
  revalidatePath("/follow-up");
  return { ok: "AI call policy saved" };
}

export async function unsuppress(form: FormData) {
  const c = await requireWorkspace();
  if (!can.manage(c.role)) return;
  const id = String(form.get("contact_id"));
  await c.supabase.from("contacts").update({ do_not_contact: false, do_not_contact_reason: null }).eq("id", id).eq("workspace_id", c.workspace.id);
  await c.supabase.from("audit_events").insert({ workspace_id: c.workspace.id, entity_type: "contact", entity_id: id, action: "unsuppressed" });
  revalidatePath("/settings");
}

export async function demoData(form: FormData) {
  const c = await owner();
  const fn = form.get("op") === "clear" ? "clear_demo_data" : "seed_demo_data";
  const { error } = await c.supabase.rpc(fn, { p_workspace: c.workspace.id });
  if (error) throw new Error(error.message);
  revalidatePath("/", "layout");
}
