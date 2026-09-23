import { describe, expect, it, vi } from "vitest";
import { PlaidRevocationError, revokePlaidItemsForUser } from "@/lib/plaid/unlink";

function db(items: Array<{ id: string; itemId: string; accessTokenEnc: string }>) {
  return { plaidItem: { findMany: vi.fn(async () => items) } } as never;
}

const item = (n: number) => ({ id: `row-${n}`, itemId: `item-${n}`, accessTokenEnc: "enc" });

describe("revokePlaidItemsForUser", () => {
  it("is a no-op for a user with no linked banks", async () => {
    const revoke = vi.fn();
    await expect(revokePlaidItemsForUser(db([]), "u1", revoke)).resolves.toEqual({ revoked: 0, rowIds: [] });
    expect(revoke).not.toHaveBeenCalled();
  });

  it("revokes every item and reports the count", async () => {
    const revoke = vi.fn(async () => {});
    await expect(revokePlaidItemsForUser(db([item(1), item(2)]), "u1", revoke)).resolves.toEqual({
      revoked: 2,
      rowIds: ["row-1", "row-2"],
    });
    expect(revoke).toHaveBeenCalledTimes(2);
  });

  it("refuses when there is no revoker but items exist", async () => {
    // The state this feature ships in before linking exists: nothing can create an item,
    // so this never fires — but if one somehow existed, deleting silently would strand it.
    await expect(revokePlaidItemsForUser(db([item(1)]), "u1")).rejects.toBeInstanceOf(
      PlaidRevocationError,
    );
  });

  it("refuses the whole operation if any single revocation fails", async () => {
    const revoke = vi.fn(async (i: { itemId: string }) => {
      if (i.itemId === "item-2") throw new Error("plaid down");
    });
    const err = await revokePlaidItemsForUser(db([item(1), item(2), item(3)]), "u1", revoke).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(PlaidRevocationError);
    // Names only the ones that actually failed, so an operator knows what to clean up.
    expect((err as PlaidRevocationError).itemIds).toEqual(["item-2"]);
    // Still attempts the rest rather than stopping at the first failure.
    expect(revoke).toHaveBeenCalledTimes(3);
  });
});
