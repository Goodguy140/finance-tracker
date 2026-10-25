import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { currentYmdInTimeZone } from "@/lib/period-month";
import { copyMigratedDatabase } from "@/test-support/migrated-db";

const dir = mkdtempSync(join(tmpdir(), "digest-"));
const url = `file:${join(dir, "digest.db")}`;
let db: PrismaClient;
let digest: typeof import("./email-digest");

const session = vi.hoisted(() => ({ userId: "" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({
  requireUser: vi.fn(async () => ({ id: session.userId, timezone: "America/Toronto" })),
}));

beforeAll(async () => {
  copyMigratedDatabase(url);
  // The report loader uses the app's shared client, which reads DATABASE_URL when first loaded.
  process.env.DATABASE_URL = url;
  ({ prisma: db } = await import("@/lib/prisma"));
  digest = await import("./email-digest");
});

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

describe("digest periods", () => {
  it("a weekly digest covers the last full Monday-to-Sunday week", () => {
    // 2026-10-21 is a Wednesday.
    const p = digest.latestDigestPeriod("WEEKLY", "2026-10-21");
    expect(p.key).toBe("W:2026-10-12");
    expect(p.start.toISOString().slice(0, 10)).toBe("2026-10-12");
    expect(p.end.toISOString().slice(0, 10)).toBe("2026-10-19");
    expect(p.previousStart.toISOString().slice(0, 10)).toBe("2026-10-05");
    expect(p.label).toBe("Oct 12 to Oct 18");
    // On the Monday itself, the week that just ended.
    expect(digest.latestDigestPeriod("WEEKLY", "2026-10-19").key).toBe("W:2026-10-12");
  });

  it("a monthly digest covers the calendar month before, across a year end", () => {
    const p = digest.latestDigestPeriod("MONTHLY", "2027-01-01");
    expect(p.key).toBe("M:2026-12");
    expect(p.start.toISOString().slice(0, 10)).toBe("2026-12-01");
    expect(p.end.toISOString().slice(0, 10)).toBe("2027-01-01");
    expect(p.previousStart.toISOString().slice(0, 10)).toBe("2026-11-01");
  });

  it("is due once per period, from 7am in the user's own time zone", () => {
    const user = { digestFrequency: "WEEKLY" as const, digestLastPeriodKey: "W:2026-10-12", timezone: "America/Toronto" };
    // Monday Oct 26, 06:30 in Toronto (10:30 UTC): not yet.
    expect(digest.dueDigestPeriod(user, new Date("2026-10-26T10:30:00Z"))).toBeNull();
    // 07:30 in Toronto: the week of Oct 19 is due.
    expect(digest.dueDigestPeriod(user, new Date("2026-10-26T11:30:00Z"))?.key).toBe("W:2026-10-19");
    // Already sent for it: nothing.
    expect(digest.dueDigestPeriod({ ...user, digestLastPeriodKey: "W:2026-10-19" }, new Date("2026-10-26T11:30:00Z"))).toBeNull();
    expect(digest.dueDigestPeriod({ ...user, digestFrequency: "OFF" }, new Date("2026-10-26T11:30:00Z"))).toBeNull();
  });
});

let seq = 0;
let userId: string;
let foodId: string;
let rentId: string;
let accountId: string;

beforeEach(async () => {
  seq += 1;
  userId = (
    await db.user.create({
      data: { email: `d${seq}@example.test`, displayName: "Test", digestFrequency: "MONTHLY", digestLastPeriodKey: "M:2026-08" },
    })
  ).id;
  foodId = (await db.category.create({ data: { userId, name: "Food", kind: "EXPENSE" } })).id;
  rentId = (await db.category.create({ data: { userId, name: "Rent", kind: "EXPENSE" } })).id;
  accountId = (await db.account.create({ data: { userId, name: "Chequing", type: "CHEQUING" } })).id;
});

async function user() {
  return db.user.findUniqueOrThrow({ where: { id: userId } });
}

function tx(day: string, categoryId: string, amountCents: number, title: string, type: "EXPENSE" | "INCOME" = "EXPENSE") {
  return db.transaction.create({
    data: { userId, accountId, categoryId, type, amountCents, title, date: new Date(`${day}T00:00:00Z`) },
  });
}

// 1 October 2026, 08:00 in Toronto.
const now = new Date("2026-10-01T12:00:00Z");

describe("the digest's contents", () => {
  it("totals the month, ranks categories and compares with the month before", async () => {
    const salary = await db.category.create({ data: { userId, name: "Salary", kind: "INCOME" } });
    await tx("2026-09-03", rentId, 150_000, "Rent");
    await tx("2026-09-10", foodId, 30_000, "Groceries");
    await tx("2026-09-12", foodId, -5_000, "Refund"); // a refund lowers spending, not income
    await tx("2026-09-15", salary.id, 400_000, "Pay", "INCOME");
    await tx("2026-08-10", foodId, 100_000, "August");
    await tx("2026-10-01", foodId, 99_999, "Today, next period");
    await db.budget.create({ data: { userId, categoryId: foodId, periodMonth: "2026-09", limitCents: 20_000 } });

    const period = digest.latestDigestPeriod("MONTHLY", "2026-10-01");
    const data = await digest.loadDigestData(await user(), period, now);
    expect(data.spentCents).toBe(175_000);
    expect(data.receivedCents).toBe(400_000);
    expect(data.previousSpentCents).toBe(100_000);
    expect(data.topCategories).toEqual([
      { name: "Rent", cents: 150_000 },
      { name: "Food", cents: 25_000 },
    ]);
    expect(data.biggest.map((b) => b.title)).toEqual(["Rent", "Groceries"]);
    expect(data.budgets).toEqual([{ name: "Food", spentCents: 25_000, limitCents: 20_000 }]);

    const { subject, text } = digest.renderDigest(data, "https://example.test");
    expect(subject).toBe("Your September 2026: spent $1,750.00");
    expect(text).toContain("Spent: $1,750.00 (up 75% on the month before)");
    expect(text).toContain("Left over: $2,250.00");
    expect(text).toContain("  Food: $250.00 of $200.00, over by $50.00");
    expect(text).toContain("Open the app: https://example.test/");
    expect(text).toContain("Review and close the month: https://example.test/reports/month?month=2026-09");
  });

  it("lists bills due soon and bank rows waiting", async () => {
    await db.recurringTransaction.create({
      data: {
        userId,
        accountId,
        categoryId: rentId,
        type: "EXPENSE",
        name: "Rent",
        amountCents: 150_000,
        cadence: "MONTHLY",
        nextExpectedDate: new Date("2026-10-03T00:00:00Z"),
      },
    });
    const data = await digest.loadDigestData(await user(), digest.latestDigestPeriod("MONTHLY", "2026-10-01"), now);
    expect(data.upcoming).toEqual([{ date: new Date("2026-10-03T00:00:00Z"), name: "Rent", cents: 150_000 }]);
    expect(digest.digestIsEmpty(data)).toBe(false);
    expect(digest.renderDigest(data).text).toContain("Bills in the next 30 days\n  Oct 3  Rent: $1,500.00");
    // Nothing in yet this month, and rent still to pay.
    expect(data.safeToSpendCents).toBe(-150_000);
    expect(digest.renderDigest(data).text).toContain("Safe to spend for the rest of this month: -$1,500.00");
  });
});

describe("sending", () => {
  it("sends once per period, and not at all for an empty one", async () => {
    await tx("2026-09-10", foodId, 30_000, "Groceries");
    const send = vi.fn(async () => ({ sent: true }));
    expect(await digest.sendDueDigest(await user(), now, { send })).toBe("sent");
    expect(send).toHaveBeenCalledTimes(1);
    expect((await user()).digestLastPeriodKey).toBe("M:2026-09");
    expect(await digest.sendDueDigest(await user(), now, { send })).toBe("not-due");

    // October has nothing in it: the period is marked done, nothing is sent.
    const nov = new Date("2026-11-01T13:00:00Z");
    expect(await digest.sendDueDigest(await user(), nov, { send })).toBe("empty");
    expect(send).toHaveBeenCalledTimes(1);
    expect((await user()).digestLastPeriodKey).toBe("M:2026-10");
  });

  it("gives the period back when sending fails, so the next tick retries", async () => {
    await tx("2026-09-10", foodId, 30_000, "Groceries");
    const send = vi.fn(async () => {
      throw new Error("SMTP down");
    });
    expect(await digest.sendDueDigest(await user(), now, { send })).toBe("failed");
    expect((await user()).digestLastPeriodKey).toBe("M:2026-08");
  });

  it("a second sender with the old key loses the claim", async () => {
    await tx("2026-09-10", foodId, 30_000, "Groceries");
    const stale = await user();
    const send = vi.fn(async () => ({ sent: true }));
    expect(await digest.sendDueDigest(stale, now, { send })).toBe("sent");
    expect(await digest.sendDueDigest(stale, now, { send })).toBe("taken");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("the sweep does nothing without SMTP", async () => {
    const send = vi.fn(async () => ({ sent: true }));
    expect(await digest.runEmailDigestSweep(now, { send, smtpConfigured: () => false })).toMatchObject({ sent: 0 });
    expect(send).not.toHaveBeenCalled();
  });
});

describe("choosing a frequency", () => {
  it("turning it on marks the period just ended, so the first digest waits for the next one", async () => {
    session.userId = userId;
    const { setEmailDigestAction } = await import("@/app/actions/preferences");
    const env = { ...process.env };
    Object.assign(process.env, { SMTP_HOST: "h", SMTP_USER: "u", SMTP_PASS: "p", SMTP_FROM: "f@example.test" });
    try {
      const form = new FormData();
      form.set("frequency", "WEEKLY");
      expect(await setEmailDigestAction(form)).toBeUndefined();
      const after = await user();
      expect(after.digestFrequency).toBe("WEEKLY");
      expect(after.digestLastPeriodKey).toBe(digest.latestDigestPeriod("WEEKLY", currentYmdInTimeZone("America/Toronto")).key);
      expect(digest.dueDigestPeriod(after, new Date())).toBeNull();

      form.set("frequency", "DAILY");
      expect(await setEmailDigestAction(form)).toMatchObject({ ok: false });
    } finally {
      process.env = env;
    }
  });
});
