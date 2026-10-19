import { describe, expect, it, vi } from "vitest";
import type { FinancialScore, FinancialScoreFactor } from "@/lib/financial-score";
import { NOW, tx } from "./test-fixtures";
import type { GapTransferTx } from "./gaps";
import type { ScoreGapAccount } from "./score-gaps";
import type { InsightTx } from "./types";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { detectScoreGaps, findTransferLikeEntries } = await import("./score-gaps");
const { detectRecurringCandidates } = await import("./recurring-detection");
const { moneyFormatter } = await import("./util");

const fmt = moneyFormatter();
const d = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
const MONTHS = ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"];

const factor = (id: FinancialScoreFactor["id"]): FinancialScoreFactor => ({
  id,
  label: id,
  score: 60,
  weight: 0.5,
  detail: "",
  suggestion: null,
});

const score = (factors: FinancialScoreFactor[] = [factor("savings")]): FinancialScore => ({
  status: "scored",
  score: 60,
  band: "Fair",
  months: MONTHS,
  factors,
  suggestions: [],
  omitted: [],
  cushion: null,
  otherCurrencyAccounts: [],
});

const chequing: ScoreGapAccount = { id: "chq", name: "Chequing", type: "CHEQUING", countsAsSavings: false, latest: { cents: 100_000, date: d("2026-09-20") } };
const savings: ScoreGapAccount = { id: "sav", name: "Savings", type: "SAVINGS", countsAsSavings: true, latest: { cents: 500_000, date: d("2026-09-20") } };
const visa: ScoreGapAccount = { id: "visa", name: "Visa", type: "CREDIT_CARD", countsAsSavings: false, latest: null };

function transfer(date: string, amountCents: number, accountId: string, transferAccountId: string | null, paired = false): GapTransferTx {
  return {
    ...tx(date, "Online transfer", amountCents, { type: "TRANSFER", accountId, categoryId: "cat-xfer", categoryName: "Transfers" }),
    transferAccountId,
    paired,
  };
}

const spend = (date: string, title: string, cents: number, accountId = "chq", extra: Partial<InsightTx> = {}) =>
  tx(date, title, cents, { accountId, ...extra });
const pay = (date: string, cents = 300_000, accountId = "chq") =>
  tx(date, "ACME PAYROLL", cents, { type: "INCOME", categoryId: "cat-pay", categoryName: "Salary", accountId });

function run(input: Partial<Parameters<typeof detectScoreGaps>[0]> = {}) {
  return detectScoreGaps({
    score: score(),
    txs: [],
    transfers: [],
    accounts: [chequing, savings, visa],
    candidates: [],
    now: NOW,
    fmt,
    ...input,
  });
}

const keys = (insights: ReturnType<typeof run>) => insights.map((i) => i.key.split(":").slice(0, 2).join(":"));

describe("detectScoreGaps", () => {
  it("says nothing without a score", () => {
    expect(
      run({ score: { status: "insufficient", reason: "no" }, accounts: [{ ...chequing, latest: null }], txs: [spend("2026-08-03", "Grocer", 5_000)] }),
    ).toEqual([]);
  });

  it("says nothing when everything the score reads is in order", () => {
    expect(run({ txs: [pay("2026-08-01"), spend("2026-08-03", "Grocer", 5_000)] })).toEqual([]);
  });

  describe("emergency fund balances", () => {
    it("flags a balance read before the account was last used", () => {
      const [gap] = run({
        accounts: [{ ...chequing, latest: { cents: 100_000, date: d("2026-06-30") } }, savings],
        txs: [spend("2026-08-20", "Grocer", 5_000)],
      });
      expect(gap).toMatchObject({ key: "gap:score-balance:chq@2026-06-30", section: "gap" });
      expect(gap.title).toBe("Your emergency fund reads an old balance for Chequing");
      expect(gap.body).toContain("Chequing's balance is from Jun 30");
    });

    it("leaves an old balance alone when nothing has happened in the account since", () => {
      expect(
        run({ accounts: [{ ...chequing, latest: { cents: 100_000, date: d("2026-06-30") } }], txs: [spend("2026-06-02", "Grocer", 5_000)] }),
      ).toEqual([]);
    });

    it("flags a used spending account with no balance, but not a card or an unused one", () => {
      const [gap] = run({
        accounts: [{ ...chequing, latest: null }, { ...savings, latest: null }, visa],
        txs: [spend("2026-08-20", "Grocer", 5_000), spend("2026-08-21", "Gas", 4_000, "visa")],
      });
      expect(gap.key).toBe("gap:score-balance:chq@none");
      expect(gap.body).toContain("Chequing has no balance at all");
      expect(gap.body).not.toContain("Savings");
    });
  });

  describe("bills that aren't set up", () => {
    const monthly = (title: string, cents: number) =>
      ["2026-04-05", "2026-05-05", "2026-06-05", "2026-07-05", "2026-08-05", "2026-09-05"].map((date) => spend(date, title, cents));

    it("sums the bills the app noticed and says the factor reads light", () => {
      const txs = [...monthly("Rogers Wireless", 8_500), ...monthly("Netflix", 1_799)];
      const candidates = detectRecurringCandidates(txs, [], NOW);
      expect(candidates.length).toBe(2);
      const [gap] = run({ score: score([factor("savings"), factor("bills")]), txs, candidates });
      expect(gap).toMatchObject({ key: "gap:score-bills", monthlyCents: 10_299 });
      expect(gap.title).toBe("2 bills aren't counted in your fixed bills");
      expect(gap.body).toContain("reads lighter than it is");
    });

    it("says the factor is missing altogether when no bills are set up", () => {
      const txs = monthly("Rogers Wireless", 8_500);
      const [gap] = run({ txs, candidates: detectRecurringCandidates(txs, [], NOW) });
      expect(gap.body).toContain("leaves fixed bills out altogether");
    });

    it("does not count a monthly card payment as a bill", () => {
      const txs = monthly("PAYMENT - THANK YOU", 120_000);
      const gaps = run({ txs, candidates: detectRecurringCandidates(txs, [], NOW) });
      expect(keys(gaps)).not.toContain("gap:score-bills");
    });
  });

  describe("transfers booked as spending or income", () => {
    it("finds card payments by their wording and Plaid's category", () => {
      const found = findTransferLikeEntries([
        spend("2026-08-02", "PAYMENT - THANK YOU", 80_000, "visa"),
        spend("2026-08-03", "Online banking", 40_000, "chq", { pfcDetailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" }),
        spend("2026-08-04", "Interac e-Transfer to Sam", 6_000),
        spend("2026-08-05", "Grocer", 6_000),
      ]);
      expect(found.map((t) => t.title)).toEqual(["PAYMENT - THANK YOU", "Online banking"]);
    });

    it("pairs an expense in one account with the same income in another", () => {
      const out = spend("2026-08-10", "Withdrawal", 25_000, "chq");
      const inc = tx("2026-08-11", "Deposit", 25_000, { type: "INCOME", accountId: "sav" });
      const sameAccount = tx("2026-08-11", "Deposit", 6_000, { type: "INCOME", accountId: "chq" });
      const found = findTransferLikeEntries([out, inc, sameAccount, spend("2026-08-12", "Grocer", 6_000)]);
      expect(found.map((t) => t.id)).toEqual([out.id, inc.id]);
    });

    it("never takes a refund for a transfer", () => {
      expect(findTransferLikeEntries([spend("2026-08-02", "Card payment refund", -3_000)])).toEqual([]);
    });

    it("raises one insight over the scored months only", () => {
      const gaps = run({
        txs: [
          spend("2026-08-02", "PAYMENT - THANK YOU", 80_000, "visa"),
          // The month in progress is not scored.
          spend("2026-09-02", "PAYMENT - THANK YOU", 80_000, "visa"),
        ],
      });
      expect(gaps).toHaveLength(1);
      expect(gaps[0].title).toBe("An entry looks like a transfer between your accounts");
      expect(gaps[0].body).toContain("$800 counted as spending");
      expect(gaps[0].action).toEqual({ kind: "link", href: "/?month=2026-08", label: "Open that month" });
    });
  });

  describe("savings the score can't see", () => {
    it("asks where unnamed transfers out of a spending account went", () => {
      const transfers = [transfer("2026-07-15", 30_000, "chq", null), transfer("2026-08-15", 30_000, "chq", null)];
      const [gap] = run({ transfers });
      expect(gap.key).toBe(`gap:score-transfer-to:${transfers[1].id}`);
      expect(gap.body).toContain("$600 left your accounts by transfer");
    });

    it("says nothing about transfers when no account counts as savings", () => {
      const transfers = [transfer("2026-07-15", 30_000, "chq", null)];
      expect(run({ transfers, accounts: [chequing, { ...savings, countsAsSavings: false }] })).toEqual([]);
    });

    it("leaves transfers that name their destination or are paired alone", () => {
      expect(
        run({ transfers: [transfer("2026-07-15", 30_000, "chq", "visa"), transfer("2026-07-16", 30_000, "chq", null, true)] }),
      ).toEqual([]);
    });

    it("flags an unmarked account money keeps moving into and is never spent from", () => {
      const tfsa: ScoreGapAccount = { id: "tfsa", name: "Wealthsimple", type: "CHEQUING", countsAsSavings: false, latest: null };
      const transfers = [
        transfer("2026-06-01", 20_000, "chq", "tfsa"),
        transfer("2026-07-01", 20_000, "chq", "tfsa"),
        transfer("2026-08-01", 20_000, "chq", "tfsa"),
      ];
      const [gap] = run({ transfers, accounts: [chequing, savings, tfsa] });
      expect(gap).toMatchObject({ key: "gap:score-savings-account:tfsa", monthlyCents: 10_000 });
      expect(gap.title).toBe("Money moved into Wealthsimple isn't counted as saved");

      // Spent from, it is an everyday account, not savings.
      const spentFrom = run({ transfers, accounts: [chequing, savings, tfsa], txs: [spend("2026-08-03", "Grocer", 5_000, "tfsa")] });
      expect(keys(spentFrom)).not.toContain("gap:score-savings-account");
    });

    it("does not take a credit card being paid off for savings", () => {
      const transfers = [transfer("2026-07-01", 50_000, "chq", "visa"), transfer("2026-08-01", 50_000, "chq", "visa")];
      expect(run({ transfers })).toEqual([]);
    });
  });
});
