export const RANGES = {
  "7d": { label: "Last 7 days", days: 7 },
  "30d": { label: "Last 30 days", days: 30 },
  "90d": { label: "Last 90 days", days: 90 },
  "365d": { label: "Last 12 months", days: 365 },
} as const;

export type RangeKey = keyof typeof RANGES;

export function resolveRange(key: string | undefined, fallback: RangeKey = "30d") {
  const k = (key && key in RANGES ? key : fallback) as RangeKey;
  const to = new Date();
  const from = new Date(to.getTime() - RANGES[k].days * 86400000);
  const prevFrom = new Date(from.getTime() - RANGES[k].days * 86400000);
  return { key: k, label: RANGES[k].label, from, to, prevFrom, prevTo: from };
}
