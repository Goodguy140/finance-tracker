import { describe, expect, it } from "vitest";
import {
  checkAccountSelectable,
  checkCurrencyCompatible,
  checkMappingAllowed,
  type MappingAccountSummary,
  type PlaidAccountSummary,
} from "@/lib/plaid/mapping";

const plaid = (overrides: Partial<PlaidAccountSummary> = {}): PlaidAccountSummary => ({
  id: "plaid-1",
  name: "Everyday Chequing",
  mask: "4321",
  currency: "CAD",
  ...overrides,
});

const app = (overrides: Partial<MappingAccountSummary> = {}): MappingAccountSummary => ({
  id: "acct-1",
  name: "Chequing",
  currency: "CAD",
  archived: false,
  ...overrides,
});

describe("checkCurrencyCompatible", () => {
  it("allows a matching currency", () => {
    expect(checkCurrencyCompatible(plaid(), app())).toEqual({ ok: true });
  });

  it("ignores case and surrounding whitespace on both sides", () => {
    expect(checkCurrencyCompatible(plaid({ currency: " cad " }), app({ currency: "CAD" }))).toEqual({
      ok: true,
    });
  });

  it("refuses a mismatch, because there is no FX layer to make it safe", () => {
    // Amounts are stored as bare cents against the account's own currency, so mixing
    // would add USD cents to CAD cents and corrupt every total downstream.
    const result = checkCurrencyCompatible(plaid({ currency: "USD" }), app({ currency: "CAD" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("USD");
    expect(result.reason).toContain("CAD");
    expect(result.reason).toContain("no currency conversion");
  });

  it("names the account with its mask so the right one is obvious", () => {
    const result = checkCurrencyCompatible(
      plaid({ currency: "USD", name: "Travel Card", mask: "9911" }),
      app({ name: "Everyday" }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("Travel Card ••9911");
    expect(result.reason).toContain("Everyday");
  });

  it("allows an account whose currency Plaid did not report", () => {
    // Unknown is not the same as mismatched; blocking on missing metadata would strand
    // legitimate accounts for no safety gain.
    expect(checkCurrencyCompatible(plaid({ currency: null }), app())).toEqual({ ok: true });
    expect(checkCurrencyCompatible(plaid({ currency: "  " }), app())).toEqual({ ok: true });
  });

  it("reads correctly when the Plaid account has no mask", () => {
    const result = checkCurrencyCompatible(
      plaid({ currency: "EUR", mask: null, name: "Savings" }),
      app(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("Savings is a EUR account");
    expect(result.reason).not.toContain("••");
  });
});

describe("checkAccountSelectable", () => {
  it("allows an active account", () => {
    expect(checkAccountSelectable(app())).toEqual({ ok: true });
  });

  it("refuses an archived one", () => {
    // Archived accounts are hidden from every picker, so synced rows would be stranded
    // somewhere the user cannot see them.
    const result = checkAccountSelectable(app({ archived: true, name: "Old Card" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("Old Card");
    expect(result.reason).toContain("archived");
  });
});

describe("checkMappingAllowed", () => {
  it("passes when everything is in order", () => {
    expect(checkMappingAllowed(plaid(), app())).toEqual({ ok: true });
  });

  it("reports the archived problem before the currency one", () => {
    // One clear reason beats a list, and the archived state is the easier thing to fix.
    const result = checkMappingAllowed(
      plaid({ currency: "USD" }),
      app({ archived: true, currency: "CAD" }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("archived");
    expect(result.reason).not.toContain("currency conversion");
  });

  it("catches the currency problem on an otherwise valid account", () => {
    const result = checkMappingAllowed(plaid({ currency: "USD" }), app({ currency: "CAD" }));
    expect(result.ok).toBe(false);
  });
});
