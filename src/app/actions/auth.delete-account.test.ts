import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient, User } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Deleting your own account from Settings. The admin user list refuses an admin acting on
 * themselves and sends them here, so this path must not let the last admin delete themselves.
 */

const dir = mkdtempSync(join(tmpdir(), "delete-account-"));
const url = `file:${join(dir, "delete.db")}`;
let db: PrismaClient;
let actions: typeof import("./auth");

const session = vi.hoisted(() => ({ user: null as User | null }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => session.user) }));
vi.mock("@/lib/plaid/service", () => ({ tryMakePlaidItemRevoker: vi.fn(async () => null) }));

beforeAll(async () => {
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: url },
    stdio: "ignore",
  });
  process.env.DATABASE_URL = url;
  ({ prisma: db } = await import("@/lib/prisma"));
  actions = await import("./auth");
}, 120_000);

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  await db.user.deleteMany();
});

let seq = 0;
function makeUser(role: "SERVER_ADMIN" | "USER", disabledAt: Date | null = null) {
  seq += 1;
  return db.user.create({ data: { email: `u${seq}@example.test`, displayName: "Test", role, disabledAt } });
}

function confirmed() {
  const data = new FormData();
  data.set("confirmation", "DELETE");
  return data;
}

describe("deleteAccountAction", () => {
  it("refuses the only admin who can sign in", async () => {
    session.user = await makeUser("SERVER_ADMIN");
    // A suspended admin cannot sign in, so does not count as someone left to run the server.
    await makeUser("SERVER_ADMIN", new Date());

    expect(await actions.deleteAccountAction(confirmed())).toEqual({
      ok: false,
      error: expect.stringContaining("only server admin"),
    });
    expect(await db.user.count({ where: { id: session.user.id } })).toBe(1);
  });

  it("lets an admin go while another admin can still sign in", async () => {
    session.user = await makeUser("SERVER_ADMIN");
    await makeUser("SERVER_ADMIN");

    expect(await actions.deleteAccountAction(confirmed())).toBeUndefined();
    expect(await db.user.count({ where: { id: session.user.id } })).toBe(0);
  });

  it("lets an ordinary user delete themselves", async () => {
    await makeUser("SERVER_ADMIN");
    session.user = await makeUser("USER");

    expect(await actions.deleteAccountAction(confirmed())).toBeUndefined();
    expect(await db.user.count({ where: { id: session.user.id } })).toBe(0);
  });
});
