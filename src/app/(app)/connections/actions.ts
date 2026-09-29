"use server";

import { revalidatePath } from "next/cache";
import { can, requireWorkspace } from "@/lib/workspace";

async function adminCtx() {
  const c = await requireWorkspace();
  if (!can.seeBusiness(c.role) || !can.work(c.role)) throw new Error("Only admins can import or test sources.");
  return c;
}
import { normalizePhone, parseLeadMessage, toIngestPayload, type SourceType } from "@/lib/parsers";
import { parseMoneyToMinor } from "@/lib/format";

export async function saveParsedLead(text: string, sourceHint: SourceType | "") {
  const { supabase, workspace } = await adminCtx();
  const parsed = parseLeadMessage(text, { sourceHint: sourceHint || undefined });
  const { data, error } = await supabase.rpc("create_lead", { p_workspace: workspace.id, p: toIngestPayload(parsed, text, { event_type: "manual" }) });
  if (error) return { error: error.message };
  revalidatePath("/leads");
  return { ok: true, result: data as { opportunity_id: string; result: string } };
}

export type CsvRow = Record<string, string>;
export type CsvMapping = Record<string, string>; // canonical field -> csv column

export async function importCsv(rows: CsvRow[], mapping: CsvMapping, defaultSource: SourceType) {
  const { supabase, workspace } = await adminCtx();
  if (rows.length > 2000) return { error: "Import up to 2,000 rows at a time" };
  const get = (r: CsvRow, k: string) => (mapping[k] ? (r[mapping[k]] ?? "").trim() : "");
  const counts = { created: 0, duplicates: 0, skipped: 0, errors: [] as string[] };
  const batchKey = crypto.randomUUID().slice(0, 8);

  for (const [i, r] of rows.entries()) {
    const phoneRaw = get(r, "phone");
    const phone = normalizePhone(phoneRaw);
    const name = get(r, "full_name");
    if (!phone.e164 && !get(r, "email") && !name) { counts.skipped++; continue; }
    const src = (get(r, "source").toLowerCase().replace(/\s+/g, "_") || defaultSource) as string;
    const known = ["justdial", "sulekha", "91acres", "meta_ads", "google_ads", "website", "referral", "walk_in", "other"];
    const srcNorm = known.includes(src) ? src : src.includes("just") ? "justdial" : src.includes("sulekha") ? "sulekha" : src.includes("91") ? "91acres" : src.includes("meta") || src.includes("facebook") ? "meta_ads" : src.includes("google") ? "google_ads" : defaultSource;
    const date = get(r, "received_at");
    const receivedAt = date && !Number.isNaN(new Date(date).getTime()) ? new Date(date).toISOString() : undefined;
    const status = get(r, "status").toLowerCase();
    const revenue = get(r, "revenue");

    const payload = {
      ...toIngestPayload(parseLeadMessage(""), `CSV import row ${i + 2}: ${JSON.stringify(r).slice(0, 2000)}`, { event_type: "csv_row", idempotency_key: `csv-${get(r, "provider_lead_id") || `${batchKey}-${i}`}-${phone.e164 ?? name}`, received_at: receivedAt }),
      source_type: srcNorm,
      full_name: name || null,
      phone_e164: phone.e164,
      phone_original: phoneRaw || null,
      email: get(r, "email") || null,
      service: get(r, "service") || null,
      location: get(r, "location") || null,
      requirement: get(r, "service") || null,
      cost_minor: get(r, "cost") ? parseMoneyToMinor(get(r, "cost")) : null,
      budget_minor: get(r, "budget") ? parseMoneyToMinor(get(r, "budget")) : null,
      provider_lead_id: get(r, "provider_lead_id") || null,
      confidence: phone.e164 ? 0.95 : 0.5,
      parser_version: "csv-v1",
      touch_type: "manual",
      shared_evidence: "none",
    };
    const { data, error } = await supabase.rpc("create_lead", { p_workspace: workspace.id, p: payload });
    if (error) { counts.errors.push(`Row ${i + 2}: ${error.message}`); continue; }
    const res = data as { opportunity_id: string; result: string; duplicate_status?: string };
    if (res.result !== "created") { counts.duplicates++; continue; }
    counts.created++;

    // Historical outcomes: apply status and revenue when present.
    const valid = ["contacted", "qualified", "appointment", "proposal", "won", "lost", "nurture", "invalid", "spam"];
    if (valid.includes(status) || revenue) {
      // Stage timestamps default to the enquiry date so historical wins land in the right period.
      const at = receivedAt ?? new Date().toISOString();
      const rank = ["contacted", "qualified", "appointment", "proposal", "won"].indexOf(status);
      await supabase.from("opportunities").update({
        ...(valid.includes(status) ? { status } : {}),
        ...(rank >= 0 ? { contacted_at: at } : {}),
        ...(rank >= 1 ? { qualified_at: at } : {}),
        ...(rank >= 2 ? { appointment_at: at } : {}),
        ...(rank === 4 ? { won_at: at } : {}),
        ...(revenue ? { revenue_minor: parseMoneyToMinor(revenue) } : {}),
      }).eq("id", res.opportunity_id);
    }
  }
  await supabase.from("audit_events").insert({ workspace_id: workspace.id, entity_type: "workspace", entity_id: workspace.id, action: "csv_import", details: { rows: rows.length, created: counts.created, duplicates: counts.duplicates, skipped: counts.skipped } });
  revalidatePath("/leads");
  revalidatePath("/overview");
  return { ok: true, ...counts, errors: counts.errors.slice(0, 10) };
}

export async function rotateToken() {
  const { supabase, workspace } = await requireWorkspace();
  const { error } = await supabase.rpc("rotate_ingest_token", { p_workspace: workspace.id });
  if (error) throw new Error(error.message);
  revalidatePath("/connections");
}
