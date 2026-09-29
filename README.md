# LeadLens

Lead intelligence for businesses that buy enquiries from **Justdial, Sulekha, 91acres, Meta Ads, Google Ads**, websites and referrals.
It answers one question: *where are we spending money and staff time, and which lead sources actually create revenue?*

- **Lead inbox** with SLA clocks, masked phones, claim/assign, duplicate and shared-lead badges, and estimated source cost per lead.
- **Lead detail** with source evidence, parser confidence, raw message, a full timeline, one-tap outcomes, call logging, approved-template messaging and an **AI call preflight** (consent basis, allowed hours, suppression, provider and script approval).
- **Source economics**: spend (packages allocated equal-daily, per-lead prices attached directly), CPL, CPQL, CAC with optional response cost, ROAS, median response and a *scale / optimize / test / reduce / fix costs* recommendation with its reasons. Unknown costs stay **Unknown**, never ₹0.
- **Ingestion**: a token-authenticated webhook (`POST /api/ingest`) with deterministic parsers for aggregator SMS and emails, a Gmail Apps Script forwarder, a parser tester and CSV import. Idempotent on provider IDs, dedupes on phone and email, and routes low-confidence parses to review.
- **Reports** as print/PDF, Markdown and CSV. Every export is audit-logged.
- **Roles** (owner, manager, rep, analyst) enforced by Postgres row-level security. Suppression list, consent ledger and audit log included.

## Stack

Next.js 15 (App Router, server actions) · Supabase (Postgres, Auth, RLS, RPC) · Tailwind CSS 4 · Recharts · Vitest.

```
src/app/(auth)        login / signup
src/app/(app)         overview, leads, economics, follow-up, reports, connections, settings
src/app/api/ingest    lead webhook
src/app/api/export    CSV / Markdown exports
src/lib/parsers.ts    source detection + field extraction with confidence
src/lib/metrics.ts    economics + recommendations
src/lib/policy.ts     communication guardrails
supabase/migrations   schema, RLS, ingestion, economics and demo-data functions
```

## Supabase

The project **`leadlens`** (`xwmobgdcajecszxjztgf`, region ap-south-1) already has all migrations in `supabase/migrations` applied.
To use another project, apply the migrations in order (`supabase db push` or the SQL editor).

In the Supabase dashboard → **Authentication → URL Configuration**:

- **Site URL**: your Vercel URL, e.g. `https://leadlens.vercel.app`
- **Redirect URLs**: add `https://<your-domain>/auth/callback` (and `http://localhost:3000/auth/callback` for local dev)

Without this, confirmation emails link to `localhost`.

## Deploy to Vercel

1. Import this repository in Vercel (framework preset: Next.js — detected automatically).
2. Environment variables (optional: the code falls back to the `leadlens` project's public values):
   - `NEXT_PUBLIC_SUPABASE_URL` = `https://xwmobgdcajecszxjztgf.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` = the project's publishable key (Supabase → Project Settings → API Keys)
3. Deploy, then set the Site URL and redirect URL in Supabase as above.

No server-side secrets are needed: webhooks authenticate with a per-workspace ingest token checked inside Postgres.

## Local development

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # parser, metrics and policy unit tests
npm run typecheck
npm run lint
```

## Getting leads in

- **Webhook**: `POST /api/ingest` with `Authorization: Bearer <ingest token>` (Connections page) and JSON `{ "text": "...", "subject": "...", "from": "...", "source": "sulekha", "id": "provider-message-id" }`.
- **Gmail**: label lead emails `LeadLens` and install the Apps Script shown on the Connections page (runs in your own Google account).
- **SMS**: point an SMS forwarder or provider webhook at the same endpoint.
- **CSV**: Connections → Import a CSV (maps columns automatically; re-imports are safe).

## Not yet built

Direct Gmail OAuth sync, an SMS sending provider (DLT), a live AI voice provider, and ads-API spend import.
The AI call flow is fully gated and stays blocked until a compliant voice provider is connected.
This is product guidance, not legal advice. Review consent and calling rules with counsel before outbound automation.
