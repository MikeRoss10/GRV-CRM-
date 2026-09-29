import { describe, expect, it } from "vitest";
import { evaluatePolicy, type PolicyInput } from "./policy";

const base = (o: Partial<PolicyInput> = {}): PolicyInput => ({
  channel: "voice",
  now: new Date("2026-09-29T06:30:00Z"), // 12:00 IST
  contact: { do_not_contact: false, phone_e164: "+919876543210" },
  opportunity: { status: "new", parser_confidence: 0.96, received_at: "2026-09-29T06:28:00Z" },
  consents: [{ channel: "voice", basis_type: "customer_inquiry", captured_at: "2026-09-29T06:28:00Z", expires_at: null, revoked_at: null, purpose: "Respond to enquiry" }],
  workspace: { timezone: "Asia/Kolkata", call_window_start: "10:00", call_window_end: "19:00" },
  ...o,
});

describe("evaluatePolicy", () => {
  it("allows a human call for a fresh enquiry inside hours", () => {
    expect(evaluatePolicy(base()).allowed).toBe(true);
  });
  it("blocks suppressed contacts", () => {
    const r = evaluatePolicy(base({ contact: { do_not_contact: true, phone_e164: "+919876543210" } }));
    expect(r.allowed).toBe(false);
    expect(r.checks.find((c) => c.key === "suppression")!.ok).toBe(false);
  });
  it("blocks low-confidence phones", () => {
    const r = evaluatePolicy(base({ opportunity: { status: "new", parser_confidence: 0.6, received_at: "" } }));
    expect(r.checks.find((c) => c.key === "phone")!.ok).toBe(false);
  });
  it("blocks outside the allowed window", () => {
    const r = evaluatePolicy(base({ now: new Date("2026-09-29T16:00:00Z") })); // 21:30 IST
    expect(r.checks.find((c) => c.key === "window")!.ok).toBe(false);
  });
  it("blocks expired or revoked basis", () => {
    const r = evaluatePolicy(base({ consents: [{ channel: "voice", basis_type: "customer_inquiry", captured_at: "", expires_at: "2026-01-01T00:00:00Z", revoked_at: null, purpose: "x" }] }));
    expect(r.checks.find((c) => c.key === "basis")!.ok).toBe(false);
  });
  it("requires an enabled, approved AI policy with a compliant provider", () => {
    const r = evaluatePolicy(base({ ai: true, callPolicy: { enabled: false, provider: null, provider_compliance_complete: false, approved_at: null, script_name: "v1" } }));
    expect(r.allowed).toBe(false);
    expect(r.checks.filter((c) => !c.ok).map((c) => c.key)).toEqual(["policy", "provider", "script"]);
  });
});
