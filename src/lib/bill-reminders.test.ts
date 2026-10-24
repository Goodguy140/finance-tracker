import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { copyMigratedDatabase } from "@/test-support/migrated-db";

const dir = mkdtempSync(join(tmpdir(), "bill-reminders-"));
const url = `file:${join(dir, "reminders.db")}`;
let db: PrismaClient;
let reminders: typeof import("./bill-reminders");

const session = vi.hoisted(() => ({ userId: "" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({
  requireUser: vi.fn(async () => ({ id: session.userId, timezone: "America/Toronto" })),
}));

beforeAll(async () => {
  copyMigratedDatabase(url);
  process.env.DATABASE_URL = url;
  ({ prisma: db } = await import("@/lib/prisma"));
  reminders = await import("./bill-reminders");
});

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

let seq = 0;
let userId: string;
let categoryId: string;
let chequingId: string;
let cardId: string;

beforeEach(async () => {
  seq += 1;
  userId = (
    await db.user.create({ data: { email: `r${seq}@example.test`, displayName: "Test", billReminderDays: 3 } })
  ).id;
  categoryId = (await db.category.create({ data: { userId, name: "Bills", kind: "EXPENSE" } })).id;
  chequingId = (await db.account.create({ data: { userId, name: "Chequing", type: "CHEQUING" } })).id;
  cardId = (await db.account.create({ data: { userId, name: "Visa", type: "CREDIT_CARD" } })).id;
});

function rule(name: string, nextYmd: string, extra: Record<string, unknown> = {}) {
  return db.recurringTransaction.create({
    data: {
      userId,
      accountId: chequingId,
      categoryId,
      type: "EXPENSE",
      name,
      amountCents: 10_000,
      cadence: "MONTHLY",
      nextExpectedDate: new Date(`${nextYmd}T00:00:00Z`),
      ...extra,
    },
  });
}

async function user() {
  return db.user.findUniqueOrThrow({ where: { id: userId } });
}

// Friday 23 October 2026, 08:00 in Toronto.
const now = new Date("2026-10-23T12:00:00Z");

describe("bill reminders", () => {
  it("reminds bills and transfers due within the window once, leaving out income and overdue ones", async () => {
    await rule("Phone", "2026-10-24");
    await rule("Card payment", "2026-10-26", { type: "TRANSFER", transferAccountId: cardId, amountCents: 50_000 });
    await rule("Rent", "2026-10-27"); // four days out: beyond a three-day window
    await rule("Pay", "2026-10-24", { type: "INCOME" });
    await rule("Gym", "2026-10-20"); // overdue this month
    await rule("Paused", "2026-10-24", { enabled: false });

    const send = vi.fn(async (_message: { to: string; subject: string; text: string }) => ({ sent: true }));
    expect(await reminders.sendDueBillReminders(await user(), now, { send })).toBe("sent");
    expect(send).toHaveBeenCalledTimes(1);
    const message = send.mock.calls[0][0];
    expect(message.subject).toBe("2 bills due soon: $600.00");
    expect(message.text).toContain("  Tomorrow  Phone: $100.00 (Chequing)");
    expect(message.text).toContain("  Mon, Oct 26  Card payment: $500.00 (transfer, Chequing to Visa)");
    expect(message.text).not.toContain("Rent");
    expect(message.text).not.toContain("Pay");
    expect(message.text).not.toContain("Gym");
    expect(message.text).not.toContain("Paused");

    // The next tick has nothing new to say.
    expect(await reminders.sendDueBillReminders(await user(), new Date("2026-10-23T13:00:00Z"), { send })).toBe("none");
    // The day after, Rent comes into the window and only it is sent.
    expect(await reminders.sendDueBillReminders(await user(), new Date("2026-10-24T12:00:00Z"), { send })).toBe("sent");
    expect(send.mock.calls[1][0].subject).toBe("Rent is due on Tue, Oct 27: $100.00");
  });

  it("waits for 7am in the user's time zone and does nothing when off", async () => {
    await rule("Phone", "2026-10-24");
    const send = vi.fn(async () => ({ sent: true }));
    // 06:30 in Toronto.
    expect(await reminders.sendDueBillReminders(await user(), new Date("2026-10-23T10:30:00Z"), { send })).toBe("not-due");
    expect(await reminders.sendDueBillReminders({ ...(await user()), billReminderDays: null }, now, { send })).toBe("not-due");
    expect(send).not.toHaveBeenCalled();
  });

  it("a failed send marks nothing, so the next tick tries again", async () => {
    const phone = await rule("Phone", "2026-10-24");
    const send = vi.fn(async () => {
      throw new Error("SMTP down");
    });
    expect(await reminders.sendDueBillReminders(await user(), now, { send })).toBe("failed");
    expect((await db.recurringTransaction.findUniqueOrThrow({ where: { id: phone.id } })).reminderSentForDate).toBeNull();
  });

  it("the sweep does nothing without SMTP", async () => {
    await rule("Phone", "2026-10-24");
    const send = vi.fn(async () => ({ sent: true }));
    expect(await reminders.runBillReminderSweep(now, { send, smtpConfigured: () => false })).toMatchObject({ sent: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it("the setting accepts 1, 3 or 7 days, or off", async () => {
    session.userId = userId;
    const { setBillRemindersAction } = await import("@/app/actions/preferences");
    const env = { ...process.env };
    Object.assign(process.env, { SMTP_HOST: "h", SMTP_USER: "u", SMTP_PASS: "p", SMTP_FROM: "f@example.test" });
    try {
      const form = new FormData();
      form.set("days", "7");
      expect(await setBillRemindersAction(form)).toBeUndefined();
      expect((await user()).billReminderDays).toBe(7);
      form.set("days", "OFF");
      await setBillRemindersAction(form);
      expect((await user()).billReminderDays).toBeNull();
      form.set("days", "5");
      expect(await setBillRemindersAction(form)).toMatchObject({ error: "Choose when to be reminded." });
    } finally {
      process.env = env;
    }
  });
});
