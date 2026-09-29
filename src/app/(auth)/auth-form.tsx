"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Loader2, MailCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Notice } from "@/components/ui";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/overview";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(params.get("error"));
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setError(error.message === "Email not confirmed" ? "Please confirm your email first — check your inbox for the link." : error.message);
        setBusy(false);
        return;
      }
      router.replace(next);
      router.refresh();
    } else {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { name }, emailRedirectTo: `${window.location.origin}/auth/callback?next=/onboarding` },
      });
      if (error) {
        setError(error.message);
        setBusy(false);
        return;
      }
      if (data.session) {
        router.replace("/onboarding");
        router.refresh();
      } else {
        setSent(true);
        setBusy(false);
      }
    }
  }

  if (sent) {
    return (
      <div className="text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-teal-50 text-teal-700">
          <MailCheck className="size-6" aria-hidden />
        </div>
        <h2 className="text-lg font-semibold">Check your inbox</h2>
        <p className="mt-2 text-sm text-muted">
          We sent a confirmation link to <span className="font-medium text-ink">{email}</span>. Open it to finish setting up your workspace.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <Notice tone="crit" title={error} />}
      {mode === "signup" && (
        <div>
          <label className="label" htmlFor="name">Your name</label>
          <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required placeholder="Priya Nair" />
        </div>
      )}
      <div>
        <label className="label" htmlFor="email">Work email</label>
        <input id="email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required placeholder="you@business.com" />
      </div>
      <div>
        <label className="label" htmlFor="password">Password</label>
        <input
          id="password" type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={8}
          placeholder={mode === "signup" ? "At least 8 characters" : ""}
        />
      </div>
      <button className="btn-primary w-full py-2.5" disabled={busy}>
        {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
        {mode === "login" ? "Sign in" : "Create account"}
      </button>
      <p className="text-center text-sm text-muted">
        {mode === "login" ? (
          <>New to LeadLens? <Link className="font-medium text-teal-700 hover:underline" href="/signup">Create an account</Link></>
        ) : (
          <>Already have an account? <Link className="font-medium text-teal-700 hover:underline" href="/login">Sign in</Link></>
        )}
      </p>
    </form>
  );
}
