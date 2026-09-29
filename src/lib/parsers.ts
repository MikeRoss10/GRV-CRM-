/**
 * Deterministic lead parser for aggregator notifications (Justdial, Sulekha, 91acres),
 * ad lead forms and website enquiries. Every field carries a confidence score so that
 * low-confidence values are routed to review instead of triggering outreach.
 */
import { parseMoneyToMinor } from "./format";

export const PARSER_VERSION = "generic-v1";

export type SourceType =
  | "justdial" | "sulekha" | "91acres" | "meta_ads" | "google_ads" | "website" | "referral" | "walk_in" | "other";

export const SOURCE_LABELS: Record<SourceType, string> = {
  justdial: "Justdial",
  sulekha: "Sulekha",
  "91acres": "91acres",
  meta_ads: "Meta Ads",
  google_ads: "Google Ads",
  website: "Website",
  referral: "Referral",
  walk_in: "Walk-in",
  other: "Other",
};

export interface Field<T> {
  value: T | null;
  confidence: number;
  /** How the value was found: the label matched, or "pattern" for free-text matches. */
  method: string | null;
}

export interface ParseResult {
  source: { value: SourceType; confidence: number; reason: string };
  fields: {
    full_name: Field<string>;
    phone_e164: Field<string>;
    phone_original: Field<string>;
    email: Field<string>;
    service: Field<string>;
    location: Field<string>;
    budget_minor: Field<number>;
    cost_minor: Field<number>;
    provider_lead_id: Field<string>;
  };
  shared_evidence: "none" | "source_stated";
  /** Overall confidence used for review routing: the weakest of name and phone. */
  confidence: number;
  missing: string[];
  parser_version: string;
}

const LABELS: Record<keyof ParseResult["fields"] | "date", string[]> = {
  full_name: ["customer name", "name", "customer", "buyer", "person", "caller name", "contact person", "full name", "client"],
  phone_e164: ["mobile number", "mobile no", "mobile", "phone number", "phone no", "phone", "contact number", "contact no", "contact", "caller", "ph", "cell"],
  phone_original: [],
  email: ["email id", "email address", "email", "e-mail", "mail"],
  service: ["requirement", "looking for", "category", "service", "property type", "enquiry for", "interested in", "need", "product"],
  location: ["project location", "locality", "location", "area", "city", "address", "preferred location"],
  budget_minor: ["budget", "price range", "range"],
  cost_minor: ["lead price", "lead cost", "cost", "deducted", "charged", "amount deducted"],
  provider_lead_id: ["lead id", "request id", "enquiry id", "enquiry no", "enquiry number", "reference id", "ref no", "ref"],
  date: ["date", "sent at", "request time", "time"],
};

const SOURCE_PATTERNS: Array<{ source: SourceType; re: RegExp; reason: string }> = [
  { source: "justdial", re: /just\s?dial|\bjd\s?(lead|enquiry|user)|justdial\.com/i, reason: "Mentions Justdial" },
  { source: "sulekha", re: /sulekha/i, reason: "Mentions Sulekha" },
  { source: "91acres", re: /91\s?acres/i, reason: "Mentions 91acres" },
  { source: "meta_ads", re: /facebook|instagram|\bmeta\b|lead\s?form|fb\s?lead/i, reason: "Mentions Meta / Facebook lead form" },
  { source: "google_ads", re: /google\s?ads|adwords|gclid|lead form extension/i, reason: "Mentions Google Ads" },
  { source: "website", re: /website|contact form|web\s?form|landing page/i, reason: "Website form wording" },
  { source: "referral", re: /referr?al|referred by/i, reason: "Referral wording" },
];

const SHARED_RE =
  /(also\s+(been\s+)?(sent|shared)\s+(to|with)|shared\s+with\s+\d+|sent\s+to\s+\d+\s+(other\s+)?(businesses|providers|vendors|sellers|agents|dealers)|multiple\s+(providers|vendors|businesses|agents))/i;

const INDIAN_MOBILE_RE = /(?:\+?91[\s-]?|0)?[6-9]\d{2}[\s-]?\d{2}[\s-]?\d{5}|(?:\+?91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}/;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

/** Normalizes an Indian or international phone number to E.164. */
export function normalizePhone(raw: string | null | undefined, defaultCountry = "91"): { e164: string | null; confidence: number } {
  if (!raw) return { e164: null, confidence: 0 };
  if (/[x•*]{2,}/i.test(raw)) return { e164: null, confidence: 0 }; // masked by the source
  const hasPlus = raw.trim().startsWith("+");
  let d = raw.replace(/\D/g, "");
  if (!d) return { e164: null, confidence: 0 };
  if (hasPlus) {
    return d.length >= 8 && d.length <= 15 ? { e164: `+${d}`, confidence: d.startsWith("91") ? (d.length === 12 ? 0.98 : 0.6) : 0.85 } : { e164: null, confidence: 0 };
  }
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  if (d.length === 10) {
    const mobile = /^[6-9]/.test(d);
    return { e164: `+${defaultCountry}${d}`, confidence: mobile ? 0.96 : 0.7 };
  }
  return { e164: null, confidence: 0 };
}

function lineValue(lines: string[], labels: string[]): { value: string; label: string } | null {
  for (const label of labels) {
    const re = new RegExp(`^\\s*[*•-]?\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*(?:[:：=-]|\\bis\\b)\\s*(.+)$`, "i");
    for (const line of lines) {
      const m = line.match(re);
      if (m && m[1].trim()) return { value: m[1].trim(), label };
    }
  }
  return null;
}

const empty = <T,>(): Field<T> => ({ value: null, confidence: 0, method: null });

function cleanName(s: string): string | null {
  const t = s.replace(/[^\p{L}\s.'-]/gu, " ").replace(/\s+/g, " ").trim();
  if (!t || t.length > 60) return null;
  return t.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

export function detectSource(text: string, sender?: string, hint?: SourceType): ParseResult["source"] {
  if (hint && hint !== "other") return { value: hint, confidence: 1, reason: "Chosen by user" };
  const hay = `${sender ?? ""}\n${text}`;
  for (const p of SOURCE_PATTERNS) if (p.re.test(hay)) return { value: p.source, confidence: sender && p.re.test(sender) ? 0.98 : 0.9, reason: p.reason };
  return { value: "other", confidence: 0.3, reason: "No source markers found" };
}

export function parseLeadMessage(
  text: string,
  opts: { sender?: string; subject?: string; sourceHint?: SourceType } = {},
): ParseResult {
  const body = `${opts.subject ? `${opts.subject}\n` : ""}${text}`.replace(/\r/g, "");
  const lines = body.split(/\n|(?<=\S)\s{2,}(?=[A-Z][a-z]+\s*:)|\s\|\s/).map((l) => l.trim()).filter(Boolean);
  const fields: ParseResult["fields"] = {
    full_name: empty(), phone_e164: empty(), phone_original: empty(), email: empty(), service: empty(),
    location: empty(), budget_minor: empty(), cost_minor: empty(), provider_lead_id: empty(),
  };

  // Name
  const nameLine = lineValue(lines, LABELS.full_name);
  if (nameLine) {
    const v = cleanName(nameLine.value);
    if (v) fields.full_name = { value: v, confidence: v.split(" ").length >= 2 ? 0.99 : 0.85, method: nameLine.label };
  } else {
    const m = body.match(/(?:enquiry|inquiry|lead)\s+from\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2})|([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\s+(?:has\s+)?(?:enquired|inquired|is looking|searched|wants|requested)/);
    const v = m ? cleanName(m[1] ?? m[2]) : null;
    if (v) fields.full_name = { value: v, confidence: 0.8, method: "pattern" };
  }

  // Phone
  const phoneLine = lineValue(lines, LABELS.phone_e164);
  const phoneRaw = phoneLine?.value.match(/[+\d][\d\s-]{7,}\d|[\dx•*]{10,}/i)?.[0] ?? null;
  if (phoneRaw) {
    const n = normalizePhone(phoneRaw);
    fields.phone_original = { value: phoneRaw, confidence: 1, method: phoneLine!.label };
    if (n.e164) fields.phone_e164 = { value: n.e164, confidence: n.confidence, method: phoneLine!.label };
  } else {
    const m = body.match(INDIAN_MOBILE_RE);
    if (m) {
      const n = normalizePhone(m[0]);
      fields.phone_original = { value: m[0], confidence: 1, method: "pattern" };
      if (n.e164) fields.phone_e164 = { value: n.e164, confidence: Math.min(n.confidence, 0.85), method: "pattern" };
    }
  }

  // Email
  const emailLine = lineValue(lines, LABELS.email);
  const emailMatch = (emailLine?.value ?? body).match(EMAIL_RE);
  if (emailMatch) fields.email = { value: emailMatch[0].toLowerCase(), confidence: emailLine ? 0.99 : 0.85, method: emailLine?.label ?? "pattern" };

  // Service + location
  const svcLine = lineValue(lines, LABELS.service);
  const locLine = lineValue(lines, LABELS.location);
  if (svcLine) fields.service = { value: svcLine.value.replace(/\.$/, "").slice(0, 120), confidence: 0.91, method: svcLine.label };
  if (locLine) fields.location = { value: locLine.value.replace(/\.$/, "").slice(0, 120), confidence: 0.95, method: locLine.label };
  if (!svcLine || !locLine) {
    const m = body.match(/(?:enquired|inquired|looking|searched|requested|interested)\s+(?:for|in|about)\s+(.+?)(?:\s+(?:in|at|near)\s+([A-Z][\w\s-]{2,40}?))?(?:[.,\n]|\s+call\b|\s+contact\b|$)/i);
    if (m) {
      if (!svcLine && m[1]) fields.service = { value: m[1].trim(), confidence: 0.75, method: "pattern" };
      if (!locLine && m[2]) fields.location = { value: m[2].trim(), confidence: 0.75, method: "pattern" };
    }
  }

  // Budget: store the lower bound of a range with reduced confidence.
  const budgetLine = lineValue(lines, LABELS.budget_minor);
  if (budgetLine) {
    const parts = budgetLine.value.split(/\s*(?:-|–|to)\s*/i);
    const unit = budgetLine.value.match(/(cr|crore|l|lac|lakh|lakhs|k)\b/i)?.[1] ?? "";
    const first = parts[0].match(/[\d.,]+\s*(cr|crore|l|lac|lakh|lakhs|k)?/i)?.[0] ?? "";
    const withUnit = /[a-z]/i.test(first) ? first : `${first}${unit}`;
    const v = parseMoneyToMinor(withUnit);
    if (v) fields.budget_minor = { value: v, confidence: parts.length > 1 ? 0.7 : 0.9, method: budgetLine.label };
  }

  // Source cost: never set to zero; unknown stays null.
  const costLine = lineValue(lines, LABELS.cost_minor);
  if (costLine) {
    const m = costLine.value.match(/[\d.,]+\s*(k)?/i);
    const v = m ? parseMoneyToMinor(m[0]) : null;
    if (v && v > 0) fields.cost_minor = { value: v, confidence: 0.88, method: costLine.label };
  }

  const idLine = lineValue(lines, LABELS.provider_lead_id);
  if (idLine) {
    const v = idLine.value.match(/[A-Z0-9-]{4,}/i)?.[0];
    if (v) fields.provider_lead_id = { value: v, confidence: 0.95, method: idLine.label };
  }

  const source = detectSource(body, opts.sender, opts.sourceHint);
  const missing = (["full_name", "phone_e164", "service", "location", "cost_minor", "provider_lead_id"] as const).filter(
    (k) => fields[k].value === null,
  );
  const confidence = Math.min(fields.phone_e164.value ? fields.phone_e164.confidence : 0, fields.full_name.value ? fields.full_name.confidence : 0.6);

  return {
    source,
    fields,
    shared_evidence: SHARED_RE.test(body) ? "source_stated" : "none",
    confidence: Math.round(confidence * 100) / 100,
    missing,
    parser_version: `${source.value}-${PARSER_VERSION}`,
  };
}

/** Converts a parse result into the payload accepted by the ingest_lead / create_lead RPCs. */
export function toIngestPayload(
  r: ParseResult,
  raw: string,
  extra: { event_type?: string; idempotency_key?: string; received_at?: string } = {},
): Record<string, unknown> {
  const f = r.fields;
  return {
    source_type: r.source.value,
    event_type: extra.event_type ?? "email",
    idempotency_key: extra.idempotency_key,
    raw,
    full_name: f.full_name.value,
    phone_e164: f.phone_e164.value,
    phone_original: f.phone_original.value,
    email: f.email.value,
    service: f.service.value,
    location: f.location.value,
    requirement: [f.service.value, f.location.value].filter(Boolean).join(" in ") || null,
    budget_minor: f.budget_minor.value,
    cost_minor: f.cost_minor.value,
    provider_lead_id: f.provider_lead_id.value,
    received_at: extra.received_at,
    confidence: r.confidence,
    shared_evidence: r.shared_evidence,
    parser_version: r.parser_version,
    touch_type: r.source.value === "referral" ? "referral" : ["meta_ads", "google_ads", "website"].includes(r.source.value) ? "form_submit" : "lead_notification",
  };
}
