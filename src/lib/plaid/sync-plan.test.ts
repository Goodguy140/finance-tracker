import { CategoryKind, PlaidStagedStatus, TransactionType } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  keepChangedRevisions,
  markChangedTransfers,
  planPage,
  referencedPlaidTransactionIds,
  type ExistingStagedRow,
  type SyncItemContext,
} from "@/lib/plaid/sync-plan";
import type { PlaidApiTransaction, PlaidSyncPage } from "@/lib/plaid/types";

const CUTOFF = new Date(Date.UTC(2026, 5, 1));

function context(overrides: Partial<SyncItemContext> = {}): SyncItemContext {
  return {
    historyCutoff: CUTOFF,
    accounts: new Map([
      ["plaid-acct-1", { rowId: "row-1", accountId: "app-acct-1", syncEnabled: true }],
      ["plaid-acct-unmapped", { rowId: "row-2", accountId: null, syncEnabled: true }],
      ["plaid-acct-off", { rowId: "row-3", accountId: "app-acct-2", syncEnabled: false }],
    ]),
    categories: [
      { id: "cat-dining", name: "Dining", kind: CategoryKind.EXPENSE },
      { id: "cat-salary", name: "Salary", kind: CategoryKind.INCOME },
    ],
    budgetNames: [],
    itemDefaultCategoryId: null,
    fallbackCategoryId: {
      [CategoryKind.EXPENSE]: "cat-uncat-expense",
      [CategoryKind.INCOME]: "cat-uncat-income",
      [CategoryKind.TRANSFER]: "cat-transfer",
    },
    ...overrides,
  };
}

function txn(overrides: Partial<PlaidApiTransaction> = {}): PlaidApiTransaction {
  return {
    transaction_id: "ptx-1",
    account_id: "plaid-acct-1",
    amount: 12.5,
    iso_currency_code: "CAD",
    date: "2026-09-10",
    name: "COFFEE",
    pending: false,
    ...overrides,
  };
}

function page(overrides: Partial<PlaidSyncPage> = {}): PlaidSyncPage {
  return {
    added: [],
    modified: [],
    removed: [],
    next_cursor: "cursor-2",
    has_more: false,
    accounts: [],
    ...overrides,
  };
}

const existingMap = (rows: ExistingStagedRow[]) =>
  new Map(rows.map((r) => [r.plaidTransactionId, r]));

describe("referencedPlaidTransactionIds", () => {
  it("collects ids from added, modified, removed and pending links", () => {
    const ids = referencedPlaidTransactionIds(
      page({
        added: [txn({ transaction_id: "a", pending_transaction_id: "p" })],
        modified: [txn({ transaction_id: "m" })],
        removed: [{ transaction_id: "r" }],
      }),
    );
    expect(new Set(ids)).toEqual(new Set(["a", "p", "m", "r"]));
  });
});

describe("planPage: staging", () => {
  it("stages a mapped transaction with a suggested category", () => {
    const plan = planPage(
      page({
        added: [
          txn({ personal_finance_category: { primary: "FOOD_AND_DRINK", detailed: null } }),
        ],
      }),
      context(),
      existingMap([]),
    );
    expect(plan.upserts).toHaveLength(1);
    expect(plan.upserts[0]).toMatchObject({
      plaidTransactionId: "ptx-1",
      plaidAccountRowId: "row-1",
      suggestedAccountId: "app-acct-1",
      suggestedCategoryId: "cat-dining",
      type: TransactionType.EXPENSE,
      amountCents: 1250,
    });
    expect(plan.nextCursor).toBe("cursor-2");
  });

  it("stages a card payment as a transfer in the transfer category", () => {
    const plan = planPage(
      page({
        added: [
          txn({
            amount: 400,
            personal_finance_category: { primary: "LOAN_PAYMENTS", detailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" },
          }),
          txn({
            transaction_id: "ptx-2",
            amount: -400,
            personal_finance_category: { primary: "TRANSFER_IN", detailed: "TRANSFER_IN_ACCOUNT_TRANSFER" },
          }),
        ],
      }),
      context(),
      existingMap([]),
    );
    expect(plan.upserts.map((u) => [u.type, u.amountCents, u.suggestedCategoryId])).toEqual([
      [TransactionType.TRANSFER, 40000, "cat-transfer"],
      [TransactionType.TRANSFER, -40000, "cat-transfer"],
    ]);
  });

  it("skips accounts the user has not mapped, and ones they switched off", () => {
    // Not an error: there is simply nowhere to put them yet.
    const plan = planPage(
      page({
        added: [
          txn({ transaction_id: "a", account_id: "plaid-acct-unmapped" }),
          txn({ transaction_id: "b", account_id: "plaid-acct-off" }),
          txn({ transaction_id: "c", account_id: "plaid-acct-unknown" }),
        ],
      }),
      context(),
      existingMap([]),
    );
    expect(plan.upserts).toHaveLength(0);
    expect(plan.skipped.unmapped).toBe(3);
  });

  it("drops transactions older than the history window", () => {
    const plan = planPage(
      page({ added: [txn({ date: "2026-05-31" })] }),
      context(),
      existingMap([]),
    );
    expect(plan.upserts).toHaveLength(0);
    expect(plan.skipped.beforeCutoff).toBe(1);
  });

  it("records the oldest date the bank returned, including rows it then dropped", () => {
    // `earliestObservedAt` must describe what the institution holds, not what survived
    // our own filtering — otherwise the shortfall message would never fire.
    const plan = planPage(
      page({
        added: [txn({ transaction_id: "old", date: "2025-01-05" }), txn({ date: "2026-09-10" })],
      }),
      context(),
      existingMap([]),
    );
    expect(plan.earliestSeen?.toISOString().slice(0, 10)).toBe("2025-01-05");
    expect(plan.skipped.beforeCutoff).toBe(1);
  });

  it("counts zero-amount and oversized rows separately", () => {
    const plan = planPage(
      page({
        added: [
          txn({ transaction_id: "z", amount: 0 }),
          txn({ transaction_id: "big", amount: 99_999_999 }),
        ],
      }),
      context(),
      existingMap([]),
    );
    expect(plan.skipped.zero).toBe(1);
    expect(plan.skipped.outOfRange).toBe(1);
  });
});

describe("planPage: pending becomes posted", () => {
  const posted = () =>
    txn({ transaction_id: "ptx-posted", pending_transaction_id: "ptx-pending", pending: false });

  it("replaces an unreviewed pending row", () => {
    const plan = planPage(
      page({ added: [posted()] }),
      context(),
      existingMap([
        {
          plaidTransactionId: "ptx-pending",
          status: PlaidStagedStatus.NEEDS_REVIEW,
          resolvedTransactionId: null,
        },
      ]),
    );
    expect(plan.upserts[0].plaidTransactionId).toBe("ptx-posted");
    expect(plan.upserts[0].status).toBeUndefined();
    expect(plan.supersede).toEqual(["ptx-pending"]);
  });

  it("keeps an ignored pending row ignored once it posts", () => {
    // The most irritating way to get this wrong: every dismissed pending charge coming
    // back a day later as a brand-new suggestion.
    const plan = planPage(
      page({ added: [posted()] }),
      context(),
      existingMap([
        {
          plaidTransactionId: "ptx-pending",
          status: PlaidStagedStatus.IGNORED,
          resolvedTransactionId: null,
        },
      ]),
    );
    expect(plan.upserts[0].status).toBe(PlaidStagedStatus.IGNORED);
    expect(plan.supersede).toEqual(["ptx-pending"]);
  });

  it("carries a committed decision across, and moves the verification", () => {
    for (const status of [PlaidStagedStatus.LINKED, PlaidStagedStatus.ADDED]) {
      const plan = planPage(
        page({ added: [posted()] }),
        context(),
        existingMap([
          { plaidTransactionId: "ptx-pending", status, resolvedTransactionId: "txn-abc" },
        ]),
      );
      expect(plan.upserts[0].status).toBe(status);
      expect(plan.transfers).toHaveLength(1);
      expect(plan.transfers[0]).toMatchObject({
        fromPlaidTransactionId: "ptx-pending",
        toPlaidTransactionId: "ptx-posted",
        transactionId: "txn-abc",
      });
    }
  });

  it("carries the resolved transaction onto the posted row", () => {
    // Without this the posted row is LINKED but points at nothing, so a later revision to
    // it can be neither shown nor applied — silently losing exactly the tip-posting case
    // the transfer machinery exists for.
    const plan = planPage(
      page({ added: [posted()] }),
      context(),
      existingMap([
        {
          plaidTransactionId: "ptx-pending",
          status: PlaidStagedStatus.LINKED,
          resolvedTransactionId: "txn-abc",
        },
      ]),
    );
    expect(plan.upserts[0].resolvedTransactionId).toBe("txn-abc");
  });

  it("leaves resolvedTransactionId unset for a row nobody has acted on", () => {
    const plan = planPage(
      page({ added: [posted()] }),
      context(),
      existingMap([
        {
          plaidTransactionId: "ptx-pending",
          status: PlaidStagedStatus.NEEDS_REVIEW,
          resolvedTransactionId: null,
        },
      ]),
    );
    expect(plan.upserts[0].resolvedTransactionId).toBeUndefined();
  });

  it("stages normally when the pending row is unknown to us", () => {
    const plan = planPage(page({ added: [posted()] }), context(), existingMap([]));
    expect(plan.upserts).toHaveLength(1);
    expect(plan.supersede).toEqual([]);
    expect(plan.transfers).toEqual([]);
  });

  it("does not resurrect a row the user ignored, even without a pending link", () => {
    const plan = planPage(
      page({ added: [txn({ transaction_id: "ptx-1" })] }),
      context(),
      existingMap([
        {
          plaidTransactionId: "ptx-1",
          status: PlaidStagedStatus.IGNORED,
          resolvedTransactionId: null,
        },
      ]),
    );
    expect(plan.upserts[0].status).toBe(PlaidStagedStatus.IGNORED);
  });
});

describe("planPage: modifications", () => {
  it("updates an unreviewed row in place", () => {
    const plan = planPage(
      page({ modified: [txn({ amount: 20 })] }),
      context(),
      existingMap([
        {
          plaidTransactionId: "ptx-1",
          status: PlaidStagedStatus.NEEDS_REVIEW,
          resolvedTransactionId: null,
        },
      ]),
    );
    expect(plan.upserts[0].amountCents).toBe(2000);
    expect(plan.flagRevised).toEqual([]);
  });

  it("flags a revision to a committed row without touching the transaction", () => {
    // Silently rewriting a committed financial record is exactly what per-row review
    // exists to prevent, so this only updates the staged copy and raises a flag.
    const plan = planPage(
      page({ modified: [txn({ amount: 20 })] }),
      context(),
      existingMap([
        {
          plaidTransactionId: "ptx-1",
          status: PlaidStagedStatus.ADDED,
          resolvedTransactionId: "txn-abc",
        },
      ]),
    );
    expect(plan.flagRevised).toEqual([{ plaidTransactionId: "ptx-1", transactionId: "txn-abc" }]);
    expect(plan.upserts[0].amountCents).toBe(2000);
  });

  it("keeps an ignored row ignored when the bank revises it", () => {
    const plan = planPage(
      page({ modified: [txn({ amount: 20 })] }),
      context(),
      existingMap([
        {
          plaidTransactionId: "ptx-1",
          status: PlaidStagedStatus.IGNORED,
          resolvedTransactionId: null,
        },
      ]),
    );
    expect(plan.upserts[0].status).toBe(PlaidStagedStatus.IGNORED);
    expect(plan.flagRevised).toEqual([]);
  });
});

describe("planPage: removals", () => {
  it("hides an unreviewed row the bank withdrew", () => {
    const plan = planPage(
      page({ removed: [{ transaction_id: "ptx-1" }] }),
      context(),
      existingMap([
        {
          plaidTransactionId: "ptx-1",
          status: PlaidStagedStatus.NEEDS_REVIEW,
          resolvedTransactionId: null,
        },
      ]),
    );
    expect(plan.markRemoved).toEqual(["ptx-1"]);
    expect(plan.flagRemovedOnVerification).toEqual([]);
  });

  it("never deletes a committed transaction — only flags the badge", () => {
    const plan = planPage(
      page({ removed: [{ transaction_id: "ptx-1" }] }),
      context(),
      existingMap([
        {
          plaidTransactionId: "ptx-1",
          status: PlaidStagedStatus.LINKED,
          resolvedTransactionId: "txn-abc",
        },
      ]),
    );
    expect(plan.flagRemovedOnVerification).toEqual(["ptx-1"]);
    expect(plan.markRemoved).toEqual([]);
  });

  it("ignores a removal for a row already superseded", () => {
    // Banks routinely withdraw a pending row right after its posted successor lands.
    const plan = planPage(
      page({ removed: [{ transaction_id: "ptx-pending" }] }),
      context(),
      existingMap([
        {
          plaidTransactionId: "ptx-pending",
          status: PlaidStagedStatus.SUPERSEDED,
          resolvedTransactionId: null,
        },
      ]),
    );
    expect(plan.markRemoved).toEqual([]);
    expect(plan.flagRemovedOnVerification).toEqual([]);
  });

  it("ignores a removal for something never staged", () => {
    const plan = planPage(
      page({ removed: [{ transaction_id: "unknown" }] }),
      context(),
      existingMap([]),
    );
    expect(plan.markRemoved).toEqual([]);
  });
});

describe("markChangedTransfers", () => {
  it("flags a posted amount that differs from what was approved", () => {
    // The tip case: approved $47.00, posted $54.20.
    const plan = planPage(
      page({
        added: [
          txn({
            transaction_id: "ptx-posted",
            pending_transaction_id: "ptx-pending",
            amount: 54.2,
          }),
        ],
      }),
      context(),
      existingMap([
        {
          plaidTransactionId: "ptx-pending",
          status: PlaidStagedStatus.LINKED,
          resolvedTransactionId: "txn-abc",
        },
      ]),
    );
    const marked = markChangedTransfers(plan, new Map([["txn-abc", 4700]]));
    expect(marked.transfers[0].amountChanged).toBe(true);
  });

  it("leaves an unchanged amount alone", () => {
    const plan = planPage(
      page({
        added: [
          txn({ transaction_id: "ptx-posted", pending_transaction_id: "ptx-pending", amount: 47 }),
        ],
      }),
      context(),
      existingMap([
        {
          plaidTransactionId: "ptx-pending",
          status: PlaidStagedStatus.ADDED,
          resolvedTransactionId: "txn-abc",
        },
      ]),
    );
    const marked = markChangedTransfers(plan, new Map([["txn-abc", 4700]]));
    expect(marked.transfers[0].amountChanged).toBe(false);
  });
});

describe("keepChangedRevisions", () => {
  const revisedPlan = (amount: number) =>
    planPage(
      page({ modified: [txn({ amount })] }),
      context(),
      existingMap([
        {
          plaidTransactionId: "ptx-1",
          status: PlaidStagedStatus.LINKED,
          resolvedTransactionId: "txn-abc",
        },
      ]),
    );

  it("drops a revision whose amount still equals the user's transaction", () => {
    // A renamed or re-categorised row: nothing to choose between.
    const kept = keepChangedRevisions(revisedPlan(12.5), new Map([["txn-abc", 1250]]));
    expect(kept.flagRevised).toEqual([]);
    // The staged copy still takes the bank's new values.
    expect(kept.upserts).toHaveLength(1);
  });

  it("keeps a revision whose amount differs", () => {
    const kept = keepChangedRevisions(revisedPlan(20), new Map([["txn-abc", 1250]]));
    expect(kept.flagRevised).toEqual([{ plaidTransactionId: "ptx-1", transactionId: "txn-abc" }]);
  });

  it("compares as money out, so income the user booked as a transfer is not re-asked", () => {
    // Bank: $500 deposit (staged as income, +50000). The user booked it as a transfer, which
    // stores the same money as -50000; loadApprovedAmounts reports that as money out.
    const plan = planPage(
      page({ modified: [txn({ amount: -500, personal_finance_category: { primary: "INCOME", detailed: null } })] }),
      context(),
      existingMap([{ plaidTransactionId: "ptx-1", status: PlaidStagedStatus.ADDED, resolvedTransactionId: "txn-abc" }]),
    );
    expect(plan.upserts[0]).toMatchObject({ type: TransactionType.INCOME, amountCents: 50000 });
    expect(keepChangedRevisions(plan, new Map([["txn-abc", -50000]])).flagRevised).toEqual([]);
    expect(keepChangedRevisions(plan, new Map([["txn-abc", 50000]])).flagRevised).toHaveLength(1);
  });

  it("keeps a revision when the user's amount is unknown", () => {
    const kept = keepChangedRevisions(revisedPlan(12.5), new Map());
    expect(kept.flagRevised).toHaveLength(1);
  });
});

describe("planPage: the user's Plaid category mappings", () => {
  it("suggests the category the user mapped Plaid's detailed category to", () => {
    const ctx = context({
      categories: [
        { id: "cat-dining", name: "Dining", kind: CategoryKind.EXPENSE },
        { id: "cat-groceries", name: "Groceries", kind: CategoryKind.EXPENSE },
      ],
      plaidMappings: [{ plaidCategory: "FOOD_AND_DRINK_GROCERIES", categoryId: "cat-groceries" }],
    });
    const plan = planPage(
      page({
        added: [
          txn({ transaction_id: "g", personal_finance_category: { primary: "FOOD_AND_DRINK", detailed: "FOOD_AND_DRINK_GROCERIES" } }),
          txn({ transaction_id: "r", personal_finance_category: { primary: "FOOD_AND_DRINK", detailed: "FOOD_AND_DRINK_RESTAURANT" } }),
        ],
      }),
      ctx,
      new Map(),
    );
    const byId = new Map(plan.upserts.map((u) => [u.plaidTransactionId, u.suggestedCategoryId]));
    expect(byId.get("g")).toBe("cat-groceries");
    expect(byId.get("r")).toBe("cat-dining");
  });
});
