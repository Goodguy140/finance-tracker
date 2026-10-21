import { PlaidItemStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = {
  plaidItem: { findUnique: vi.fn(), update: vi.fn(async () => ({})) },
};
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/audit-log", async () => {
  const actual = await vi.importActual<typeof import("@/lib/audit-log")>("@/lib/audit-log");
  return { ...actual, recordAuditLog: vi.fn(async () => {}) };
});
vi.mock("@/lib/plaid/service", async () => {
  const { createFakePlaidClient } = await import("@/lib/plaid/fake-client");
  class PlaidNotConfiguredError extends Error {}
  return {
    PlaidNotConfiguredError,
    requirePlaidClient: vi.fn(async () => createFakePlaidClient()),
    openAccessToken: vi.fn(() => "access-token"),
  };
});

const { signFakePlaidWebhook } = await import("@/lib/plaid/fake-webhook");
const { clearWebhookKeyCache } = await import("@/lib/plaid/webhook-verify");
const { MAX_WEBHOOK_BODY_BYTES, POST } = await import("./route");

const payload = JSON.stringify({
  webhook_type: "ITEM",
  webhook_code: "ERROR",
  item_id: "item-1",
  error: { error_code: "ITEM_LOGIN_REQUIRED" },
});

function post(body: string, signature: string | null) {
  return POST(
    new Request("http://localhost/api/plaid/webhook", {
      method: "POST",
      body,
      headers: signature ? { "plaid-verification": signature } : {},
    }),
  );
}

describe("POST /api/plaid/webhook", () => {
  beforeEach(() => {
    clearWebhookKeyCache();
    db.plaidItem.findUnique.mockReset();
    db.plaidItem.update.mockClear();
    db.plaidItem.findUnique.mockResolvedValue({
      id: "row-1",
      userId: "u1",
      itemId: "item-1",
      institutionName: "Test Credit Union",
      status: PlaidItemStatus.ACTIVE,
      accessTokenEnc: "enc",
    });
  });

  it("applies a signed delivery", async () => {
    const res = await post(payload, signFakePlaidWebhook(payload));
    expect(res.status).toBe(200);
    expect(db.plaidItem.update).toHaveBeenCalledWith({
      where: { id: "row-1" },
      data: expect.objectContaining({ status: PlaidItemStatus.LOGIN_REQUIRED }),
    });
  });

  it("refuses an unsigned or tampered delivery and changes nothing", async () => {
    expect((await post(payload, null)).status).toBe(401);
    const signedForOther = signFakePlaidWebhook(payload.replace("ERROR", "LOGIN_REPAIRED"));
    expect((await post(payload, signedForOther)).status).toBe(401);
    expect(db.plaidItem.findUnique).not.toHaveBeenCalled();
    expect(db.plaidItem.update).not.toHaveBeenCalled();
  });

  it("answers 200 for an item it does not hold, without saying so", async () => {
    db.plaidItem.findUnique.mockResolvedValue(null);
    const res = await post(payload, signFakePlaidWebhook(payload));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("refuses an unsigned delivery without reading its body", async () => {
    const request = new Request("http://localhost/api/plaid/webhook", { method: "POST", body: payload });
    expect((await POST(request)).status).toBe(401);
    expect(request.bodyUsed).toBe(false);
  });

  it("refuses a body far larger than any Plaid webhook, declared or not", async () => {
    const huge = `{"pad":"${"x".repeat(MAX_WEBHOOK_BODY_BYTES)}"}`;
    const signature = signFakePlaidWebhook(huge);
    expect((await post(huge, signature)).status).toBe(413);

    // No Content-Length to go on: the stream is cut off once it passes the limit.
    const chunk = new TextEncoder().encode("x".repeat(16 * 1024));
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });
    const streamed = new Request("http://localhost/api/plaid/webhook", {
      method: "POST",
      body: stream,
      headers: { "plaid-verification": signature },
      duplex: "half",
    } as RequestInit);
    expect((await POST(streamed)).status).toBe(413);
    expect(sent).toBeLessThan(MAX_WEBHOOK_BODY_BYTES * 2);
    expect(db.plaidItem.update).not.toHaveBeenCalled();
  });
});
