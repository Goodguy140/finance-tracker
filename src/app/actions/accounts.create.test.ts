import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * A hand-added account takes the user's home currency. The schema default is CAD, which put
 * every non-Canadian user's new account outside their home-currency totals.
 */

const dir = mkdtempSync(join(tmpdir(), "account-create-"));
const url = `file:${join(dir, "accounts.db")}`;
let db: PrismaClient;
let actions: typeof import("./accounts");

const session = vi.hoisted(() => ({ userId: "", countryCode: "CA" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/lib/session", () => ({
  requireUser: vi.fn(async () => ({ id: session.userId, countryCode: session.countryCode })),
}));

beforeAll(async () => {
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: url },
    stdio: "ignore",
  });
  process.env.DATABASE_URL = url;
  ({ prisma: db } = await import("@/lib/prisma"));
  actions = await import("./accounts");
}, 120_000);

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

describe("createFinancialAccountAction", () => {
  it.each([
    ["JP", "JPY"],
    ["CA", "CAD"],
  ])("gives a %s user's new account %s", async (countryCode, currency) => {
    session.countryCode = countryCode;
    session.userId = (
      await db.user.create({ data: { email: `${countryCode}@example.test`, displayName: "Test", countryCode } })
    ).id;
    const data = new FormData();
    data.set("name", "Savings");
    data.set("type", "SAVINGS");

    expect(await actions.createFinancialAccountAction(data)).toBeUndefined();

    const account = await db.account.findFirstOrThrow({ where: { userId: session.userId } });
    expect(account).toMatchObject({ currency, countryCode });
  });
});
