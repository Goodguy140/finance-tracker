import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { copyMigratedDatabase } from "@/test-support/migrated-db";

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/lib/audit-log", () => ({ AUDIT_ACTIONS: {}, recordAuditLog: vi.fn() }));
vi.mock("@/lib/budget-alert-dispatch", () => ({ scheduleBudgetAlertEmails: vi.fn() }));
const caller = vi.hoisted(() => ({ user: { id: "", timezone: "America/Toronto" }, kind: "device" as "device" | "token" }));
vi.mock("@/lib/api-v1/route-auth", () => ({
  NO_STORE: {},
  authorizeApiRequest: vi.fn(async () => ({ ok: true, auth: { user: caller.user, token: { kind: caller.kind, id: "tok" } } })),
}));

const dir = mkdtempSync(join(tmpdir(), "api-v1-post-"));
const url = `file:${join(dir, "api.db")}`;
let db: PrismaClient;
let POST: typeof import("./route").POST;

beforeAll(async () => {
  copyMigratedDatabase(url);
  process.env.DATABASE_URL = url;
  ({ prisma: db } = await import("@/lib/prisma"));
  ({ POST } = await import("./route"));
});

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

let seq = 0;
beforeEach(async () => {
  seq += 1;
  const user = await db.user.create({ data: { email: `post${seq}@example.test`, displayName: "Post", timezone: "America/Toronto" } });
  caller.user = { id: user.id, timezone: "America/Toronto" };
  caller.kind = "device";
});

const post = (body: unknown, key?: string) =>
  POST(
    new Request("http://localhost/api/v1/transactions", {
      method: "POST",
      headers: { "content-type": "application/json", ...(key ? { "idempotency-key": key } : {}) },
      body: JSON.stringify(body),
    }),
  );
const rows = () => db.transaction.count({ where: { userId: caller.user.id } });

describe("POST /api/v1/transactions", () => {
  it("adds once for a repeated Idempotency-Key, answering the retry with the entry already made", async () => {
    const key = `retry-${seq}-0123456789abcdef`;
    const first = await post({ type: "expense", amount: "12.50", title: "Lunch" }, key);
    expect(first.status).toBe(201);
    const made = (await first.json()).transaction;

    const retry = await post({ type: "expense", amount: "12.50", title: "Lunch" }, key);
    expect(retry.status).toBe(200);
    expect(retry.headers.get("Idempotent-Replayed")).toBe("true");
    expect((await retry.json()).transaction).toMatchObject({ id: made.id, amountCents: 1250, title: "Lunch" });
    expect(await rows()).toBe(1);

    // Without a key, or with a new one, each add is its own.
    expect((await post({ type: "expense", amount: 3 })).status).toBe(201);
    expect((await post({ type: "expense", amount: 3 }, `other-${seq}-0123456789abcdef`)).status).toBe(201);
    expect(await rows()).toBe(3);
  });

  it("lets a key go when the add is refused, and says so when the entry it made was deleted since", async () => {
    const key = `refused-${seq}-0123456789abcdef`;
    expect((await post({ type: "expense" }, key)).status).toBe(400);
    const corrected = await post({ type: "expense", amount: 8 }, key);
    expect(corrected.status).toBe(201);

    await db.transaction.delete({ where: { id: (await corrected.json()).transaction.id } });
    const again = await post({ type: "expense", amount: 8 }, key);
    expect(again.status).toBe(409);
    expect((await again.json()).error).toMatch(/deleted/);
    expect(await rows()).toBe(0);
  });

  it("refuses a malformed key before adding anything", async () => {
    const res = await post({ type: "expense", amount: 1 }, "short");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Idempotency-Key/);
    expect(await rows()).toBe(0);
  });

  it("leaves the phone's adds out of Needs review, and puts a script's in it", async () => {
    const phone = await post({ type: "expense", amount: 2 });
    caller.kind = "token";
    const script = await post({ type: "expense", amount: 2 });
    expect((await phone.json()).transaction.needsReview).toBe(false);
    expect((await script.json()).transaction.needsReview).toBe(true);
  });
});
