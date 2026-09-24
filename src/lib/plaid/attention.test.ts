import { describe, expect, it } from "vitest";
import { describePlaidItemAttention, type PlaidAttentionInput } from "@/lib/plaid/attention";

const healthy: PlaidAttentionInput = {
  institutionName: "Test Credit Union",
  status: "ACTIVE",
  consentExpiresAt: null,
  pendingExpirationAt: null,
  pendingDisconnectAt: null,
  pendingDisconnectReason: null,
  newAccountsAvailableAt: null,
};
const at = new Date("2026-09-24T12:00:00Z");

describe("describePlaidItemAttention", () => {
  it("is null for a healthy connection", () => {
    expect(describePlaidItemAttention(healthy)).toBeNull();
  });

  it("offers the matching update-mode flow for each state", () => {
    expect(describePlaidItemAttention({ ...healthy, status: "LOGIN_REQUIRED" })).toMatchObject({
      kind: "reauth",
      action: "reauth",
      actionLabel: "Sign in again",
    });
    expect(describePlaidItemAttention({ ...healthy, pendingDisconnectAt: at })).toMatchObject({
      kind: "disconnecting",
      action: "reauth",
    });
    expect(
      describePlaidItemAttention({ ...healthy, pendingExpirationAt: at, consentExpiresAt: new Date("2026-10-01T00:00:00Z") })?.message,
    ).toMatch(/expires on .*2026/);
    expect(describePlaidItemAttention({ ...healthy, newAccountsAvailableAt: at })).toMatchObject({
      kind: "new-accounts",
      action: "accounts",
      actionLabel: "Add new accounts",
    });
  });

  it("surfaces only the most urgent one", () => {
    const everything = {
      ...healthy,
      status: "LOGIN_REQUIRED",
      pendingDisconnectAt: at,
      pendingExpirationAt: at,
      newAccountsAvailableAt: at,
    };
    expect(describePlaidItemAttention(everything)?.kind).toBe("reauth");
    expect(describePlaidItemAttention({ ...everything, status: "ACTIVE" })?.kind).toBe("disconnecting");
    expect(
      describePlaidItemAttention({ ...everything, status: "ACTIVE", pendingDisconnectAt: null })?.kind,
    ).toBe("expiring");
  });
});
