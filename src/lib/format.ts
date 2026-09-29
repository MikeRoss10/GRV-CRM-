/** Formatting helpers. Money is always integer minor units (paise for INR). */

const CURRENCY_SYMBOL: Record<string, string> = { INR: "₹", USD: "$", EUR: "€", GBP: "£", AED: "AED " };

export function money(minor: number | null | undefined, currency = "INR", opts: { compact?: boolean } = {}): string {
  if (minor === null || minor === undefined || Number.isNaN(minor)) return "—";
  const major = minor / 100;
  const sym = CURRENCY_SYMBOL[currency] ?? `${currency} `;
  if (opts.compact) {
    const abs = Math.abs(major);
    if (currency === "INR") {
      if (abs >= 1e7) return `${sym}${trim(major / 1e7)}Cr`;
      if (abs >= 1e5) return `${sym}${trim(major / 1e5)}L`;
      if (abs >= 1e3) return `${sym}${trim(major / 1e3)}k`;
    } else {
      if (abs >= 1e6) return `${sym}${trim(major / 1e6)}M`;
      if (abs >= 1e3) return `${sym}${trim(major / 1e3)}k`;
    }
  }
  const locale = currency === "INR" ? "en-IN" : "en-US";
  return `${sym}${Math.round(major).toLocaleString(locale)}`;
}

function trim(n: number): string {
  return n >= 100 ? Math.round(n).toString() : n.toFixed(1).replace(/\.0$/, "");
}

export function pct(numerator: number, denominator: number): string {
  if (!denominator) return "—";
  return `${Math.round((numerator / denominator) * 100)}%`;
}

export function num(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("en-IN");
}

/** Masks a phone number for list views: +91 98••• ••321 */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return "No phone";
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 6) return "•••";
  const cc = phone.startsWith("+91") ? "+91 " : phone.startsWith("+") ? `+${digits.slice(0, digits.length - 10)} ` : "";
  const local = digits.slice(-10);
  return `${cc}${local.slice(0, 2)}••• ••${local.slice(-3)}`;
}

export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return "No phone";
  const m = phone.match(/^\+91(\d{5})(\d{5})$/);
  return m ? `+91 ${m[1]} ${m[2]}` : phone;
}

export function minutes(m: number | null | undefined): string {
  if (m === null || m === undefined) return "—";
  if (m < 1) return "<1 min";
  if (m < 60) return `${Math.round(m)} min`;
  const h = m / 60;
  if (h < 24) return `${trim(h)} h`;
  return `${trim(h / 24)} d`;
}

export function ago(iso: string | Date | null | undefined, now = new Date()): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const diff = (now.getTime() - d.getTime()) / 60000;
  if (diff < 0) return `in ${minutes(-diff)}`;
  if (diff < 1) return "just now";
  if (diff < 60) return `${Math.round(diff)}m`;
  if (diff < 1440) return `${Math.round(diff / 60)}h`;
  return `${Math.round(diff / 1440)}d`;
}

export function dateTime(iso: string | null | undefined, tz = "Asia/Kolkata"): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: tz,
  }).format(new Date(iso));
}

export function dateOnly(iso: string | null | undefined, tz = "Asia/Kolkata"): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: tz }).format(new Date(iso));
}

export function humanize(s: string | null | undefined): string {
  if (!s) return "—";
  const t = s.replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Parses "1,050" / "1050.50" / "₹1.2L" into minor units. Returns null when unclear. */
export function parseMoneyToMinor(input: string): number | null {
  const s = input.replace(/[,\s₹]|rs\.?|inr/gi, "").toLowerCase();
  const m = s.match(/^(\d+(?:\.\d+)?)(k|l|lac|lakh|lakhs|cr|crore|crores)?$/);
  if (!m) return null;
  const mult: Record<string, number> = { k: 1e3, l: 1e5, lac: 1e5, lakh: 1e5, lakhs: 1e5, cr: 1e7, crore: 1e7, crores: 1e7 };
  return Math.round(parseFloat(m[1]) * (m[2] ? mult[m[2]] : 1) * 100);
}
