"use client";

import { ChevronsUpDown } from "lucide-react";
import { switchWorkspace } from "@/app/(app)/actions";

export function WorkspaceSwitcher({ current, workspaces }: { current: string; workspaces: Array<{ id: string; name: string }> }) {
  return (
    <form action={switchWorkspace} className="relative">
      <label className="sr-only" htmlFor="ws">Workspace</label>
      <select
        id="ws"
        name="workspace_id"
        defaultValue={current}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="w-full cursor-pointer appearance-none truncate rounded-lg border border-white/10 bg-white/5 py-2 pr-8 pl-3 text-sm font-medium text-white focus:outline-2 focus:outline-teal-500"
      >
        {workspaces.map((w) => (
          <option key={w.id} value={w.id} className="text-ink">{w.name}</option>
        ))}
      </select>
      <ChevronsUpDown className="pointer-events-none absolute top-2.5 right-2.5 size-4 text-white/50" aria-hidden />
    </form>
  );
}
