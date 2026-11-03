import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({})) } }));
vi.mock("@/lib/audit-log", () => ({
  AUDIT_ACTIONS: { api_recurring_posted: "api_recurring_posted" },
  recordAuditLog: vi.fn(),
}));
vi.mock("@/lib/budget-alert-dispatch", () => ({ scheduleBudgetAlertEmails: vi.fn() }));
vi.mock("@/lib/webhooks", () => ({ emitTransactionsCreated: vi.fn() }));
vi.mock("@/lib/api-v1/route-auth", async () => ({
  ...(await vi.importActual<typeof import("@/lib/api-v1/route-auth")>("@/lib/api-v1/route-auth")),
  authorizeApiRequest: vi.fn(async () => ({ ok: true, auth: { user: { id: "u1" }, token: { id: "d1", kind: "device" } } })),
}));
vi.mock("@/lib/recurring-post", async () => {
  const actual = await vi.importActual<typeof import("@/lib/recurring-post")>("@/lib/recurring-post");
  return { ...actual, postRecurringOccurrence: vi.fn() };
});

const { recordAuditLog } = await import("@/lib/audit-log");
const { emitTransactionsCreated } = await import("@/lib/webhooks");
const { postRecurringOccurrence, RecurringOccurrenceError } = await import("@/lib/recurring-post");
const { POST } = await import("./route");

const params = { params: Promise.resolve({ id: "r1" }) };
const post = (body: string) => POST(new Request("http://localhost/api/v1/recurring/r1/post", { method: "POST", body }), params);

describe("POST /api/v1/recurring/:id/post", () => {
  beforeEach(() => vi.clearAllMocks());

  it("posts the occurrence asked for, announces the entry and records it", async () => {
    vi.mocked(postRecurringOccurrence).mockImplementation(async (_tx, p) => {
      p.onPosted?.("t9");
      return "posted";
    });
    const res = await post('{"expectedDate":"2026-11-01"}');
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ outcome: "posted", transactionId: "t9" });
    expect(vi.mocked(postRecurringOccurrence).mock.calls[0]?.[1]).toMatchObject({ userId: "u1", recurringTransactionId: "r1" });
    expect(emitTransactionsCreated).toHaveBeenCalledWith("u1", ["t9"], "manual");
    expect(vi.mocked(recordAuditLog).mock.calls[0]?.[1]).toMatchObject({
      action: "api_recurring_posted",
      targetId: "t9",
      metadata: { via: "app", recurringTransactionId: "r1", expectedDate: "2026-11-01" },
    });
  });

  it("answers a retry of a posted occurrence as already posted, not an error, and records nothing", async () => {
    vi.mocked(postRecurringOccurrence).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" }),
    );
    const res = await post('{"expectedDate":"2026-11-01"}');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outcome: "already_posted", transactionId: null });
    expect(recordAuditLog).not.toHaveBeenCalled();
    expect(emitTransactionsCreated).not.toHaveBeenCalled();
  });

  it("answers 409 with the reason when the rule refuses, and 404 for a rule that is not the user's", async () => {
    vi.mocked(postRecurringOccurrence).mockRejectedValueOnce(new RecurringOccurrenceError("Recurring transaction is disabled."));
    const refused = await post('{"expectedDate":"2026-11-01"}');
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: "Recurring transaction is disabled." });

    vi.mocked(postRecurringOccurrence).mockRejectedValueOnce(new RecurringOccurrenceError("Recurring transaction not found.", true));
    expect((await post('{"expectedDate":"2026-11-01"}')).status).toBe(404);
  });

  it("lets any other failure through rather than calling it a refusal", async () => {
    vi.mocked(postRecurringOccurrence).mockRejectedValue(new Error("database is locked"));
    await expect(post('{"expectedDate":"2026-11-01"}')).rejects.toThrow("database is locked");
  });

  it("refuses a body without a calendar date before touching the rule", async () => {
    expect((await post("not json")).status).toBe(400);
    expect((await post('{"expectedDate":"2026-13-01"}')).status).toBe(400);
    expect(postRecurringOccurrence).not.toHaveBeenCalled();
  });
});
