import { createHmac, randomBytes } from "node:crypto";
import { Prisma, TransactionType, type PrismaClient } from "@prisma/client";
import { after } from "next/server";
import { forecastRecurringOccurrences } from "@/lib/bills-forecast";
import { buildMonthlyBudgetProgress } from "@/lib/budget-progress";
import { ymdFromDateUtc } from "@/lib/date-only";
import { currentYmdInTimeZone } from "@/lib/period-month";
import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret } from "@/lib/security";

/**
 * Outbound webhooks: signed JSON POSTs to URLs the user sets in Settings → Developer, for
 * Home Assistant, n8n, ntfy and the like.
 *
 * Each event becomes one `WebhookDelivery` row per subscribed endpoint, sent straight after the
 * action that raised it and retried by the hourly sweep with growing gaps until it gets a 2xx or
 * runs out of attempts. Events that must go out once (a budget going over, a bill falling due)
 * carry a `dedupeKey`, unique per endpoint, so raising them again is harmless.
 *
 * Signature: `X-Webhook-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">` with
 * the endpoint's secret, shown once when it is created. Receivers should check it and reject
 * an old `t` to stop replays.
 *
 * The URL may be on the local network: that is the point for a self-hosted app (Home Assistant
 * on the LAN). Only http and https are accepted.
 */

export { WEBHOOK_EVENTS, WEBHOOK_EVENT_LABELS, type WebhookEvent } from "./webhook-events";
import { WEBHOOK_EVENTS, type WebhookEvent } from "./webhook-events";

export const MAX_WEBHOOK_ENDPOINTS = 10;
export const MAX_WEBHOOK_ATTEMPTS = 6;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 12 * 3_600_000];
const DELIVERY_TIMEOUT_MS = 10_000;
const KEEP_DELIVERED_DAYS = 30;

export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString("base64url")}`;
}

export function signWebhookBody(secret: string, timestamp: number, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export function signatureHeader(secret: string, timestamp: number, body: string): string {
  return `t=${timestamp},v1=${signWebhookBody(secret, timestamp, body)}`;
}

/** The delay before the next attempt after `attempts` failed ones; null when out of attempts. */
export function retryDelayMs(attempts: number): number | null {
  if (attempts >= MAX_WEBHOOK_ATTEMPTS) return null;
  return RETRY_DELAYS_MS[Math.min(attempts - 1, RETRY_DELAYS_MS.length - 1)];
}

export function parseWebhookUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("Enter a full URL, such as https://example.com/hook.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("A webhook URL must start with http:// or https://.");
  if (url.username || url.password) throw new Error("Leave credentials out of the URL; check the signature instead.");
  if (url.toString().length > 500) throw new Error("Keep the URL under 500 characters.");
  return url.toString();
}

export function parseWebhookEvents(values: readonly string[]): WebhookEvent[] {
  const picked = WEBHOOK_EVENTS.filter((e) => values.includes(e));
  if (picked.length === 0) throw new Error("Pick at least one event.");
  return picked;
}

export function encryptWebhookSecret(secret: string): string {
  return encryptSecret(secret);
}

/** Queues `event` for each of the user's enabled endpoints that want it. Returns the new delivery ids. */
export async function enqueueWebhookEvent(
  client: PrismaClient,
  userId: string,
  event: WebhookEvent,
  data: Record<string, unknown>,
  options: { dedupeKey?: string; now?: Date } = {},
): Promise<string[]> {
  const endpoints = await client.webhookEndpoint.findMany({
    where: { userId, enabled: true },
    select: { id: true, events: true },
  });
  const now = options.now ?? new Date();
  const ids: string[] = [];
  for (const endpoint of endpoints) {
    if (!endpoint.events.split(",").includes(event)) continue;
    const payload = JSON.stringify({ event, createdAt: now.toISOString(), data });
    try {
      const row = await client.webhookDelivery.create({
        data: { endpointId: endpoint.id, event, payload, dedupeKey: options.dedupeKey ?? null, nextAttemptAt: now },
        select: { id: true },
      });
      ids.push(row.id);
    } catch (err) {
      // Already queued for this endpoint: an event that goes out once.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue;
      throw err;
    }
  }
  return ids;
}

type FetchLike = (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number }>;

/** Tries one delivery now; records the outcome on it and its endpoint. */
export async function attemptDelivery(
  client: PrismaClient,
  deliveryId: string,
  deps: { fetch?: FetchLike; now?: Date } = {},
): Promise<"delivered" | "failed" | "gone"> {
  const delivery = await client.webhookDelivery.findUnique({
    where: { id: deliveryId },
    include: { endpoint: true },
  });
  if (!delivery || delivery.deliveredAt || !delivery.endpoint.enabled) return "gone";
  const now = deps.now ?? new Date();
  const doFetch: FetchLike = deps.fetch ?? ((url, init) => fetch(url, init));
  const timestamp = Math.floor(now.getTime() / 1000);
  let status: number | null = null;
  let error: string | null = null;
  try {
    const secret = decryptSecret(delivery.endpoint.secretEncrypted);
    const res = await doFetch(delivery.endpoint.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "finance-tracker-webhooks/1",
        "x-webhook-event": delivery.event,
        "x-webhook-delivery": delivery.id,
        "x-webhook-signature": signatureHeader(secret, timestamp, delivery.payload),
      },
      body: delivery.payload,
      redirect: "manual",
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    status = res.status;
    if (!res.ok) error = `HTTP ${res.status}`;
  } catch (err) {
    error = err instanceof Error ? err.message.slice(0, 200) : "Request failed";
  }

  const attempts = delivery.attempts + 1;
  if (!error) {
    await client.webhookDelivery.update({ where: { id: delivery.id }, data: { attempts, deliveredAt: now, lastError: null } });
    await client.webhookEndpoint.update({
      where: { id: delivery.endpointId },
      data: { lastDeliveredAt: now, lastStatus: status, lastError: null },
    });
    return "delivered";
  }
  const delay = retryDelayMs(attempts);
  await client.webhookDelivery.update({
    where: { id: delivery.id },
    data: {
      attempts,
      lastError: error,
      // Out of attempts: parked far in the future, kept for the record until pruned.
      nextAttemptAt: new Date(now.getTime() + (delay ?? 365 * 86_400_000)),
    },
  });
  await client.webhookEndpoint.update({ where: { id: delivery.endpointId }, data: { lastStatus: status, lastError: error } });
  return "failed";
}

/**
 * Raises an event from an action: queued now, sent once the response is on its way (`after`),
 * or in the background outside a request. Never throws: a webhook must not break the action.
 */
export function emitWebhookEvent(
  userId: string,
  event: WebhookEvent,
  data: Record<string, unknown>,
  options: { dedupeKey?: string; client?: PrismaClient } = {},
): void {
  const client = options.client ?? prisma;
  const run = async () => {
    try {
      const ids = await enqueueWebhookEvent(client, userId, event, data, { dedupeKey: options.dedupeKey });
      for (const id of ids) await attemptDelivery(client, id);
    } catch (err) {
      console.error(`[webhooks] ${event} failed`, err);
    }
  };
  try {
    after(run);
  } catch {
    void run();
  }
}

/**
 * Queues `budget.over` for each of this month's budgets now over its limit (rollover included),
 * once per month and category, and sends them. Run after spending changes, like the alert emails.
 */
export async function dispatchBudgetOverWebhooks(client: PrismaClient, userId: string, now = new Date()): Promise<number> {
  const hasEndpoint = await client.webhookEndpoint.count({ where: { userId, enabled: true, events: { contains: "budget.over" } } });
  if (hasEndpoint === 0) return 0;
  const user = await client.user.findUnique({ where: { id: userId }, select: { timezone: true } });
  const ym = currentYmdInTimeZone(user?.timezone, now).slice(0, 7);
  const progress = await buildMonthlyBudgetProgress(userId, ym, client);
  let sent = 0;
  for (const row of progress.budgets) {
    if (row.limitCents <= 0 || row.spentCents <= row.limitCents) continue;
    const ids = await enqueueWebhookEvent(
      client,
      userId,
      "budget.over",
      {
        month: ym,
        categoryId: row.categoryId,
        category: row.categoryName,
        spentCents: row.spentCents,
        limitCents: row.limitCents,
        currency: progress.currency,
      },
      { dedupeKey: `budget.over:${ym}:${row.categoryId}`, now },
    );
    for (const id of ids) if ((await attemptDelivery(client, id, { now })) === "delivered") sent += 1;
  }
  return sent;
}

/** Queues `bill.due` for each recurring bill due tomorrow, once per bill and date. */
export async function enqueueBillDueEvents(client: PrismaClient, now: Date): Promise<number> {
  const endpoints = await client.webhookEndpoint.findMany({
    where: { enabled: true, events: { contains: "bill.due" } },
    select: { userId: true, user: { select: { timezone: true } } },
  });
  let queued = 0;
  for (const { userId, user } of new Map(endpoints.map((e) => [e.userId, e])).values()) {
    const todayYmd = currentYmdInTimeZone(user.timezone, now);
    const rules = await client.recurringTransaction.findMany({
      where: { userId, enabled: true, type: TransactionType.EXPENSE },
      select: {
        id: true,
        name: true,
        type: true,
        amountCents: true,
        cadence: true,
        nextExpectedDate: true,
        anchorDay: true,
        endDate: true,
        enabled: true,
        account: { select: { currency: true } },
      },
    });
    const { occurrences } = forecastRecurringOccurrences(rules, { todayYmd, currentYm: todayYmd.slice(0, 7), days: 1 });
    for (const o of occurrences) {
      const dueYmd = ymdFromDateUtc(o.date);
      if (o.overdue || dueYmd === todayYmd) continue;
      const ids = await enqueueWebhookEvent(
        client,
        userId,
        "bill.due",
        { recurringId: o.rule.id, name: o.rule.name, amountCents: o.rule.amountCents, currency: o.rule.account.currency, dueDate: dueYmd },
        { dedupeKey: `bill.due:${o.rule.id}:${dueYmd}`, now },
      );
      queued += ids.length;
    }
  }
  return queued;
}

/** One hourly tick: queue bills due tomorrow, retry what is due, prune old deliveries. */
export async function runWebhookSweep(
  now = new Date(),
  deps: { client?: PrismaClient; fetch?: FetchLike } = {},
): Promise<{ ok: boolean; message: string; delivered: number }> {
  const client = deps.client ?? prisma;
  await enqueueBillDueEvents(client, now);
  const due = await client.webhookDelivery.findMany({
    where: { deliveredAt: null, attempts: { lt: MAX_WEBHOOK_ATTEMPTS }, nextAttemptAt: { lte: now } },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: 500,
  });
  let delivered = 0;
  let failed = 0;
  for (const { id } of due) {
    const outcome = await attemptDelivery(client, id, { fetch: deps.fetch, now });
    if (outcome === "delivered") delivered += 1;
    if (outcome === "failed") failed += 1;
  }
  await client.webhookDelivery.deleteMany({
    where: { createdAt: { lt: new Date(now.getTime() - KEEP_DELIVERED_DAYS * 86_400_000) } },
  });
  return { ok: true, message: `Webhooks: ${delivered} delivered${failed ? `, ${failed} failed` : ""}`, delivered };
}

/** "Send test": one `ping` delivery to the endpoint now, whatever events it is set to. */
export async function sendTestWebhook(
  client: PrismaClient,
  endpointId: string,
  deps: { fetch?: FetchLike; now?: Date } = {},
): Promise<{ delivered: boolean; error: string | null }> {
  const now = deps.now ?? new Date();
  const row = await client.webhookDelivery.create({
    data: {
      endpointId,
      event: "ping",
      payload: JSON.stringify({ event: "ping", createdAt: now.toISOString(), data: { message: "Test from Settings → Developer" } }),
      // Not retried by the sweep: a test is answered on the spot.
      attempts: MAX_WEBHOOK_ATTEMPTS - 1,
      nextAttemptAt: now,
    },
    select: { id: true },
  });
  const outcome = await attemptDelivery(client, row.id, deps);
  if (outcome === "delivered") return { delivered: true, error: null };
  const after = await client.webhookDelivery.findUnique({ where: { id: row.id }, select: { lastError: true } });
  return { delivered: false, error: after?.lastError ?? "Not sent" };
}
