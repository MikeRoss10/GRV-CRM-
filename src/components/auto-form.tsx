"use client";

import type { ReactNode } from "react";

/** A GET form that submits whenever one of its controls changes. */
export function AutoForm({ action, children, className }: { action: string; children: ReactNode; className?: string }) {
  return (
    <form action={action} className={className} onChange={(e) => e.currentTarget.requestSubmit()}>
      {children}
      <noscript><button className="btn-secondary">Apply</button></noscript>
    </form>
  );
}
