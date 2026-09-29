import { redirect } from "next/navigation";
import { Logo } from "@/components/logo";
import { getUser } from "@/lib/workspace";
import { OnboardingForm } from "./form";

export const metadata = { title: "Set up your workspace" };

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const { supabase, user } = await getUser();
  if (!user) redirect("/login");
  const { new: forceNew } = await searchParams;

  if (!forceNew) {
    await supabase.rpc("accept_invites");
    const { count } = await supabase.from("workspace_members").select("*", { count: "exact", head: true }).eq("user_id", user.id);
    if (count) redirect("/overview");
  }

  return (
    <div className="min-h-dvh bg-surface">
      <header className="border-b border-line bg-white px-6 py-4">
        <Logo />
      </header>
      <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <p className="eyebrow">Step 1 of 3</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Tell us about the business</h1>
        <p className="mt-1 text-sm text-muted">
          We use this to set your currency, timezone and response-time target. You can change everything later in Settings.
        </p>
        <OnboardingForm defaultName={(user.user_metadata?.name as string) ?? ""} />
        <ol className="mt-8 grid gap-3 text-sm text-muted sm:grid-cols-3">
          <li className="card p-4"><span className="font-medium text-ink">1. Workspace</span><br />Business, currency, SLA.</li>
          <li className="card p-4"><span className="font-medium text-ink">2. Connect sources</span><br />Forward Justdial / Sulekha / 91acres alerts or import a CSV.</li>
          <li className="card p-4"><span className="font-medium text-ink">3. Add costs</span><br />Packages, subscriptions and ad spend to unlock CAC.</li>
        </ol>
      </main>
    </div>
  );
}
