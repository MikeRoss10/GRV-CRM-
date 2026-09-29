"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { WS_COOKIE } from "@/lib/workspace";

export async function createWorkspace(_: unknown, form: FormData): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: ws, error } = await supabase.rpc("create_workspace", {
    p_name: String(form.get("name") ?? "").trim(),
    p_vertical: String(form.get("vertical") ?? "") || null,
    p_timezone: String(form.get("timezone") ?? "Asia/Kolkata"),
    p_currency: String(form.get("currency") ?? "INR"),
    p_sla_minutes: Number(form.get("sla") ?? 15),
    p_member_name: String(form.get("member_name") ?? "").trim() || null,
  });
  if (error || !ws) return { error: error?.message ?? "Could not create the workspace" };

  (await cookies()).set(WS_COOKIE, ws as string, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });

  if (form.get("demo") === "on") {
    const { error: seedError } = await supabase.rpc("seed_demo_data", { p_workspace: ws });
    if (seedError) return { error: `Workspace created, but sample data failed: ${seedError.message}` };
  }
  redirect("/overview?welcome=1");
}
