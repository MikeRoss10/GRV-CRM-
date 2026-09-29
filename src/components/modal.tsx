"use client";

import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

/** Accessible dialog using the native <dialog> element (focus trap + Esc handled by the browser). */
export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={`m-auto w-[calc(100%-1.5rem)] ${wide ? "max-w-2xl" : "max-w-lg"} rounded-2xl border border-line bg-white p-0 text-ink shadow-[var(--shadow-pop)] backdrop:bg-navy-950/40 backdrop:backdrop-blur-[2px]`}
    >
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <h2 className="text-base font-semibold">{title}</h2>
        <button onClick={onClose} className="btn-ghost !p-1.5" aria-label="Close"><X className="size-4" /></button>
      </div>
      <div className="max-h-[70dvh] overflow-y-auto px-5 py-4">{children}</div>
      {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-stone-50 px-5 py-3">{footer}</div>}
    </dialog>
  );
}
