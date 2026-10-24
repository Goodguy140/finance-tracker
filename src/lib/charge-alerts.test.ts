import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PlaidStagedStatus, TransactionType, type PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChargeRow } from "@/lib/charge-alerts";
import { copyMigratedDatabase } from "@/test-support/migrated-db";

const dir = mkdtempSync(join(tmpdir(), "charge-alerts-"));
const url = `file:${join(dir, "alerts.db")}`;
let db: PrismaClient;
let alerts: typeof import("./charge-alerts");
let actions: typeof import("@/app/actions/preferences");

const session = vi.hoisted(() => ({ userId: "" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: session.userId })) }));
vi.mock("@/lib/budget-alert-email", () => ({ isBudgetAlertEmailConfigured: () => true }));

beforeAll(async () => {
  copyMigratedDatabase(url);
  process.env.DATABASE_URL = url;
  ({ prisma: db } = await import("@/lib/prisma"));
  alerts = await import("./charge-alerts");
  actions = await import("@/app/actions/preferences");
});

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

function row(name: string, amountCents: number, extra: Partial<ChargeRow> = {}): ChargeRow {
  return {
    id: name,
    name,
    merchantName: null,
    amountCents,
    type: TransactionType.EXPENSE,
    currency: "CAD",
    date: new Date("2026-10-20T00:00:00Z"),
    pendingPlaidTransactionId: null,
    status: PlaidStagedStatus.NEEDS_REVIEW,
    accountName: "Chequing",
    ...extra,
  };
}

const past = (name: string, ...cents: number[]) => cents.map((amountCents) => ({ name, merchantName: null, amountCents, currency: "CAD" }));

describe("pickChargeAlerts", () => {
  it("flags new money out at or over the threshold, in the home currency only", () => {
    const picked = alerts.pickChargeAlerts(
      [
        row("Laptop", 50_000),
        row("Groceries", 49_999),
        row("Refund", -60_000),
        row("Paycheque", 300_000, { type: TransactionType.INCOME }),
        row("Typed in already", 80_000, { status: PlaidStagedStatus.LINKED }),
        row("Posted after pending", 90_000, { pendingPlaidTransactionId: "p1" }),
        row("Hotel abroad", 70_000, { currency: "USD" }),
      ],
      [],
      { thresholdCents: 50_000, unusual: false, homeCurrency: "CAD" },
    );
    expect(picked.map((a) => [a.name, a.reason])).toEqual([["Laptop", "large"]]);
  });

  it("flags a charge several times the merchant's usual amount, once there is a usual to compare", () => {
    const history = [...past("Hydro", 9_000, 10_000, 11_000), ...past("Coffee", 400, 450, 500), ...past("Gym", 5_000, 5_000)];
    const picked = alerts.pickChargeAlerts(
      [row("Hydro", 31_000), row("Hydro", 25_000), row("Coffee", 2_000), row("Gym", 40_000)],
      history,
      { thresholdCents: null, unusual: true, homeCurrency: "CAD" },
    );
    // Hydro $310 is over 3× its usual $100; $250 is not. Coffee is 4× but only $15.50 more;
    // the gym has two earlier charges, too few to know what is usual.
    expect(picked.map((a) => [a.name, a.amountCents, a.usualCents])).toEqual([["Hydro", 31_000, 10_000]]);
  });
});

describe("sendChargeAlerts", () => {
  let seq = 0;
  let userId: string;
  let itemId: string;
  let accountRowId: string;

  beforeEach(async () => {
    seq += 1;
    userId = (await db.user.create({ data: { email: `c${seq}@example.test`, displayName: "Test" } })).id;
    session.userId = userId;
    itemId = (
      await db.plaidItem.create({
        data: { userId, itemId: `item-${seq}`, accessTokenEnc: "x", requestedDays: 90, historyCutoff: new Date("2026-06-01T00:00:00Z") },
      })
    ).id;
    accountRowId = (
      await db.plaidAccount.create({
        data: { userId, plaidItemId: itemId, plaidAccountId: `acct-${seq}`, name: "Chequing", plaidType: "depository" },
      })
    ).id;
  });

  function stage(name: string, amountCents: number, firstSeenAt: Date) {
    return db.plaidStagedTransaction.create({
      data: {
        userId,
        plaidItemId: itemId,
        plaidAccountRowId: accountRowId,
        plaidTransactionId: `${name}-${seq}-${firstSeenAt.getTime()}`,
        name,
        amountCents,
        type: TransactionType.EXPENSE,
        currency: "CAD",
        date: new Date("2026-10-20T00:00:00Z"),
        firstSeenAt,
      },
    });
  }

  async function setting() {
    return db.chargeAlertSetting.findUniqueOrThrow({
      where: { userId },
      include: { user: { select: { email: true, countryCode: true } } },
    });
  }

  it("emails each charge once, and again on the next tick when sending failed", async () => {
    await stage("Old laptop", 90_000, new Date(Date.now() - 60_000));
    await actions.setChargeAlertsAction(formData({ threshold: "500", unusual: "false" }));
    await stage("TV", 120_000, new Date(Date.now() + 1_000));
    const now = new Date(Date.now() + 10_000);

    const failing = vi.fn(async () => ({ sent: false }));
    expect(await alerts.sendChargeAlerts(await setting(), now, { client: db, send: failing })).toBe("failed");

    const send = vi.fn(async (_: { to: string; subject: string; text: string }) => ({ sent: true }));
    expect(await alerts.sendChargeAlerts(await setting(), now, { client: db, send })).toBe("sent");
    expect(await alerts.sendChargeAlerts(await setting(), now, { client: db, send })).toBe("none");

    expect(send).toHaveBeenCalledTimes(1);
    // The laptop was in the queue before alerts were turned on, so it is not news.
    expect(send.mock.calls[0][0].subject).toBe("Large charge: $1,200.00 at TV");
  });

  it("keeps its place when the threshold is changed, so nothing already seen is emailed again", async () => {
    await actions.setChargeAlertsAction(formData({ threshold: "500", unusual: "false" }));
    const first = (await setting()).checkedThrough;
    await stage("TV", 120_000, new Date(first.getTime() + 1_000));
    const send = vi.fn(async () => ({ sent: true }));
    await alerts.sendChargeAlerts(await setting(), new Date(first.getTime() + 5_000), { client: db, send });

    await actions.setChargeAlertsAction(formData({ threshold: "100", unusual: "true" }));
    await alerts.sendChargeAlerts(await setting(), new Date(first.getTime() + 10_000), { client: db, send });
    expect(send).toHaveBeenCalledTimes(1);
  });
});

function formData(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}
