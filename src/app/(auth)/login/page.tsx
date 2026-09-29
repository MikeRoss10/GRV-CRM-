import { Suspense } from "react";
import { AuthForm } from "../auth-form";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
      <p className="mt-1 mb-6 text-sm text-muted">Sign in to see today&apos;s leads and source economics.</p>
      <Suspense>
        <AuthForm mode="login" />
      </Suspense>
    </>
  );
}
