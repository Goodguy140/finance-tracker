import { PlaidItemStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/audit-log", async () => {
  const actual = await vi.importActual<typeof import("@/lib/audit-log")>("@/lib/audit-log");
  return { ...actual, recordAuditLog: vi.fn(async () => {}) };
});
vi.mock("@/lib/plaid/service", () => ({ openAccessToken: vi.fn(() => "access-token") }));

const { recordAuditLog, AUDIT_ACTIONS } = await import("@/lib/audit-log");
const { applyPlaidWebhook, ensurePlaidItemWebhook, planPlaidWebhook } = await import("@/lib/plaid/webhooks");

const now = new Date("2026-09-24T12:00:00Z");

describe("planPlaidWebhook", () => {
  it("flags sign-in required from an ITEM ERROR", () => {
    const plan = planPlaidWebhook(
      {
        webhook_type: "ITEM",
        webhook_code: "ERROR",
        error: { error_code: "ITEM_LOGIN_REQUIRED", display_message: "Sign in to Chase again." },
      },
      now,
    );
    expect(plan?.code).toBe("ITEM_LOGIN_REQUIRED");
    expect(plan?.data).toMatchObject({
      status: PlaidItemStatus.LOGIN_REQUIRED,
      errorCode: "ITEM_LOGIN_REQUIRED",
      errorMessage: "Sign in to Chase again.",
    });
    expect(plan?.auditAction).toBe(AUDIT_ACTIONS.plaid_item_reauth_required);
  });

  it("records other item errors without changing the status", () => {
    const plan = planPlaidWebhook(
      { webhook_type: "ITEM", webhook_code: "ERROR", error: { error_code: "INSTITUTION_DOWN" } },
      now,
    );
    expect(plan?.data).not.toHaveProperty("status");
    expect(plan?.data.lastSyncError).toMatch(/INSTITUTION_DOWN/);
  });

  it("records a pending expiration with its date", () => {
    const plan = planPlaidWebhook(
      {
        webhook_type: "ITEM",
        webhook_code: "PENDING_EXPIRATION",
        consent_expiration_time: "2026-10-01T00:00:00Z",
      },
      now,
    );
    expect(plan?.data).toEqual({
      pendingExpirationAt: now,
      consentExpiresAt: new Date("2026-10-01T00:00:00Z"),
    });
  });

  it("records a pending disconnect with its reason", () => {
    const plan = planPlaidWebhook(
      { webhook_type: "ITEM", webhook_code: "PENDING_DISCONNECT", reason: "INSTITUTION_MIGRATION" },
      now,
    );
    expect(plan?.data).toEqual({ pendingDisconnectAt: now, pendingDisconnectReason: "INSTITUTION_MIGRATION" });
  });

  it("clears every repair prompt on LOGIN_REPAIRED", () => {
    const plan = planPlaidWebhook({ webhook_type: "ITEM", webhook_code: "LOGIN_REPAIRED" }, now);
    expect(plan?.data).toMatchObject({
      status: PlaidItemStatus.ACTIVE,
      errorCode: null,
      errorMessage: null,
      pendingExpirationAt: null,
      pendingDisconnectAt: null,
    });
    // New accounts are a separate question that a repaired login does not answer.
    expect(plan?.data).not.toHaveProperty("newAccountsAvailableAt");
    expect(plan?.refreshConsent).toBe(true);
  });

  it("records new accounts", () => {
    const plan = planPlaidWebhook({ webhook_type: "ITEM", webhook_code: "NEW_ACCOUNTS_AVAILABLE" }, now);
    expect(plan?.data).toEqual({ newAccountsAvailableAt: now });
  });

  it("ignores everything else", () => {
    expect(planPlaidWebhook({ webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE" }, now)).toBeNull();
    expect(planPlaidWebhook({ webhook_type: "ITEM", webhook_code: "WEBHOOK_UPDATE_ACKNOWLEDGED" }, now)).toBeNull();
  });
});

function fakeDb(item: Record<string, unknown> | null) {
  return {
    plaidItem: {
      findUnique: vi.fn(async () => item),
      update: vi.fn(async () => ({})),
    },
  };
}

const storedItem = {
  id: "row-1",
  userId: "u1",
  itemId: "item-1",
  institutionName: "Test Credit Union",
  status: PlaidItemStatus.LOGIN_REQUIRED,
  accessTokenEnc: "enc",
  webhookUrl: null,
};

describe("applyPlaidWebhook", () => {
  beforeEach(() => vi.mocked(recordAuditLog).mockClear());

  it("writes the plan to the named item, refreshes consent, then audits", async () => {
    const db = fakeDb(storedItem);
    const client = {
      getAccounts: vi.fn(async () => ({
        accounts: [],
        item: { item_id: "item-1", consent_expiration_time: "2027-01-01T00:00:00Z" },
      })),
    };
    const outcome = await applyPlaidWebhook(
      { prisma: db as never, client: client as never, now },
      { webhook_type: "ITEM", webhook_code: "LOGIN_REPAIRED", item_id: "item-1" },
    );
    expect(outcome).toBe("applied");
    expect(db.plaidItem.findUnique).toHaveBeenCalledWith({ where: { itemId: "item-1" } });
    expect(db.plaidItem.update).toHaveBeenNthCalledWith(1, {
      where: { id: "row-1" },
      data: expect.objectContaining({ status: PlaidItemStatus.ACTIVE }),
    });
    expect(db.plaidItem.update).toHaveBeenNthCalledWith(2, {
      where: { id: "row-1" },
      data: { consentExpiresAt: new Date("2027-01-01T00:00:00Z") },
    });
    expect(recordAuditLog).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ userId: "u1", targetId: "row-1", metadata: expect.objectContaining({ code: "LOGIN_REPAIRED" }) }),
    );
  });

  it("does nothing for an item this server does not hold", async () => {
    const db = fakeDb(null);
    const outcome = await applyPlaidWebhook(
      { prisma: db as never, client: {} as never, now },
      { webhook_type: "ITEM", webhook_code: "NEW_ACCOUNTS_AVAILABLE", item_id: "someone-else" },
    );
    expect(outcome).toBe("unknown-item");
    expect(db.plaidItem.update).not.toHaveBeenCalled();
    expect(recordAuditLog).not.toHaveBeenCalled();
  });

  it("does not look anything up for a webhook it ignores", async () => {
    const db = fakeDb(storedItem);
    const outcome = await applyPlaidWebhook(
      { prisma: db as never, client: {} as never, now },
      { webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE", item_id: "item-1" },
    );
    expect(outcome).toBe("ignored");
    expect(db.plaidItem.findUnique).not.toHaveBeenCalled();
  });
});

describe("ensurePlaidItemWebhook", () => {
  const env = { NEXTAUTH_URL: "https://money.example.com" };

  it("registers the URL once and remembers it", async () => {
    const db = fakeDb(storedItem);
    const client = { updateItemWebhook: vi.fn(async () => {}) };
    await ensurePlaidItemWebhook({ prisma: db as never, client: client as never, env }, "row-1");
    expect(client.updateItemWebhook).toHaveBeenCalledWith("access-token", "https://money.example.com/api/plaid/webhook");
    expect(db.plaidItem.update).toHaveBeenCalledWith({
      where: { id: "row-1" },
      data: { webhookUrl: "https://money.example.com/api/plaid/webhook" },
    });
  });

  it("skips an item already pointed at this URL, and deployments without one", async () => {
    const client = { updateItemWebhook: vi.fn(async () => {}) };
    const current = fakeDb({ ...storedItem, webhookUrl: "https://money.example.com/api/plaid/webhook" });
    await ensurePlaidItemWebhook({ prisma: current as never, client: client as never, env }, "row-1");
    await ensurePlaidItemWebhook({ prisma: fakeDb(storedItem) as never, client: client as never, env: {} }, "row-1");
    expect(client.updateItemWebhook).not.toHaveBeenCalled();
  });

  it("never throws when Plaid refuses", async () => {
    const db = fakeDb(storedItem);
    const client = { updateItemWebhook: vi.fn(async () => { throw new Error("down"); }) };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      ensurePlaidItemWebhook({ prisma: db as never, client: client as never, env }, "row-1"),
    ).resolves.toBeUndefined();
    expect(db.plaidItem.update).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
