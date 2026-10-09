import { describe, expect, it } from "vitest";
import {
  defaultCountsAsSavings,
  savedByTransferByMonth,
  savingsCentsFor,
  totalSavedByTransfer,
  type SavingsTransferTx,
} from "./savings-transfers";

const SAVINGS = new Set(["hisa", "tfsa"]);

function leg(date: string, accountId: string | null, transferAccountId: string | null, amountCents: number, paired = false): SavingsTransferTx {
  return { date: new Date(`${date}T00:00:00Z`), accountId, transferAccountId, amountCents, paired };
}

describe("savingsCentsFor", () => {
  it("counts a lone chequing leg sent to a savings account as saved", () => {
    expect(savingsCentsFor(leg("2026-09-01", "chq", "hisa", 50_000), SAVINGS)).toBe(50_000);
  });

  it("counts a lone savings leg by its own sign: in is saved, out is taken back", () => {
    expect(savingsCentsFor(leg("2026-09-01", "hisa", "chq", -50_000), SAVINGS)).toBe(50_000);
    expect(savingsCentsFor(leg("2026-09-01", "hisa", "chq", 20_000), SAVINGS)).toBe(-20_000);
    // The other side was never named; the money still arrived in savings.
    expect(savingsCentsFor(leg("2026-09-01", "tfsa", null, -10_000), SAVINGS)).toBe(10_000);
  });

  it("counts a paired transfer once, on the savings leg", () => {
    const out = leg("2026-09-01", "chq", "hisa", 50_000, true);
    const into = leg("2026-09-02", "hisa", "chq", -50_000, true);
    expect(totalSavedByTransfer([out, into], SAVINGS)).toBe(50_000);
  });

  it("ignores moves between two savings accounts and between two other accounts", () => {
    expect(savingsCentsFor(leg("2026-09-01", "hisa", "tfsa", 30_000), SAVINGS)).toBe(0);
    expect(savingsCentsFor(leg("2026-09-01", "tfsa", "hisa", -30_000), SAVINGS)).toBe(0);
    expect(savingsCentsFor(leg("2026-09-01", "chq", "visa", 30_000), SAVINGS)).toBe(0);
  });
});

describe("savedByTransferByMonth", () => {
  it("buckets by month, keeps quiet months, and drops months outside the list", () => {
    const byMonth = savedByTransferByMonth(
      [
        leg("2026-08-03", "chq", "hisa", 40_000),
        leg("2026-08-20", "hisa", "chq", 15_000),
        leg("2026-10-01", "chq", "tfsa", 99_000),
      ],
      SAVINGS,
      ["2026-08", "2026-09"],
    );
    expect([...byMonth]).toEqual([
      ["2026-08", 25_000],
      ["2026-09", 0],
    ]);
  });
});

describe("defaultCountsAsSavings", () => {
  it("starts savings and investment accounts marked, and spending accounts not", () => {
    expect(["SAVINGS", "TFSA", "RRSP", "FHSA", "NON_REGISTERED"].every(defaultCountsAsSavings)).toBe(true);
    expect(["CHEQUING", "CREDIT_CARD", "CASH"].some(defaultCountsAsSavings)).toBe(false);
  });
});
