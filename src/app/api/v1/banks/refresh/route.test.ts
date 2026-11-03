import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/audit-log", () => ({
  AUDIT_ACTIONS: { plaid_item_sync_succeeded: "plaid_item_sync_succeeded" },
  recordAuditLog: vi.fn(),
}));
vi.mock("@/lib/api-v1/route-auth", async () => ({
  ...(await vi.importActual<typeof import("@/lib/api-v1/route-auth")>("@/lib/api-v1/route-auth")),
  authorizeApiRequest: vi.fn(async () => ({ ok: true, auth: { user: { id: "u1" }, token: { id: "d1" } } })),
}));
vi.mock("@/lib/plaid-sync-scheduler", () => ({ sweepDuePlaidItems: vi.fn() }));

const { recordAuditLog } = await import("@/lib/audit-log");
const { sweepDuePlaidItems } = await import("@/lib/plaid-sync-scheduler");
const { PlaidApiError } = await import("@/lib/plaid/client");
const { LOG_REFRESH_INTERVAL_MINUTES } = await import("@/lib/plaid/log-refresh");
const { POST } = await import("./route");

const refresh = () => POST(new Request("http://localhost/api/v1/banks/refresh", { method: "POST" }));

describe("POST /api/v1/banks/refresh", () => {
  beforeEach(() => vi.clearAllMocks());

  it("checks only this user's banks, at the log's interval, and says what came of it", async () => {
    vi.mocked(sweepDuePlaidItems).mockResolvedValue({ considered: 1, synced: 1, staged: 3, busy: 0, needsReauth: 0, failed: 0 });
    const res = await refresh();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tone: "success", message: "3 new transactions to review." });
    expect(sweepDuePlaidItems).toHaveBeenCalledWith(expect.any(Date), { userId: "u1", intervalMinutes: LOG_REFRESH_INTERVAL_MINUTES });
    expect(vi.mocked(recordAuditLog).mock.calls[0]?.[1]).toMatchObject({ metadata: { mode: "app-refresh", staged: 3 } });
  });

  it("answers 502 with Plaid's message when the bank cannot be reached", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(sweepDuePlaidItems).mockRejectedValue(
      new PlaidApiError({ message: "Plaid is down.", errorCode: "X", errorType: "API_ERROR", requestId: null, httpStatus: 500 }),
    );
    const res = await refresh();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Plaid is down." });
    expect(recordAuditLog).not.toHaveBeenCalled();
  });
});
