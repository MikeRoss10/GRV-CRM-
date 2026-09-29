import { NextResponse, type NextRequest } from "next/server";
import { createAnonClient } from "@/lib/supabase/server";
import { parseLeadMessage, toIngestPayload, SOURCE_LABELS, type SourceType } from "@/lib/parsers";

/**
 * Lead ingestion webhook for forwarded emails (Gmail Apps Script, Zapier, Make) and SMS forwarders.
 * Auth: workspace ingest token as `Authorization: Bearer <token>`, `x-leadlens-token`, or `?token=`.
 * Body: JSON { text|body|message, subject?, from|sender?, source?, received_at?, id? }, form data, or plain text.
 */
export async function POST(request: NextRequest) {
  const token =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    request.headers.get("x-leadlens-token") ||
    request.nextUrl.searchParams.get("token");
  if (!token) return NextResponse.json({ error: "Missing ingest token" }, { status: 401 });

  let input: Record<string, unknown> = {};
  const type = request.headers.get("content-type") ?? "";
  try {
    if (type.includes("application/json")) input = await request.json();
    else if (type.includes("form")) input = Object.fromEntries((await request.formData()).entries());
    else input = { text: await request.text() };
  } catch {
    return NextResponse.json({ error: "Could not read request body" }, { status: 400 });
  }

  const str = (...keys: string[]) => {
    for (const k of keys) {
      const v = input[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return undefined;
  };
  const text = str("text", "body", "message", "plain", "content", "msg");
  if (!text) return NextResponse.json({ error: "No message text found (expected text, body or message)" }, { status: 400 });
  if (text.length > 20000) return NextResponse.json({ error: "Message too large" }, { status: 413 });

  const hint = str("source");
  const sender = str("from", "sender", "phone");
  const subject = str("subject");
  const receivedRaw = str("received_at", "date", "timestamp");
  const receivedAt = receivedRaw && !Number.isNaN(new Date(receivedRaw).getTime()) ? new Date(receivedRaw).toISOString() : undefined;
  const channel = str("channel") ?? (subject ? "email" : "sms");

  const parsed = parseLeadMessage(text, { sender, subject, sourceHint: hint && hint in SOURCE_LABELS ? (hint as SourceType) : undefined });
  const raw = [subject && `Subject: ${subject}`, sender && `From: ${sender}`, text].filter(Boolean).join("\n");
  const providerId = str("id", "message_id", "messageId");
  const payload = toIngestPayload(parsed, raw, {
    event_type: channel === "email" ? "email" : "sms",
    idempotency_key: providerId ? `ext-${providerId}` : undefined,
    received_at: receivedAt,
  });

  const supabase = createAnonClient();
  const { data, error } = await supabase.rpc("ingest_lead", { p_token: token, p: payload });
  if (error) {
    const invalid = /invalid ingest token/i.test(error.message);
    return NextResponse.json({ error: invalid ? "Invalid ingest token" : "Could not store the lead" }, { status: invalid ? 401 : 500 });
  }
  return NextResponse.json({
    ...(data as object),
    source: parsed.source.value,
    confidence: parsed.confidence,
    needs_review: parsed.confidence < 0.8 || !parsed.fields.phone_e164.value,
    missing: parsed.missing,
  });
}

export function GET() {
  return NextResponse.json({ ok: true, usage: "POST lead notifications here with your workspace ingest token." });
}
