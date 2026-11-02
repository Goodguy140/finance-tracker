import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/audit-log", () => ({ AUDIT_ACTIONS: {}, recordAuditLog: vi.fn() }));
vi.mock("@/lib/budget-alert-dispatch", () => ({ scheduleBudgetAlertEmails: vi.fn() }));
vi.mock("@/lib/api-v1/transactions", () => ({
  getTransactionForApi: vi.fn(async () => ({ id: "t1", type: "expense" })),
  updateTransactionFromApi: vi.fn(async () => ({ ok: true, transaction: { id: "t1", type: "expense" } })),
  deleteTransactionFromApi: vi.fn(async () => ({ undoId: "u1", type: "expense" })),
}));
// A personal access token holding both transaction scopes, but not the phone's `app`.
const held = new Set(["transactions:read", "transactions:write"]);
vi.mock("@/lib/api-v1/route-auth", () => ({
  NO_STORE: {},
  authorizeApiRequest: vi.fn(async (_request: Request, scope: string) =>
    held.has(scope)
      ? { ok: true, auth: { user: { id: "u1" }, token: { kind: "token", id: "pat" } } }
      : { ok: false, response: NextResponse.json({ error: "missing scope" }, { status: 403 }) },
  ),
}));

const { updateTransactionFromApi, deleteTransactionFromApi } = await import("@/lib/api-v1/transactions");
const { GET, PATCH, DELETE } = await import("./route");

const params = { params: Promise.resolve({ id: "t1" }) };
const request = (method: string) =>
  new Request("http://localhost/api/v1/transactions/t1", { method, body: method === "PATCH" ? '{"title":"x"}' : undefined });

describe("/api/v1/transactions/:id scopes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lets a personal access token read one entry", async () => {
    expect((await GET(request("GET"), params)).status).toBe(200);
  });

  it("keeps editing and deleting to the phone, even for a token with transactions:write", async () => {
    expect((await PATCH(request("PATCH"), params)).status).toBe(403);
    expect((await DELETE(request("DELETE"), params)).status).toBe(403);
    expect(updateTransactionFromApi).not.toHaveBeenCalled();
    expect(deleteTransactionFromApi).not.toHaveBeenCalled();
  });
});
