export function Logo({ className = "", light = false }: { className?: string; light?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2 font-semibold tracking-tight ${light ? "text-white" : "text-navy-900"} ${className}`}>
      <svg viewBox="0 0 32 32" className="size-7" aria-hidden>
        <rect width="32" height="32" rx="8" fill={light ? "#1d3461" : "#0d1b36"} />
        <circle cx="14" cy="14" r="7" fill="none" stroke="#14b8a6" strokeWidth="3" />
        <path d="M19.5 19.5 25 25" stroke="#14b8a6" strokeWidth="3" strokeLinecap="round" />
        <circle cx="14" cy="14" r="2.5" fill="#fff" />
      </svg>
      LeadLens
    </span>
  );
}
