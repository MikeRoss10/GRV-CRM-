import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { SOURCE_LABELS } from "@/lib/parsers";
import { NewLeadForm } from "./form";

export const metadata = { title: "Add lead" };

export default function NewLeadPage() {
  return (
    <div className="max-w-2xl">
      <Link href="/leads" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4" aria-hidden />Leads</Link>
      <PageHeader title="Add a lead" description="For walk-ins, phone enquiries and referrals. Leads with the same phone number are flagged as probable duplicates." />
      <NewLeadForm sources={Object.entries(SOURCE_LABELS)} />
    </div>
  );
}
