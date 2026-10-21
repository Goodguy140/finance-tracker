import { describe, expect, it, vi } from "vitest";
import type { PlaidClient } from "@/lib/plaid/client";

const recordAuditLog = vi.fn(async () => {});
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/audit-log", async () => {
  const actual = await vi.importActual<typeof import("@/lib/audit-log")>("@/lib/audit-log");
  return { ...actual, recordAuditLog };
});

const { AUDIT_ACTIONS } = await import("@/lib/audit-log");
const { makePlaidItemRevoker } = await import("@/lib/plaid/service");

describe("makePlaidItemRevoker", () => {
  it("records Plaid's item id when a token it cannot read means the item was not revoked", async () => {
    const removeItem = vi.fn();
    const revoke = makePlaidItemRevoker({ removeItem } as unknown as PlaidClient);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    // Not ciphertext this server can open: what a rotated encryption key looks like.
    await revoke({ id: "row-1", itemId: "plaid-item-1", accessTokenEnc: "not-a-sealed-token" });

    // Still lets the deletion go ahead, as before, but no longer silently.
    expect(removeItem).not.toHaveBeenCalled();
    expect(recordAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: AUDIT_ACTIONS.plaid_item_revoke_skipped,
        targetId: "plaid-item-1",
        metadata: expect.objectContaining({ plaidItemId: "plaid-item-1" }),
      }),
    );
    expect(error).toHaveBeenCalledWith(expect.stringContaining("plaid-item-1"));
    error.mockRestore();
  });
});
