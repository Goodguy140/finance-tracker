import { TransactionType } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/audit-log", () => ({
  AUDIT_ACTIONS: { plaid_transactions_committed: "plaid_transactions_committed" },
  recordAuditLog: vi.fn(),
}));
vi.mock("@/lib/api-v1/route-auth", async () => ({
  ...(await vi.importActual<typeof import("@/lib/api-v1/route-auth")>("@/lib/api-v1/route-auth")),
  authorizeApiRequest: vi.fn(async () => ({ ok: true, auth: { user: { id: "u1" }, token: { id: "d1" } } })),
}));
vi.mock("@/lib/plaid/review-decisions", async () => ({
  ReviewDecisionError: (await vi.importActual<typeof import("@/lib/plaid/review-decisions")>("@/lib/plaid/review-decisions"))
    .ReviewDecisionError,
  decideStagedRow: vi.fn(),
}));

const { recordAuditLog } = await import("@/lib/audit-log");
const { decideStagedRow, ReviewDecisionError } = await import("@/lib/plaid/review-decisions");
const { POST } = await import("./route");

const params = { params: Promise.resolve({ id: "s1" }) };
const post = (body: string) => POST(new Request("http://localhost/api/v1/review-queue/s1", { method: "POST", body }), params);

describe("POST /api/v1/review-queue/:id", () => {
  beforeEach(() => vi.clearAllMocks());

  it("adds the row as the phone chose and records it", async () => {
    vi.mocked(decideStagedRow).mockResolvedValue({ transactionId: "t9" });
    const res = await post('{"decision":"add","countAs":"expense","categoryId":"c1"}');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ transactionId: "t9" });
    expect(decideStagedRow).toHaveBeenCalledWith("u1", "s1", {
      decision: "add",
      countAs: TransactionType.EXPENSE,
      categoryId: "c1",
    });
    expect(vi.mocked(recordAuditLog).mock.calls[0]?.[1]).toMatchObject({
      targetId: "t9",
      metadata: { via: "app", decision: "add", stagedId: "s1" },
    });
  });

  it("answers 409 with the reason when the row was already decided, and records nothing", async () => {
    vi.mocked(decideStagedRow).mockRejectedValue(new ReviewDecisionError("That synced transaction has already been reviewed."));
    const res = await post('{"decision":"ignore"}');
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "That synced transaction has already been reviewed." });
    expect(recordAuditLog).not.toHaveBeenCalled();
  });

  it("lets any other failure through rather than calling it a refusal", async () => {
    vi.mocked(decideStagedRow).mockRejectedValue(new Error("database is locked"));
    await expect(post('{"decision":"ignore"}')).rejects.toThrow("database is locked");
  });

  it("refuses a body that is not a decision before touching the queue", async () => {
    expect((await post("not json")).status).toBe(400);
    expect((await post('{"decision":"approve"}')).status).toBe(400);
    expect(decideStagedRow).not.toHaveBeenCalled();
  });
});
