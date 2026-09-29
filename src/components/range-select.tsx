"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarRange } from "lucide-react";
import { RANGES } from "@/lib/dates";

export function RangeSelect({ fallback = "30d" }: { fallback?: string }) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const value = params.get("range") ?? fallback;
  return (
    <label className="relative inline-flex items-center">
      <span className="sr-only">Date range</span>
      <CalendarRange className="pointer-events-none absolute left-2.5 size-4 text-muted" aria-hidden />
      <select
        value={value}
        onChange={(e) => {
          const next = new URLSearchParams(params);
          next.set("range", e.target.value);
          router.push(`${path}?${next.toString()}`);
        }}
        className="input !w-auto cursor-pointer !py-1.5 pl-8 font-medium"
      >
        {Object.entries(RANGES).map(([k, r]) => (
          <option key={k} value={k}>{r.label}</option>
        ))}
      </select>
    </label>
  );
}
