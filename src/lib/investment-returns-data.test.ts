import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { copyMigratedDatabase } from "@/test-support/migrated-db";

const dir = mkdtempSync(join(tmpdir(), "investment-returns-"));
const url = `file:${join(dir, "returns.db")}`;
let db: PrismaClient;
let load: typeof import("./investment-returns-data").loadInvestmentReturns;

beforeAll(async () => {
  copyMigratedDatabase(url);
  process.env.DATABASE_URL = url;
  ({ prisma: db } = await import("@/lib/prisma"));
  ({ loadInvestmentReturns: load } = await import("./investment-returns-data"));
});

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

const day = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

describe("investment returns from the database", () => {
  it("counts a contribution recorded from a transfer once, and other transfers in as money put in", async () => {
    const user = await db.user.create({ data: { email: "returns@example.test", displayName: "T", countryCode: "CA", timezone: "UTC" } });
    const category = await db.category.create({ data: { userId: user.id, name: "Transfers", kind: "EXPENSE" } });
    const [chq, tfsa] = await Promise.all([
      db.account.create({ data: { userId: user.id, name: "Chequing", type: "CHEQUING" } }),
      db.account.create({ data: { userId: user.id, name: "My TFSA", type: "TFSA" } }),
    ]);
    const transfer = (ymd: string, cents: number) =>
      db.transaction.create({
        data: { userId: user.id, accountId: chq.id, transferAccountId: tfsa.id, categoryId: category.id, type: "TRANSFER", amountCents: cents, date: day(ymd) },
      });
    const counted = await transfer("2025-03-01", 200_000);
    await db.investmentFlow.create({
      data: { userId: user.id, accountId: tfsa.id, date: day("2025-03-01"), direction: "CONTRIBUTION", amountCents: 200_000, transactionId: counted.id },
    });
    await transfer("2025-09-01", 100_000);
    await db.portfolioSnapshot.createMany({
      data: [
        { userId: user.id, accountId: tfsa.id, date: day("2025-01-01"), totalValueCents: 1_000_000 },
        { userId: user.id, accountId: tfsa.id, date: day("2025-12-31"), totalValueCents: 1_400_000 },
      ],
    });

    const returns = await load(user);
    expect(returns.accounts.map((a) => a.name)).toEqual(["My TFSA"]);
    expect(returns.accounts[0].windows.sinceStart).toMatchObject({ netContributedCents: 300_000, growthCents: 100_000 });
  });
});
