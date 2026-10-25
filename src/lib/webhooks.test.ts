import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { copyMigratedDatabase } from "@/test-support/migrated-db";

vi.mock("next/server", () => ({ after: () => { throw new Error("outside a request"); } }));

const dir = mkdtempSync(join(tmpdir(), "webhooks-"));
const url = `file:${join(dir, "webhooks.db")}`;
let db: PrismaClient;
let hooks: typeof import("./webhooks");

beforeAll(async () => {
  copyMigratedDatabase(url);
  process.env.DATABASE_URL = url;
  ({ prisma: db } = await import("@/lib/prisma"));
  hooks = await import("./webhooks");
});

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

let seq = 0;
let userId: string;
const SECRET = "whsec_test_secret";

beforeEach(async () => {
  seq += 1;
  userId = (await db.user.create({ data: { email: `w${seq}@example.test`, displayName: "Test", timezone: "UTC" } })).id;
});

function endpoint(events: string, extra: Record<string, unknown> = {}) {
  return db.webhookEndpoint.create({
    data: { userId, url: "https://hooks.example.test/in", events, secretEncrypted: hooks.encryptWebhookSecret(SECRET), ...extra },
  });
}

type Call = { url: string; init: RequestInit };
function fakeFetch(statuses: number[]) {
  const calls: Call[] = [];
  const fn = vi.fn(async (u: string, init: RequestInit) => {
    calls.push({ url: u, init });
    const status = statuses.length > 1 ? statuses.shift()! : (statuses[0] ?? 200);
    return { ok: status >= 200 && status < 300, status };
  });
  return { fn, calls };
}

describe("queueing", () => {
  it("queues only for enabled endpoints subscribed to the event, and a deduped event once", async () => {
    const wants = await endpoint("budget.over,sync.failed");
    await endpoint("sync.failed");
    await endpoint("budget.over", { enabled: false });
    const first = await hooks.enqueueWebhookEvent(db, userId, "budget.over", { a: 1 }, { dedupeKey: "k1" });
    const again = await hooks.enqueueWebhookEvent(db, userId, "budget.over", { a: 1 }, { dedupeKey: "k1" });
    expect(first).toHaveLength(1);
    expect(again).toHaveLength(0);
    const rows = await db.webhookDelivery.findMany({ where: { endpoint: { userId } } });
    expect(rows.map((r) => r.endpointId)).toEqual([wants.id]);
    expect(JSON.parse(rows[0].payload)).toMatchObject({ event: "budget.over", data: { a: 1 } });
  });
});

describe("delivery", () => {
  it("signs the exact body with the endpoint's secret and records success", async () => {
    const ep = await endpoint("sync.failed");
    const [id] = await hooks.enqueueWebhookEvent(db, userId, "sync.failed", { bank: "Test" });
    const { fn, calls } = fakeFetch([204]);
    const now = new Date("2026-10-25T12:00:00Z");
    expect(await hooks.attemptDelivery(db, id, { fetch: fn, now })).toBe("delivered");

    const headers = calls[0].init.headers as Record<string, string>;
    const body = calls[0].init.body as string;
    const t = Math.floor(now.getTime() / 1000);
    const expected = createHmac("sha256", SECRET).update(`${t}.${body}`).digest("hex");
    expect(headers["x-webhook-signature"]).toBe(`t=${t},v1=${expected}`);
    expect(headers["x-webhook-event"]).toBe("sync.failed");
    expect((await db.webhookDelivery.findUniqueOrThrow({ where: { id } })).deliveredAt).toEqual(now);
    expect((await db.webhookEndpoint.findUniqueOrThrow({ where: { id: ep.id } })).lastStatus).toBe(204);
  });

  it("retries a failure on the sweep with growing gaps, then gives up", async () => {
    await endpoint("sync.failed");
    const [id] = await hooks.enqueueWebhookEvent(db, userId, "sync.failed", {});
    const { fn } = fakeFetch([500]);
    let now = new Date("2026-10-25T12:00:00Z");
    expect(await hooks.attemptDelivery(db, id, { fetch: fn, now })).toBe("failed");
    let row = await db.webhookDelivery.findUniqueOrThrow({ where: { id } });
    expect(row.attempts).toBe(1);
    expect(row.nextAttemptAt.getTime() - now.getTime()).toBe(60_000);

    // Not due yet: the sweep leaves it.
    await hooks.runWebhookSweep(new Date(now.getTime() + 30_000), { client: db, fetch: fn });
    expect((await db.webhookDelivery.findUniqueOrThrow({ where: { id } })).attempts).toBe(1);

    for (let i = 0; i < 10; i += 1) {
      now = new Date(now.getTime() + 13 * 3_600_000);
      await hooks.runWebhookSweep(now, { client: db, fetch: fn });
    }
    row = await db.webhookDelivery.findUniqueOrThrow({ where: { id } });
    expect(row.attempts).toBe(hooks.MAX_WEBHOOK_ATTEMPTS);
    expect(row.deliveredAt).toBeNull();
    expect(row.lastError).toBe("HTTP 500");
  });
});

describe("events raised by the app", () => {
  it("bill.due goes out once for a bill due tomorrow", async () => {
    await endpoint("bill.due");
    const category = await db.category.create({ data: { userId, name: "Bills", kind: "EXPENSE" } });
    const account = await db.account.create({ data: { userId, name: "Chequing", type: "CHEQUING" } });
    await db.recurringTransaction.create({
      data: {
        userId,
        accountId: account.id,
        categoryId: category.id,
        type: "EXPENSE",
        name: "Phone",
        amountCents: 5_000,
        cadence: "MONTHLY",
        nextExpectedDate: new Date("2026-10-26T00:00:00Z"),
      },
    });
    const now = new Date("2026-10-25T12:00:00Z");
    expect(await hooks.enqueueBillDueEvents(db, now)).toBe(1);
    expect(await hooks.enqueueBillDueEvents(db, now)).toBe(0);
    const row = await db.webhookDelivery.findFirstOrThrow({ where: { endpoint: { userId } } });
    expect(JSON.parse(row.payload).data).toMatchObject({ name: "Phone", amountCents: 5_000, dueDate: "2026-10-26" });
  });

  it("budget.over goes out once per month and category when spending passes the limit", async () => {
    await endpoint("budget.over");
    const category = await db.category.create({ data: { userId, name: "Food", kind: "EXPENSE" } });
    await db.budget.create({ data: { userId, categoryId: category.id, periodMonth: "2026-10", limitCents: 10_000 } });
    await db.transaction.create({
      data: { userId, categoryId: category.id, type: "EXPENSE", amountCents: 12_000, date: new Date("2026-10-10T00:00:00Z") },
    });
    const now = new Date("2026-10-25T12:00:00Z");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200 })));
    expect(await hooks.dispatchBudgetOverWebhooks(db, userId, now)).toBe(1);
    expect(await hooks.dispatchBudgetOverWebhooks(db, userId, now)).toBe(0);
    vi.unstubAllGlobals();
    const row = await db.webhookDelivery.findFirstOrThrow({ where: { endpoint: { userId } } });
    expect(JSON.parse(row.payload).data).toMatchObject({ category: "Food", spentCents: 12_000, limitCents: 10_000 });
  });
});

describe("input checks", () => {
  it("accepts http(s) URLs only, without credentials, and at least one known event", () => {
    expect(hooks.parseWebhookUrl("http://192.168.1.5:8123/api/webhook/x")).toBe("http://192.168.1.5:8123/api/webhook/x");
    expect(() => hooks.parseWebhookUrl("ftp://x.test")).toThrow();
    expect(() => hooks.parseWebhookUrl("https://user:pw@x.test")).toThrow();
    expect(() => hooks.parseWebhookEvents(["nope"])).toThrow();
    expect(hooks.parseWebhookEvents(["bill.due", "nope"])).toEqual(["bill.due"]);
  });
});
