import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/lib/prisma", () => ({ prisma: { category: { findMany: vi.fn() } } }));
vi.mock("@/lib/yearly-budgets", () => ({ loadYearlyBudgetRows: vi.fn() }));
vi.mock("@/lib/api-token", () => ({
  API_SCOPES: { budgetsRead: "budgets:read" },
  authenticateApiToken: vi.fn(),
}));
vi.mock("@/lib/budget-progress", () => ({
  buildMonthlyBudgetProgress: vi.fn(),
  budgetRowPercentUsed: vi.fn(() => 78),
}));
vi.mock("@/lib/rate-limit", async () => ({
  RateLimitExceededError: (await vi.importActual<typeof import("@/lib/rate-limit")>("@/lib/rate-limit")).RateLimitExceededError,
  enforceSlidingWindowRateLimit: vi.fn(async () => {}),
}));
vi.mock("@/lib/period-month", async () => {
  const actual = await vi.importActual<typeof import("@/lib/period-month")>("@/lib/period-month");
  return { ...actual, currentYmInTimeZone: vi.fn(() => "2026-06") };
});
vi.mock("@/lib/audit-log", () => ({
  AUDIT_ACTIONS: { api_budgets_read: "api_budgets_read" },
  recordAuditLog: vi.fn(),
}));

const { authenticateApiToken } = await import("@/lib/api-token");
const { buildMonthlyBudgetProgress } = await import("@/lib/budget-progress");
const { enforceSlidingWindowRateLimit, RateLimitExceededError } = await import("@/lib/rate-limit");
const { recordAuditLog } = await import("@/lib/audit-log");
const { prisma } = await import("@/lib/prisma");
const { loadYearlyBudgetRows } = await import("@/lib/yearly-budgets");
const { GET } = await import("./route");

const okAuth = {
  status: "ok" as const,
  user: { id: "u1", timezone: "America/Toronto" },
  token: { kind: "token" as const, id: "t1" },
};

const sampleProgress = {
  periodMonth: "2026-06",
  currency: "CAD",
  budgets: [{ categoryId: "c1", categoryName: "Groceries", limitCents: 40000, spentCents: 31200, progressPct: 78 }],
  totalLimitCents: 40000,
  totalSpentCents: 31200,
};

function get(month?: string) {
  const url = `http://localhost/api/v1/budgets${month !== undefined ? `?month=${month}` : ""}`;
  return GET(new Request(url, { headers: { authorization: "Bearer ft_x" } }));
}

describe("GET /api/v1/budgets", () => {
  beforeEach(() => {
    vi.mocked(authenticateApiToken).mockReset();
    vi.mocked(buildMonthlyBudgetProgress).mockReset();
    vi.mocked(enforceSlidingWindowRateLimit).mockReset().mockResolvedValue(undefined as never);
    vi.mocked(recordAuditLog).mockReset();
    vi.mocked(buildMonthlyBudgetProgress).mockResolvedValue(sampleProgress as never);
    vi.mocked(loadYearlyBudgetRows).mockReset().mockResolvedValue([]);
    vi.mocked(prisma.category.findMany).mockReset().mockResolvedValue([
      { id: "c1", groupName: "Food", rolloverSinceMonth: "2026-07" },
    ] as never);
  });

  it("returns 401 for an unauthorized token", async () => {
    vi.mocked(authenticateApiToken).mockResolvedValue({ status: "unauthorized" } as never);
    const res = await get();
    expect(res.status).toBe(401);
  });

  it("returns 403 when the token lacks the scope", async () => {
    vi.mocked(authenticateApiToken).mockResolvedValue({ status: "forbidden" } as never);
    const res = await get();
    expect(res.status).toBe(403);
  });

  it("returns 200 with shaped budget data for a valid token", async () => {
    vi.mocked(authenticateApiToken).mockResolvedValue(okAuth as never);
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body.periodMonth).toBe("2026-06");
    expect(body.currency).toBe("CAD");
    expect(body.budgets[0]).toMatchObject({
      categoryName: "Groceries",
      limitCents: 40000,
      spentCents: 31200,
      percentUsed: 78,
    });
    expect(vi.mocked(buildMonthlyBudgetProgress)).toHaveBeenCalledWith("u1", "2026-06");
    expect(vi.mocked(recordAuditLog)).toHaveBeenCalledOnce();
  });

  it("adds each budget's group, whether rollover is on that month, and the yearly budgets", async () => {
    vi.mocked(authenticateApiToken).mockResolvedValue(okAuth as never);
    vi.mocked(loadYearlyBudgetRows).mockResolvedValue([
      {
        categoryId: "c1",
        categoryName: "Groceries",
        limitCents: 120000,
        monthlyCents: 10000,
        setAsideCents: 60000,
        spentCents: 45000,
        fundCents: 15000,
        leftForYearCents: 75000,
      },
    ]);
    const june = await (await get("2026-06")).json();
    expect(june.budgets[0]).toMatchObject({ groupName: "Food", rollover: false });
    expect(june.yearly).toEqual([expect.objectContaining({ categoryName: "Groceries", fundCents: 15000, groupName: "Food" })]);
    const july = await (await get("2026-07")).json();
    expect(july.budgets[0]).toMatchObject({ rollover: true });
  });

  it("does not audit a read by the phone app", async () => {
    vi.mocked(authenticateApiToken).mockResolvedValue({ ...okAuth, token: { kind: "device", id: "d1" } } as never);
    const res = await get();
    expect(res.status).toBe(200);
    expect(vi.mocked(recordAuditLog)).not.toHaveBeenCalled();
  });

  it("defaults to the current month when no month is provided", async () => {
    vi.mocked(authenticateApiToken).mockResolvedValue(okAuth as never);
    await get();
    expect(vi.mocked(buildMonthlyBudgetProgress)).toHaveBeenCalledWith("u1", "2026-06");
  });

  it("honours a valid month parameter", async () => {
    vi.mocked(authenticateApiToken).mockResolvedValue(okAuth as never);
    await get("2026-03");
    expect(vi.mocked(buildMonthlyBudgetProgress)).toHaveBeenCalledWith("u1", "2026-03");
  });

  it("returns 400 for a malformed month parameter", async () => {
    vi.mocked(authenticateApiToken).mockResolvedValue(okAuth as never);
    const res = await get("garbage");
    expect(res.status).toBe(400);
    expect(vi.mocked(buildMonthlyBudgetProgress)).not.toHaveBeenCalled();
  });

  it("returns 429 when the rate limit is exceeded", async () => {
    vi.mocked(authenticateApiToken).mockResolvedValue(okAuth as never);
    vi.mocked(enforceSlidingWindowRateLimit).mockRejectedValue(new RateLimitExceededError("Rate limit exceeded."));
    const res = await get();
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
  });

  it("does not report a limiter that failed as the limit being reached", async () => {
    vi.mocked(authenticateApiToken).mockResolvedValue(okAuth as never);
    vi.mocked(enforceSlidingWindowRateLimit).mockRejectedValue(new Error("Socket timeout"));
    await expect(get()).rejects.toThrow("Socket timeout");
  });
});
