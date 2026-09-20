import { describe, expect, it } from "vitest";
import { describePlaidCostWarning } from "@/lib/plaid/cost";

const healthy = { status: "ACTIVE", consentExpiresAt: null, hasMappedAccount: true };

describe("describePlaidCostWarning", () => {
  it("says nothing about a connection that is working", () => {
    // A warning that fires on healthy connections is one people learn to ignore.
    expect(describePlaidCostWarning(healthy)).toBeNull();
  });

  it("flags a connection waiting on re-authentication", () => {
    const text = describePlaidCostWarning({ ...healthy, status: "LOGIN_REQUIRED" });
    expect(text).toContain("sign in again");
    expect(text).toContain("charges for every connected bank");
  });

  it("flags a failing connection", () => {
    expect(describePlaidCostWarning({ ...healthy, status: "ERROR" })).toContain("failing");
  });

  it("flags lapsed consent", () => {
    const text = describePlaidCostWarning({
      ...healthy,
      consentExpiresAt: new Date(Date.now() - 1000),
    });
    expect(text).toContain("expired");
  });

  it("does not flag consent that is still valid", () => {
    expect(
      describePlaidCostWarning({
        ...healthy,
        consentExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      }),
    ).toBeNull();
  });

  it("flags a bank connected but feeding nothing", () => {
    // The easiest one to end up paying for: connect a bank, never finish mapping it.
    const text = describePlaidCostWarning({ ...healthy, hasMappedAccount: false });
    expect(text).toContain("not fetching anything");
    expect(text).toContain("Map one below");
  });

  it("reports the more serious problem when several apply at once", () => {
    const text = describePlaidCostWarning({
      status: "LOGIN_REQUIRED",
      consentExpiresAt: new Date(Date.now() - 1000),
      hasMappedAccount: false,
    });
    expect(text).toContain("sign in again");
  });
});
