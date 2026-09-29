import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Role = "owner" | "manager" | "rep" | "analyst";

export interface Workspace {
  id: string;
  name: string;
  timezone: string;
  default_currency: string;
  vertical: string | null;
  default_sla_minutes: number;
  staff_hourly_cost_minor: number | null;
  call_window_start: string;
  call_window_end: string;
}

export interface Member {
  workspace_id: string;
  user_id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
}

export const WS_COOKIE = "ll_ws";

export const getUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
});

/** Loads the signed-in user's current workspace, or redirects to login / onboarding. */
export const requireWorkspace = cache(async () => {
  const { supabase, user } = await getUser();
  if (!user) redirect("/login");

  let { data: memberships } = await supabase
    .from("workspace_members")
    .select("workspace_id, user_id, name, email, role, active, workspaces(*)")
    .eq("user_id", user.id)
    .eq("active", true);

  if (!memberships?.length) {
    const { data: accepted } = await supabase.rpc("accept_invites");
    if (accepted) {
      ({ data: memberships } = await supabase
        .from("workspace_members")
        .select("workspace_id, user_id, name, email, role, active, workspaces(*)")
        .eq("user_id", user.id)
        .eq("active", true));
    }
  }
  if (!memberships?.length) redirect("/onboarding");

  const selected = (await cookies()).get(WS_COOKIE)?.value;
  const current = memberships.find((m) => m.workspace_id === selected) ?? memberships[0];
  const workspace = current.workspaces as unknown as Workspace;

  const { data: members } = await supabase
    .from("workspace_members")
    .select("workspace_id, user_id, name, email, role, active")
    .eq("workspace_id", workspace.id)
    .order("name");

  return {
    supabase,
    user,
    workspace,
    member: current as unknown as Member,
    role: current.role as Role,
    members: (members ?? []) as Member[],
    workspaces: memberships.map((m) => ({ id: m.workspace_id, name: (m.workspaces as unknown as Workspace).name, role: m.role as Role })),
  };
});

export const can = {
  work: (r: Role) => r !== "analyst",
  manageCosts: (r: Role) => r !== "rep",
  manage: (r: Role) => r === "owner" || r === "manager",
  own: (r: Role) => r === "owner",
  seeRaw: (r: Role) => r !== "analyst",
  /** Spend, economics, reports, connections and settings. Workers (reps) only see customers and leads. */
  seeBusiness: (r: Role) => r !== "rep",
};

export const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner (admin)",
  manager: "Manager (admin)",
  rep: "Worker",
  analyst: "Analyst",
};

/** For admin-area pages: workers are sent back to their lead queue. */
export async function requireBusinessAccess() {
  const c = await requireWorkspace();
  if (!can.seeBusiness(c.role)) redirect("/leads?view=mine");
  return c;
}
