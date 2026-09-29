"use client";

import { Notice } from "@/components/ui";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-lg py-10">
      <Notice tone="crit" title="Something went wrong loading this page" action={<button onClick={reset} className="btn-secondary !py-1 text-xs">Try again</button>}>
        {error.message || "Unexpected error."}{error.digest && <span className="block text-xs opacity-70">Ref: {error.digest}</span>}
      </Notice>
    </div>
  );
}
