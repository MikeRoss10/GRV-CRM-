import Link from "next/link";
import { headers } from "next/headers";
import { Mail, MessageSquareText, Phone, RefreshCw, Webhook, BarChart3 } from "lucide-react";
import { Badge, PageHeader, SectionTitle } from "@/components/ui";
import { ago } from "@/lib/format";
import { can, requireWorkspace } from "@/lib/workspace";
import { rotateToken } from "./actions";
import { CodeBlock, CopyField, CsvImport, ParserTester } from "./client";

export const metadata = { title: "Connections" };

export default async function ConnectionsPage() {
  const { supabase, workspace, role } = await requireWorkspace();
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const endpoint = `${origin}/api/ingest`;

  const [{ data: secret }, { data: conns }, { data: recent }, { count: review }] = await Promise.all([
    can.own(role) ? supabase.from("workspace_secrets").select("ingest_token, rotated_at").eq("workspace_id", workspace.id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("connections").select("*").eq("workspace_id", workspace.id),
    can.seeRaw(role) ? supabase.from("raw_events").select("id, event_type, parse_status, parser_version, received_at, opportunity_id").eq("workspace_id", workspace.id).not("idempotency_key", "like", "demo-%").order("received_at", { ascending: false }).limit(8) : Promise.resolve({ data: null }),
    supabase.from("raw_events").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id).eq("parse_status", "needs_review"),
  ]);
  const webhook = conns?.find((c) => c.provider === "webhook");
  const token = secret?.ingest_token ?? "YOUR_INGEST_TOKEN";

  const appsScript = `// LeadLens — forward Gmail lead alerts (Justdial, Sulekha, 91acres…)
// 1. In Gmail, create a filter that applies the label "LeadLens" to lead emails.
// 2. Paste this at script.google.com, then add a time-driven trigger: forwardLeads, every 5 minutes.
const ENDPOINT = "${endpoint}";
const TOKEN = "${token}";

function forwardLeads() {
  const label = GmailApp.getUserLabelByName("LeadLens");
  if (!label) return;
  const done = GmailApp.getUserLabelByName("LeadLens/Sent") || GmailApp.createLabel("LeadLens/Sent");
  label.getThreads(0, 50).forEach((thread) => {
    thread.getMessages().forEach((m) => {
      UrlFetchApp.fetch(ENDPOINT, {
        method: "post",
        contentType: "application/json",
        headers: { Authorization: "Bearer " + TOKEN },
        payload: JSON.stringify({
          id: m.getId(), channel: "email", subject: m.getSubject(), from: m.getFrom(),
          text: m.getPlainBody(), received_at: m.getDate().toISOString(),
        }),
        muteHttpExceptions: true,
      });
    });
    thread.removeLabel(label).addLabel(done);
  });
}`;

  const curl = `curl -X POST ${endpoint} \\
  -H "Authorization: Bearer ${token}" \\
  -H "Content-Type: application/json" \\
  -d '{"channel":"sms","from":"VM-SULEKH","text":"Customer: Anjali Sharma\\nPhone: 9876543321\\nRequirement: 2 BHK\\nLocation: Andheri"}'`;

  return (
    <div className="space-y-5">
      <PageHeader title="Connections" description="Bring enquiries in from email, SMS, forms and spreadsheets. Sources are matched by parser profiles — no scraping of aggregator sites." />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <ConnCard icon={<Webhook className="size-5" />} title="Forwarding endpoint" status={webhook?.status ?? "pending"} detail={webhook?.last_sync_at ? `Last lead ${ago(webhook.last_sync_at)} ago` : "Waiting for the first lead"} />
        <ConnCard icon={<Mail className="size-5" />} title="Gmail" status="via script" detail="Forward labelled lead emails with the Apps Script below. Direct OAuth sync is planned." />
        <ConnCard icon={<MessageSquareText className="size-5" />} title="SMS" status="via forwarder" detail="Point an SMS forwarder or provider webhook at the endpoint. DLT-registered sending comes later." />
        <ConnCard icon={<Phone className="size-5" />} title="AI voice" status="not connected" detail="Requires a provider with India KYC and compliance review." />
      </div>

      <section className="card p-4 sm:p-5">
        <SectionTitle>1 · Forwarding endpoint</SectionTitle>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            <CopyField label="Endpoint URL (POST)" value={endpoint} />
            {can.own(role) ? (
              <>
                <CopyField label="Ingest token — keep private" value={token} secret />
                <form action={rotateToken} className="flex items-center gap-3 text-xs text-muted">
                  <button className="btn-secondary !py-1 text-xs"><RefreshCw className="size-3.5" aria-hidden />Rotate token</button>
                  Rotated {secret?.rotated_at ? `${ago(secret.rotated_at)} ago` : "never"}. Old scripts stop working after rotation.
                </form>
              </>
            ) : (
              <p className="text-sm text-muted">Only the workspace owner can see the ingest token.</p>
            )}
            <p className="text-sm text-muted">
              Accepts JSON (<code className="text-xs">text</code>, <code className="text-xs">subject</code>, <code className="text-xs">from</code>, <code className="text-xs">source</code>, <code className="text-xs">received_at</code>, <code className="text-xs">id</code>), form posts or plain text.
              Sending the same <code className="text-xs">id</code> twice never creates a second lead. Low-confidence parses go to the review queue{review ? ` (${review} waiting)` : ""}.
            </p>
          </div>
          <div className="space-y-3">
            <div className="label">Test with cURL</div>
            <CodeBlock code={curl} />
          </div>
        </div>
      </section>

      <section className="card p-4 sm:p-5">
        <SectionTitle>2 · Gmail: forward labelled lead emails</SectionTitle>
        <p className="mb-3 text-sm text-muted">
          Runs inside your own Google account, reads only emails you label <b>LeadLens</b>, and posts them here. No mailbox-wide access is granted to LeadLens.
        </p>
        <CodeBlock code={appsScript} />
      </section>

      <section className="card p-4 sm:p-5">
        <SectionTitle>3 · Test a source template</SectionTitle>
        <p className="mb-3 text-sm text-muted">Paste a real Justdial, Sulekha or 91acres message to check what the parser extracts before turning on forwarding.</p>
        <ParserTester canSave={can.work(role)} />
      </section>

      <section id="import" className="card scroll-mt-20 p-4 sm:p-5">
        <SectionTitle>4 · Import a CSV</SectionTitle>
        <p className="mb-3 text-sm text-muted">Bring in 30–90 days of history (leads and outcomes) so the first source comparison has something to compare.</p>
        {can.work(role) ? <CsvImport /> : <p className="text-sm text-muted">Analysts can&apos;t import leads.</p>}
      </section>

      <section className="card p-4 sm:p-5">
        <SectionTitle>Ads spend</SectionTitle>
        <div className="flex items-start gap-3 text-sm text-muted">
          <BarChart3 className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>Enter Meta Ads and Google Ads spend monthly under <Link href="/economics/costs" className="font-medium text-teal-700 hover:underline">Cost assumptions</Link>. Tag lead-form leads with source <code className="text-xs">meta_ads</code> or <code className="text-xs">google_ads</code> when posting to the endpoint.</p>
        </div>
      </section>

      {recent && recent.length > 0 && (
        <section className="card overflow-hidden">
          <div className="px-4 pt-4"><SectionTitle>Recent ingestion</SectionTitle></div>
          <ul className="divide-y divide-line text-sm">
            {recent.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
                <Badge tone={e.parse_status === "parsed" ? "teal" : e.parse_status === "needs_review" ? "amber" : "neutral"}>{e.parse_status.replace("_", " ")}</Badge>
                <span className="flex-1">{e.event_type} · {e.parser_version ?? "—"}</span>
                <span className="text-xs text-muted">{ago(e.received_at)} ago</span>
                {e.opportunity_id && <Link href={`/leads/${e.opportunity_id}`} className="text-xs font-medium text-teal-700 hover:underline">Lead →</Link>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function ConnCard({ icon, title, status, detail }: { icon: React.ReactNode; title: string; status: string; detail: string }) {
  const tone = status === "healthy" ? "teal" : status === "error" ? "crit" : status === "not connected" ? "neutral" : status === "pending" ? "amber" : "navy";
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <span className="rounded-lg bg-navy-50 p-2 text-navy-700" aria-hidden>{icon}</span>
        <Badge tone={tone}>{status}</Badge>
      </div>
      <div className="mt-3 font-medium">{title}</div>
      <p className="mt-1 text-sm text-muted">{detail}</p>
    </div>
  );
}
