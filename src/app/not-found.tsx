import Link from "next/link";
import { Logo } from "@/components/logo";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <Logo />
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="text-sm text-muted">The lead or page may have been removed, or you may not have access to it.</p>
      <Link href="/overview" className="btn-primary">Back to overview</Link>
    </div>
  );
}
