"use client";

import { Printer } from "lucide-react";

export function PrintButton() {
  return <button onClick={() => window.print()} className="btn-secondary"><Printer className="size-4" aria-hidden />Print / PDF</button>;
}
