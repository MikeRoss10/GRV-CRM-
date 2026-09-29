"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import {
  BarChart3, CalendarCheck, FileText, Inbox, LayoutDashboard, MoreHorizontal, Plug, Settings,
} from "lucide-react";
import { useState } from "react";

export const NAV = [
  { href: "/overview", label: "Overview", icon: LayoutDashboard },
  { href: "/leads", label: "Leads", icon: Inbox, badge: "leads" },
  { href: "/economics", label: "Source Economics", icon: BarChart3 },
  { href: "/follow-up", label: "Follow-up", icon: CalendarCheck, badge: "tasks" },
  { href: "/reports", label: "Reports", icon: FileText },
  { href: "/connections", label: "Connections", icon: Plug },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

type Counts = { leads: number; tasks: number };

function isActive(path: string, href: string) {
  return path === href || path.startsWith(`${href}/`);
}

export function SidebarNav({ counts }: { counts: Counts }) {
  const path = usePathname();
  return (
    <nav className="flex flex-col gap-0.5" aria-label="Main">
      {NAV.map(({ href, label, icon: Icon, ...rest }) => {
        const badge = "badge" in rest ? counts[rest.badge as keyof Counts] : 0;
        const active = isActive(path, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={clsx(
              "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active ? "bg-white/10 text-white" : "text-white/65 hover:bg-white/5 hover:text-white",
            )}
          >
            <Icon className={clsx("size-4", active ? "text-teal-500" : "text-white/50 group-hover:text-white/80")} aria-hidden />
            <span className="flex-1">{label}</span>
            {badge > 0 && (
              <span className="rounded-md bg-teal-500/20 px-1.5 text-xs text-teal-100 tnum" aria-label={`${badge} need attention`}>
                {badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

const MOBILE: ReadonlyArray<(typeof NAV)[number]> = [NAV[0], NAV[1], NAV[3]];

export function MobileNav({ counts }: { counts: Counts }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const moreActive = !MOBILE.some((n) => isActive(path, n.href));
  return (
    <>
      {open && (
        <div className="fixed inset-0 z-40 bg-navy-950/40 lg:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-x-3 bottom-20 rounded-2xl bg-white p-2 shadow-[var(--shadow-pop)]" onClick={(e) => e.stopPropagation()}>
            {NAV.filter((n) => !MOBILE.includes(n)).map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href} onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-ink hover:bg-navy-50">
                <Icon className="size-4 text-muted" aria-hidden /> {label}
              </Link>
            ))}
          </div>
        </div>
      )}
      <nav className="no-print fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden" aria-label="Main">
        {MOBILE.map(({ href, label, icon: Icon, ...rest }) => {
          const active = isActive(path, href);
          const badge = "badge" in rest ? counts[rest.badge as keyof Counts] : 0;
          return (
            <Link key={href} href={href} aria-current={active ? "page" : undefined} className={clsx("relative flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium", active ? "text-navy-900" : "text-faint")}>
              <Icon className={clsx("size-5", active && "text-teal-600")} aria-hidden />
              {label}
              {badge > 0 && <span className="absolute top-1.5 left-1/2 ml-2 rounded-full bg-teal-600 px-1.5 text-[10px] text-white tnum">{badge}</span>}
            </Link>
          );
        })}
        <button onClick={() => setOpen((o) => !o)} className={clsx("flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium", moreActive || open ? "text-navy-900" : "text-faint")} aria-expanded={open}>
          <MoreHorizontal className="size-5" aria-hidden />
          More
        </button>
      </nav>
    </>
  );
}
