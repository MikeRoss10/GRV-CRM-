import { describe, expect, it } from "vitest";
import { deriveMetrics, totals, type EconRow } from "./metrics";
import { money, parseMoneyToMinor, maskPhone, pct } from "./format";

const row = (o: Partial<EconRow>): EconRow => ({
  source_account_id: o.display_name ?? "x", display_name: "X", source_type: "other", zero_cost: false,
  spend_minor: 0, spend_known: true, spend_has_allocated: false, cost_event_count: 1, response_cost_minor: 0,
  leads: 0, contacted: 0, qualified: 0, appointments: 0, wins: 0, revenue_minor: 0, gross_margin_minor: 0,
  duplicates_probable: 0, duplicates_confirmed: 0, shared_stated: 0, responded: 0, sla_met: 0,
  median_response_minutes: null, needs_review: 0, ...o,
});

describe("deriveMetrics", () => {
  it("keeps unknown costs unknown instead of zero", () => {
    const [m] = deriveMetrics([row({ display_name: "91acres", spend_known: false, spend_minor: null, cost_event_count: 0, leads: 10, wins: 1 })], { slaMinutes: 15 });
    expect(m.cac).toBeNull();
    expect(m.cpl).toBeNull();
    expect(m.decision).toBe("fix_costs");
  });

  it("returns null for zero denominators", () => {
    const [m] = deriveMetrics([row({ spend_minor: 100000, leads: 20, qualified: 0, wins: 0 })], { slaMinutes: 15 });
    expect(m.cpl).toBe(5000);
    expect(m.cpql).toBeNull();
    expect(m.cac).toBeNull();
    expect(m.decision).toBe("reduce");
  });

  it("recommends scaling the cheapest-win source and reducing the most expensive", () => {
    const rows = deriveMetrics(
      [
        row({ display_name: "Meta", spend_minor: 3_800_000, leads: 74, contacted: 60, qualified: 29, wins: 9, revenue_minor: 78_000_000 }),
        row({ display_name: "Google", spend_minor: 3_100_000, leads: 51, contacted: 40, qualified: 22, wins: 6, revenue_minor: 46_000_000 }),
        row({ display_name: "Justdial", spend_minor: 4_200_000, leads: 146, contacted: 80, qualified: 19, wins: 2, revenue_minor: 11_000_000 }),
      ],
      { slaMinutes: 15 },
    );
    expect(rows.find((r) => r.display_name === "Meta")!.decision).toBe("scale");
    expect(rows.find((r) => r.display_name === "Justdial")!.decision).toBe("reduce");
  });

  it("includes response cost in CAC but not CPL", () => {
    const [m] = deriveMetrics([row({ spend_minor: 100000, response_cost_minor: 20000, leads: 10, wins: 2 })], { slaMinutes: 15 });
    expect(m.cpl).toBe(10000);
    expect(m.cac).toBe(60000);
  });

  it("totals refuse a blended CAC when any source cost is unknown", () => {
    const t = totals(deriveMetrics([row({ spend_minor: 100000, leads: 10, wins: 2 }), row({ display_name: "U", spend_known: false, spend_minor: null, leads: 3 })], { slaMinutes: 15 }));
    expect(t.spend_complete).toBe(false);
    expect(t.unknown_sources).toEqual(["U"]);
    expect(t.cac).toBeNull();
  });
});

describe("format", () => {
  it("formats INR compactly", () => {
    expect(money(4_280_000, "INR", { compact: true })).toBe("₹42.8k");
    expect(money(78_000_000, "INR", { compact: true })).toBe("₹7.8L");
    expect(money(null)).toBe("—");
    expect(money(237800)).toBe("₹2,378");
  });
  it("parses Indian money shorthands", () => {
    expect(parseMoneyToMinor("₹1,050")).toBe(105000);
    expect(parseMoneyToMinor("1.2 Cr")).toBe(1_20_00_000 * 100);
    expect(parseMoneyToMinor("45 lakh")).toBe(45_00_000 * 100);
    expect(parseMoneyToMinor("abc")).toBeNull();
  });
  it("masks phones and shows dashes for empty rates", () => {
    expect(maskPhone("+919876543321")).toBe("+91 98••• ••321");
    expect(pct(1, 0)).toBe("—");
  });
});
