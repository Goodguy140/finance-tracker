import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { copyMigratedDatabase } from "@/test-support/migrated-db";

/** Webhook settings actions, and the app actions that raise events, against a migrated database. */

const dir = mkdtempSync(join(tmpdir(), "webhook-actions-"));
const url = `file:${join(dir, "w.db")}`;
let db: PrismaClient;
let webhookActions: typeof import("./webhooks");
let txActions: typeof import("./transactions");

const session = vi.hoisted(() => ({ userId: "" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("next/server", () => ({ after: () => { throw new Error("outside a request"); } }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: session.userId })) }));
vi.mock("@/lib/budget-alert-dispatch", () => ({ scheduleBudgetAlertEmails: vi.fn() }));

const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));

beforeAll(async () => {
  copyMigratedDatabase(url);
  process.env.DATABASE_URL = url;
  vi.stubGlobal("fetch", fetchMock);
  ({ prisma: db } = await import("@/lib/prisma"));
  webhookActions = await import("./webhooks");
  txActions = await import("./transactions");
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

let seq = 0;
beforeEach(async () => {
  seq += 1;
  session.userId = (await db.user.create({ data: { email: `wa${seq}@example.test`, displayName: "Test" } })).id;
  fetchMock.mockClear();
});

function form(entries: Array<[string, string]>) {
  const data = new FormData();
  for (const [k, v] of entries) data.append(k, v);
  return data;
}

describe("webhook settings and events", () => {
  it("creates an endpoint with a one-time secret, and an added expense is posted to it", async () => {
    const state = await webhookActions.createWebhookAction(
      { ok: null },
      form([["url", "https://hooks.example.test/x"], ["events", "transaction.created"]]),
    );
    expect(state).toMatchObject({ ok: true, url: "https://hooks.example.test/x" });
    const stored = await db.webhookEndpoint.findFirstOrThrow({ where: { userId: session.userId } });
    // Only the encrypted copy is kept.
    expect(stored.secretEncrypted).not.toContain(state.ok === true ? state.secret : "x");

    const account = await db.account.create({ data: { userId: session.userId, name: "Chequing", type: "CHEQUING" } });
    const category = await db.category.create({ data: { userId: session.userId, name: "Food", kind: "EXPENSE" } });
    const res = await txActions.createExpenseAction(
      form([["accountId", account.id], ["categoryId", category.id], ["date", "2026-10-10"], ["amount", "12.50"], ["title", "Lunch"], ["note", ""]]),
    );
    expect(res).toBeUndefined(); // success returns nothing; failures return { ok: false }
    await expect
      .poll(() => db.webhookDelivery.findFirst({ where: { endpointId: stored.id, deliveredAt: { not: null } } }))
      .not.toBeNull();
    const row = await db.webhookDelivery.findFirstOrThrow({ where: { endpointId: stored.id } });
    expect(JSON.parse(row.payload)).toMatchObject({ event: "transaction.created", data: { amountCents: 1_250, title: "Lunch" } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses a bad URL and an endpoint with no events", async () => {
    expect(await webhookActions.createWebhookAction({ ok: null }, form([["url", "javascript:alert(1)"], ["events", "bill.due"]]))).toMatchObject({ ok: false });
    expect(await webhookActions.createWebhookAction({ ok: null }, form([["url", "https://x.test/h"]]))).toMatchObject({ ok: false });
    expect(await db.webhookEndpoint.count({ where: { userId: session.userId } })).toBe(0);
  });

  it("never deletes another user's webhook", async () => {
    const other = await db.user.create({ data: { email: `wo${seq}@example.test`, displayName: "Other" } });
    const theirs = await db.webhookEndpoint.create({
      data: { userId: other.id, url: "https://x.test/h", events: "bill.due", secretEncrypted: "x" },
    });
    expect(await webhookActions.deleteWebhookAction(form([["endpointId", theirs.id]]))).toMatchObject({ ok: false });
    expect(await db.webhookEndpoint.count({ where: { id: theirs.id } })).toBe(1);
  });
});
