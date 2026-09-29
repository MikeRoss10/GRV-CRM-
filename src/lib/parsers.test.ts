import { describe, expect, it } from "vitest";
import { normalizePhone, parseLeadMessage, toIngestPayload } from "./parsers";

describe("normalizePhone", () => {
  it("normalizes Indian formats to E.164", () => {
    expect(normalizePhone("98765 43210").e164).toBe("+919876543210");
    expect(normalizePhone("+91-98765-43210").e164).toBe("+919876543210");
    expect(normalizePhone("09876543210").e164).toBe("+919876543210");
    expect(normalizePhone("919876543210").e164).toBe("+919876543210");
  });
  it("rejects masked and short numbers", () => {
    expect(normalizePhone("98xxxxxx321").e164).toBeNull();
    expect(normalizePhone("12345").e164).toBeNull();
    expect(normalizePhone("").e164).toBeNull();
  });
  it("keeps international numbers with a plus", () => {
    expect(normalizePhone("+44 7700 900123").e164).toBe("+447700900123");
  });
});

describe("parseLeadMessage", () => {
  it("parses a labelled Sulekha SMS", () => {
    const r = parseLeadMessage(
      "Sulekha lead\nCustomer: Anjali Sharma\nPhone: 9876543321\nRequirement: 2 BHK apartment\nLocation: Andheri\nBudget: 1.2 Cr\nLead price: ₹1050\nThis lead has also been sent to 3 other providers.",
    );
    expect(r.source.value).toBe("sulekha");
    expect(r.fields.full_name.value).toBe("Anjali Sharma");
    expect(r.fields.phone_e164.value).toBe("+919876543321");
    expect(r.fields.service.value).toBe("2 BHK apartment");
    expect(r.fields.location.value).toBe("Andheri");
    expect(r.fields.budget_minor.value).toBe(1_20_00_000 * 100);
    expect(r.fields.cost_minor.value).toBe(105000);
    expect(r.shared_evidence).toBe("source_stated");
    expect(r.confidence).toBeGreaterThanOrEqual(0.9);
    expect(r.missing).toContain("provider_lead_id");
  });

  it("parses a free-text Justdial notification", () => {
    const r = parseLeadMessage("Justdial: Rahul Mehta enquired for Office space in Powai. Call 98200 11223 now.");
    expect(r.source.value).toBe("justdial");
    expect(r.fields.full_name.value).toBe("Rahul Mehta");
    expect(r.fields.phone_e164.value).toBe("+919820011223");
    expect(r.fields.service.value).toBe("Office space");
    expect(r.fields.location.value).toBe("Powai");
    expect(r.fields.phone_e164.confidence).toBeLessThan(0.9);
  });

  it("does not claim shared leads without source wording", () => {
    const r = parseLeadMessage("91acres enquiry\nName: Kavita Rao\nMobile: 9123456789\nProperty type: Villa");
    expect(r.source.value).toBe("91acres");
    expect(r.shared_evidence).toBe("none");
  });

  it("routes a lead with a masked phone to review", () => {
    const r = parseLeadMessage("Sulekha\nName: Test\nPhone: 98xxxxxx321");
    expect(r.fields.phone_e164.value).toBeNull();
    expect(r.confidence).toBe(0);
    expect(toIngestPayload(r, "raw").phone_e164).toBeNull();
  });

  it("never records a zero source cost", () => {
    const r = parseLeadMessage("Sulekha\nName: A B\nPhone: 9876543210\nLead price: 0");
    expect(r.fields.cost_minor.value).toBeNull();
  });

  it("respects a source hint", () => {
    const r = parseLeadMessage("Name: A B\nPhone: 9876543210", { sourceHint: "referral" });
    expect(r.source.value).toBe("referral");
    expect(toIngestPayload(r, "x").touch_type).toBe("referral");
  });
});
