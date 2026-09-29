import { Suspense } from "react";
import { AuthForm } from "../auth-form";

export const metadata = { title: "Create account" };

export default function SignupPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Create your workspace</h1>
      <p className="mt-1 mb-6 text-sm text-muted">See your first source comparison in about 15 minutes.</p>
      <Suspense>
        <AuthForm mode="signup" />
      </Suspense>
    </>
  );
}
