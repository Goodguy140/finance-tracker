import { PlaidStagedStatus } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  SPENT_STAGED_ROW_RETENTION_DAYS,
  pruneSpentStagedRows,
  purgePlaidAccountData,
  purgePlaidItemData,
} from "@/lib/plaid/purge";

const now = new Date("2026-09-24T12:00:00Z");
const item = { id: "row-1", userId: "u1" };

function fakeTx(account: { id: string } | null = { id: "acct-row-1" }) {
  return {
    transactionVerification: { updateMany: vi.fn(async () => ({ count: 1 })) },
    plaidStagedTransaction: { deleteMany: vi.fn(async () => ({ count: 3 })) },
    plaidAccount: {
      findFirst: vi.fn(async () => account),
      delete: vi.fn(async () => ({})),
      deleteMany: vi.fn(async () => ({ count: 1 })),
    },
    plaidItem: { delete: vi.fn(async () => ({})) },
  };
}

const scrubbed = { plaidTransactionId: null, plaidItemId: null, plaidAccountRowId: null };

describe("purgePlaidItemData", () => {
  it("keeps the verification but strips its Plaid ids, then deletes everything else", async () => {
    const tx = fakeTx();
    await purgePlaidItemData(tx as never, item, now);
    expect(tx.transactionVerification.updateMany).toHaveBeenCalledWith({
      where: { userId: "u1", plaidItemId: "row-1" },
      data: { itemRemovedAt: now, ...scrubbed },
    });
    expect(tx.plaidStagedTransaction.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1", plaidItemId: "row-1" } });
    expect(tx.plaidAccount.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1", plaidItemId: "row-1" } });
    expect(tx.plaidItem.delete).toHaveBeenCalledWith({ where: { id: "row-1" } });
  });
});

describe("purgePlaidAccountData", () => {
  it("purges only the named account and leaves the connection", async () => {
    const tx = fakeTx();
    await expect(purgePlaidAccountData(tx as never, item, "plaid-acct-1", now)).resolves.toBe(true);
    expect(tx.plaidAccount.findFirst).toHaveBeenCalledWith({
      where: { userId: "u1", plaidItemId: "row-1", plaidAccountId: "plaid-acct-1" },
      select: { id: true },
    });
    expect(tx.transactionVerification.updateMany).toHaveBeenCalledWith({
      where: { userId: "u1", plaidAccountRowId: "acct-row-1" },
      data: { itemRemovedAt: now, ...scrubbed },
    });
    expect(tx.plaidStagedTransaction.deleteMany).toHaveBeenCalledWith({
      where: { userId: "u1", plaidAccountRowId: "acct-row-1" },
    });
    expect(tx.plaidAccount.delete).toHaveBeenCalledWith({ where: { id: "acct-row-1" } });
    expect(tx.plaidItem.delete).not.toHaveBeenCalled();
  });

  it("does nothing for an account it does not hold", async () => {
    const tx = fakeTx(null);
    await expect(purgePlaidAccountData(tx as never, item, "nope", now)).resolves.toBe(false);
    expect(tx.transactionVerification.updateMany).not.toHaveBeenCalled();
    expect(tx.plaidStagedTransaction.deleteMany).not.toHaveBeenCalled();
  });
});

describe("pruneSpentStagedRows", () => {
  it("deletes only withdrawn and superseded rows past the grace period", async () => {
    const tx = fakeTx();
    await expect(pruneSpentStagedRows(tx as never, "row-1", now)).resolves.toBe(3);
    expect(tx.plaidStagedTransaction.deleteMany).toHaveBeenCalledWith({
      where: {
        plaidItemId: "row-1",
        status: { in: [PlaidStagedStatus.REMOVED_BY_PLAID, PlaidStagedStatus.SUPERSEDED] },
        updatedAt: { lt: new Date(now.getTime() - SPENT_STAGED_ROW_RETENTION_DAYS * 86_400_000) },
      },
    });
  });
});
