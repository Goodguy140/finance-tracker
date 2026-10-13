import { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendBudgetAlertEmail = vi.fn();
const isBudgetAlertEmailConfigured = vi.fn(() => true);
vi.mock("@/lib/budget-alert-email", () => ({ sendBudgetAlertEmail, isBudgetAlertEmailConfigured }));

const buildMonthlyBudgetProgress = vi.fn();
vi.mock("@/lib/budget-progress", () => ({ buildMonthlyBudgetProgress }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("next/server", () => ({
  after: vi.fn(() => {
    throw new Error("outside request scope");
  }),
}));

const { dispatchBudgetAlertEmails, scheduleBudgetAlertEmails } = await import("./budget-alert-dispatch");

function client(overrides: { user?: unknown } = {}) {
  return {
    user: {
      findUnique: vi.fn(async () =>
        "user" in overrides ? overrides.user : { email: "a@b.c", timezone: "UTC", budgetAlertEmailEnabled: true },
      ),
    },
    budgetAlertNotification: { create: vi.fn(async () => ({})), deleteMany: vi.fn(async () => ({ count: 1 })) },
  };
}

const now = new Date("2026-06-15T12:00:00.000Z");

describe("dispatchBudgetAlertEmails", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isBudgetAlertEmailConfigured.mockReturnValue(true);
    sendBudgetAlertEmail.mockResolvedValue({ sent: true });
    buildMonthlyBudgetProgress.mockResolvedValue({
      periodMonth: "2026-06",
      currency: "CAD",
      budgets: [
        { id: "b1", categoryId: "c1", categoryName: "Groceries", spentCents: 45_000, limitCents: 40_000, progressPct: 100 },
        { id: "b2", categoryId: "c2", categoryName: "Fun", spentCents: 1_000, limitCents: 40_000, progressPct: 3 },
      ],
      totalLimitCents: 80_000,
      totalSpentCents: 46_000,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emails each unannounced warning and records it", async () => {
    const db = client();
    const result = await dispatchBudgetAlertEmails("u1", db as never, now);
    expect(result).toEqual({ sent: 1, skipped: null });
    expect(db.budgetAlertNotification.create).toHaveBeenCalledWith({
      data: { userId: "u1", periodMonth: "2026-06", categoryId: "c1", severity: "critical" },
    });
    expect(sendBudgetAlertEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "a@b.c", subject: "Over budget: Groceries", text: expect.stringContaining("Groceries") }),
    );
  });

  it("points the reader at the page where email alerts are switched off", async () => {
    await dispatchBudgetAlertEmails("u1", client() as never, now);
    expect(sendBudgetAlertEmail).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining("Settings → Notifications") }),
    );
  });

  it("does nothing when the user has not opted in or SMTP is missing", async () => {
    const off = client({ user: { email: "a@b.c", timezone: "UTC", budgetAlertEmailEnabled: false } });
    expect(await dispatchBudgetAlertEmails("u1", off as never, now)).toEqual({ sent: 0, skipped: "disabled" });
    expect(buildMonthlyBudgetProgress).not.toHaveBeenCalled();

    isBudgetAlertEmailConfigured.mockReturnValue(false);
    expect(await dispatchBudgetAlertEmails("u1", client() as never, now)).toEqual({ sent: 0, skipped: "smtp" });
    expect(sendBudgetAlertEmail).not.toHaveBeenCalled();
  });

  it("skips a warning that was already announced this month", async () => {
    const db = client();
    db.budgetAlertNotification.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "t" }),
    );
    expect(await dispatchBudgetAlertEmails("u1", db as never, now)).toEqual({ sent: 0, skipped: null });
    expect(sendBudgetAlertEmail).not.toHaveBeenCalled();
  });

  it("releases the slot when the email could not be sent", async () => {
    const db = client();
    sendBudgetAlertEmail.mockResolvedValue({ sent: false, reason: "SMTP not configured" });
    expect(await dispatchBudgetAlertEmails("u1", db as never, now)).toEqual({ sent: 0, skipped: null });
    expect(db.budgetAlertNotification.deleteMany).toHaveBeenCalledWith({
      where: { userId: "u1", periodMonth: "2026-06", categoryId: "c1", severity: "critical" },
    });
  });
});

describe("scheduleBudgetAlertEmails", () => {
  it("falls back to running inline when there is no request to defer behind", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // The module-level prisma mock has no `user`, so the fallback run rejects and is logged, never thrown.
    scheduleBudgetAlertEmails("u1");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(errorSpy).toHaveBeenCalled();
  });
});
