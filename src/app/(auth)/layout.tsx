import { Logo } from "@/components/logo";

const SAMPLE = [
  { name: "Meta Ads", cac: "₹4,220", width: "22%", decision: "Scale", tone: "bg-teal-500/20 text-teal-100" },
  { name: "Google Ads", cac: "₹5,167", width: "27%", decision: "Optimize", tone: "bg-white/10 text-white/80" },
  { name: "Sulekha", cac: "₹14,000", width: "66%", decision: "Test", tone: "bg-white/10 text-white/80" },
  { name: "Justdial", cac: "₹21,000", width: "100%", decision: "Reduce", tone: "bg-amber-500/20 text-amber-100" },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_1.1fr]">
      <main className="flex flex-col px-6 py-8 sm:px-12">
        <Logo />
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">{children}</div>
        <p className="text-xs text-faint">Your lead data stays in your workspace. Phone numbers are masked by default.</p>
      </main>
      <aside className="relative hidden overflow-hidden bg-navy-900 px-12 py-12 text-white lg:flex lg:flex-col lg:justify-center">
        <div aria-hidden className="absolute -top-32 -right-32 size-[28rem] rounded-full bg-teal-500/10 blur-3xl" />
        <div className="relative max-w-lg">
          <p className="eyebrow !text-teal-500">Lead economics</p>
          <h2 className="mt-3 text-3xl leading-tight font-semibold tracking-tight">
            Where is the money going, and which sources actually create revenue?
          </h2>
          <p className="mt-4 text-white/70">
            Justdial, Sulekha, 91acres, Meta, Google and referrals in one queue — with the real cost per customer behind every source.
          </p>
          <div className="mt-10 rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur">
            <div className="mb-4 flex items-center justify-between text-xs text-white/60">
              <span>Cost per won customer · last 90 days</span>
              <span>sample</span>
            </div>
            <ul className="space-y-3">
              {SAMPLE.map((s) => (
                <li key={s.name} className="grid grid-cols-[6.5rem_1fr_4.5rem_4.5rem] items-center gap-3 text-sm">
                  <span className="text-white/90">{s.name}</span>
                  <span className="h-2 rounded-full bg-white/10">
                    <span className="block h-full rounded-full bg-teal-500" style={{ width: s.width }} />
                  </span>
                  <span className="text-right tnum text-white/90">{s.cac}</span>
                  <span className={`rounded-md px-2 py-0.5 text-center text-xs ${s.tone}`}>{s.decision}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </aside>
    </div>
  );
}
