"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { WS_COOKIE } from "@/lib/workspace";

export async function switchWorkspace(form: FormData) {
  const id = String(form.get("workspace_id"));
  (await cookies()).set(WS_COOKIE, id, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  redirect("/overview");
}
