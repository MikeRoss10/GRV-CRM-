"use server";

import { revalidatePath } from "next/cache";
import { parseMoneyToMinor } from "@/lib/format";
import { can, requireWorkspace } from "@/lib/workspace";

export type CostState = { error?: string; ok?: string };

async function ctx() {
  const c = await requireWorkspace();
  if (!can.manageCosts(c.role)) throw new Error("Only owners, managers and analysts can change costs.");
  return c;
}

function refresh() {
  revalidatePath("/economics", "layout");
  revalidatePath("/overview");
}

export async function addCostEvent(_: CostState, form: FormData): Promise<CostState> {
  const { supabase, workspace } = await ctx();
  const amount = parseMoneyToMinor(String(form.get("amount") ?? ""));
  if (!amount && amount !== 0) return { error: "Enter an amount, e.g. 14000 or 1.2L" };
  const periodStart = String(form.get("period_start") || "") || null;
  const periodEnd = String(form.get("period_end") || "") || null;
  if ((periodStart && !periodEnd) || (!periodStart && periodEnd)) return { error: "Set both period start and end, or neither" };
  const occurred = String(form.get("occurred_at") || "") || periodStart || new Date().toISOString().slice(0, 10);

  const { error } = await supabase.from("cost_events").insert({
    workspace_id: workspace.id,
    source_account_id: String(form.get("source_account_id")),
    cost_type: String(form.get("cost_type")),
    amount_minor: amount,
    currency: workspace.default_currency,
    occurred_at: new Date(`${occurred}T00:00:00`).toISOString(),
    period_start: periodStart,
    period_end: periodEnd,
    allocation_method: periodStart ? "equal_daily" : "direct",
    provider_ref: String(form.get("provider_ref") || "") || null,
    notes: String(form.get("notes") || "") || null,
  });
  if (error) return { error: error.message };
  await supabase.from("audit_events").insert({ workspace_id: workspace.id, entity_type: "cost_event", action: "cost_added", details: { amount_minor: amount, source_account_id: String(form.get("source_account_id")) } });
  refresh();
  return { ok: "Cost added" };
}

export async function deleteCostEvent(form: FormData) {
  const { supabase, workspace } = await ctx();
  const id = String(form.get("id"));
  const { data } = await supabase.from("cost_events").delete().eq("id", id).eq("workspace_id", workspace.id).select("amount_minor, source_account_id").single();
  if (data) await supabase.from("audit_events").insert({ workspace_id: workspace.id, entity_type: "cost_event", entity_id: id, action: "cost_deleted", details: data });
  refresh();
}

export async function saveSource(_: CostState, form: FormData): Promise<CostState> {
  const { supabase, workspace } = await ctx();
  const id = String(form.get("id") || "");
  const row = {
    display_name: String(form.get("display_name") || "").trim(),
    billing_model: String(form.get("billing_model") || "manual"),
    account_identifier: String(form.get("account_identifier") || "") || null,
    zero_cost: form.get("zero_cost") === "on",
    status: String(form.get("status") || "active"),
  };
  if (!row.display_name) return { error: "Name the source" };
  const { error } = id
    ? await supabase.from("source_accounts").update(row).eq("id", id).eq("workspace_id", workspace.id)
    : await supabase.from("source_accounts").insert({ ...row, workspace_id: workspace.id, source_type: String(form.get("source_type") || "other") });
  if (error) return { error: error.message };
  await supabase.from("audit_events").insert({ workspace_id: workspace.id, entity_type: "source_account", entity_id: id || null, action: id ? "source_updated" : "source_created", details: row });
  refresh();
  return { ok: "Saved" };
}
