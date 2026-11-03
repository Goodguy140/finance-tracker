import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({})) } }));
vi.mock("@/lib/audit-log", () => ({
  AUDIT_ACTIONS: { api_recurring_skipped: "api_recurring_skipped" },
  recordAuditLog: vi.fn(),
}));
vi.mock("@/lib/api-v1/route-auth", async () => ({
  ...(await vi.importActual<typeof import("@/lib/api-v1/route-auth")>("@/lib/api-v1/route-auth")),
  authorizeApiRequest: vi.fn(async () => ({ ok: true, auth: { user: { id: "u1" }, token: { id: "d1", kind: "device" } } })),
}));
vi.mock("@/lib/recurring-skip", () => ({ skipRecurringOccurrence: vi.fn() }));

const { recordAuditLog } = await import("@/lib/audit-log");
const { skipRecurringOccurrence } = await import("@/lib/recurring-skip");
const { RecurringOccurrenceError } = await import("@/lib/recurring-post");
const { POST } = await import("./route");

const params = { params: Promise.resolve({ id: "r1" }) };
const skip = (body: string) => POST(new Request("http://localhost/api/v1/recurring/r1/skip", { method: "POST", body }), params);

describe("POST /api/v1/recurring/:id/skip", () => {
  beforeEach(() => vi.clearAllMocks());

  it("skips the occurrence for the reason given and records it", async () => {
    const res = await skip('{"expectedDate":"2026-11-01","reason":"already_logged"}');
    expect(res.status).toBe(200);
    expect(vi.mocked(skipRecurringOccurrence).mock.calls[0]?.[1]).toMatchObject({
      userId: "u1",
      recurringTransactionId: "r1",
      reason: "already_logged",
    });
    expect(vi.mocked(recordAuditLog).mock.calls[0]?.[1]).toMatchObject({
      action: "api_recurring_skipped",
      targetId: "r1",
      metadata: { via: "app", reason: "already_logged" },
    });
  });

  it("answers 409 with the reason when the rule has moved on, and records nothing", async () => {
    vi.mocked(skipRecurringOccurrence).mockRejectedValue(
      new RecurringOccurrenceError("This subscription has already moved to a different expected date."),
    );
    const res = await skip('{"expectedDate":"2026-11-01"}');
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "This subscription has already moved to a different expected date." });
    expect(recordAuditLog).not.toHaveBeenCalled();
  });
});
