import Link from "next/link";
import { Suspense } from "react";
import { LogOut, Search } from "lucide-react";
import { Logo } from "@/components/logo";
import { MobileNav, SidebarNav } from "@/components/nav";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { Notice } from "@/components/ui";
import { requireWorkspace } from "@/lib/workspace";
import { getEconomics } from "@/lib/economics";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { supabase, workspace, member, workspaces, role } = await requireWorkspace();
  const now = new Date();
  const monthAgo = new Date(now.getTime() - 30 * 86400000);

  const [unassigned, overdue, connections, econ] = await Promise.all([
    supabase.from("opportunities").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id).eq("status", "new").is("owner_user_id", null),
    supabase.from("tasks").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id).eq("status", "open").lt("due_at", now.toISOString()),
    supabase.from("connections").select("provider, provider_account_ref, status, error_message_safe").eq("workspace_id", workspace.id).in("status", ["error", "degraded"]),
    getEconomics(monthAgo.toISOString(), now.toISOString()),
  ]);
  const counts = { leads: unassigned.count ?? 0, tasks: overdue.count ?? 0 };
  const broken = connections.data ?? [];
  const unknown = econ.totals.unknown_sources;

  // Record presence without blocking render on failure.
  supabase.from("workspace_members").update({ last_seen_at: now.toISOString() }).eq("workspace_id", workspace.id).eq("user_id", member.user_id).then(() => undefined);

  return (
    <div className="lg:grid lg:min-h-dvh lg:grid-cols-[15.5rem_1fr]">
      <aside className="no-print sticky top-0 hidden h-dvh flex-col gap-6 bg-navy-900 px-3 py-5 lg:flex">
        <div className="px-2"><Logo light /></div>
        <WorkspaceSwitcher current={workspace.id} workspaces={workspaces} />
        <SidebarNav counts={counts} />
        <div className="mt-auto border-t border-white/10 px-2 pt-4">
          <div className="text-sm font-medium text-white">{member.name}</div>
          <div className="text-xs text-white/50 capitalize">{role} · {workspace.name}</div>
          <form action="/auth/signout" method="post" className="mt-3">
            <button className="inline-flex items-center gap-2 text-xs text-white/60 hover:text-white">
              <LogOut className="size-3.5" aria-hidden /> Sign out
            </button>
          </form>
        </div>
      </aside>

      <div className="min-w-0 pb-24 lg:pb-0">
        <header className="no-print sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-surface/90 px-4 py-3 backdrop-blur sm:px-6">
          <div className="lg:hidden"><Logo /></div>
          <form action="/leads" className="relative ml-auto w-full max-w-xs lg:ml-0">
            <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-faint" aria-hidden />
            <label className="sr-only" htmlFor="q">Search leads</label>
            <input id="q" name="q" className="input !py-2 pl-9" placeholder="Search name, phone, service…" />
          </form>
          <div className="ml-auto hidden text-sm text-muted sm:block">{workspace.name}</div>
        </header>

        {(broken.length > 0 || unknown.length > 0) && (
          <div className="no-print space-y-2 px-4 pt-4 sm:px-6">
            {broken.map((c) => (
              <Notice key={c.provider + c.provider_account_ref} tone="crit" title={`${c.provider_account_ref}: connection ${c.status}`} action={<Link href="/connections" className="btn-secondary !py-1 text-xs">Reconnect</Link>}>
                {c.error_message_safe ?? "New leads from this connection may be missing."}
              </Notice>
            ))}
            {unknown.length > 0 && (
              <Notice
                title={`Cost data incomplete for ${unknown.join(", ")}`}
                action={<Link href="/economics/costs" className="btn-secondary !py-1 text-xs whitespace-nowrap">Add costs</Link>}
              >
                These sources had leads in the last 30 days but no recorded spend, so blended CAC is shown as unknown.
              </Notice>
            )}
          </div>
        )}

        <main className="px-4 py-5 sm:px-6 sm:py-6">
          <Suspense>{children}</Suspense>
        </main>
      </div>
      <MobileNav counts={counts} />
    </div>
  );
}
