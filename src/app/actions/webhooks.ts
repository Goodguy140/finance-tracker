"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { AUDIT_ACTIONS, recordAuditLog } from "@/lib/audit-log";
import { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { enforceSlidingWindowRateLimit } from "@/lib/rate-limit";
import { IdentityConfirmationRequiredError, requireRecentIdentity } from "@/lib/recent-identity";
import { requireUser } from "@/lib/session";
import { assertWebhookDestination } from "@/lib/webhook-address";
import {
  encryptWebhookSecret,
  generateWebhookSecret,
  MAX_WEBHOOK_ENDPOINTS,
  parseWebhookEvents,
  parseWebhookUrl,
  sendTestWebhook,
} from "@/lib/webhooks";
import { formAction, formActionWithResult, getFormValue } from "./_helpers";

export type CreateWebhookState = { ok: null } | { ok: true; secret: string; url: string } | { ok: false; error: string };

/**
 * Adds an endpoint and returns its signing secret **once**; only the encrypted copy is kept.
 *
 * A webhook sends the user's entries to an outside address and keeps going after "sign out
 * everywhere", so making one needs a recent "confirm it's you", like an API token or the
 * calendar link: a stolen session cookie alone must not be enough.
 */
export async function createWebhookAction(_prev: CreateWebhookState, formData: FormData): Promise<CreateWebhookState> {
  let user: Awaited<ReturnType<typeof requireRecentIdentity>>["user"];
  try {
    ({ user } = await requireRecentIdentity());
  } catch (err) {
    if (err instanceof IdentityConfirmationRequiredError) return { ok: false, error: err.message };
    throw err;
  }
  let url: string;
  let events: string[];
  try {
    url = parseWebhookUrl(getFormValue(formData, "url"));
    events = parseWebhookEvents(formData.getAll("events").map(String));
    await assertWebhookDestination(url, { allowLocal: user.role === UserRole.SERVER_ADMIN });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Check the form." };
  }
  if ((await prisma.webhookEndpoint.count({ where: { userId: user.id } })) >= MAX_WEBHOOK_ENDPOINTS) {
    return { ok: false, error: `Up to ${MAX_WEBHOOK_ENDPOINTS} webhooks. Delete one first.` };
  }
  const secret = generateWebhookSecret();
  const created = await prisma.webhookEndpoint.create({
    data: { userId: user.id, url, events: events.join(","), secretEncrypted: encryptWebhookSecret(secret) },
    select: { id: true },
  });
  await recordAuditLog(prisma, {
    userId: user.id,
    action: AUDIT_ACTIONS.webhook_created,
    targetType: "webhook_endpoint",
    targetId: created.id,
    metadata: { host: new URL(url).host, events },
    headers: await headers(),
  });
  revalidatePath("/settings/developer");
  return { ok: true, secret, url };
}

async function ownEndpoint(userId: string, formData: FormData) {
  const endpoint = await prisma.webhookEndpoint.findFirst({
    where: { id: getFormValue(formData, "endpointId"), userId },
    select: { id: true, url: true },
  });
  if (!endpoint) throw new Error("Webhook not found.");
  return endpoint;
}

export const deleteWebhookAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const endpoint = await ownEndpoint(user.id, formData);
  await prisma.webhookEndpoint.delete({ where: { id: endpoint.id } });
  await recordAuditLog(prisma, {
    userId: user.id,
    action: AUDIT_ACTIONS.webhook_deleted,
    targetType: "webhook_endpoint",
    targetId: endpoint.id,
    metadata: { host: new URL(endpoint.url).host },
    headers: await headers(),
  });
  revalidatePath("/settings/developer");
});

export const setWebhookEnabledAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const endpoint = await ownEndpoint(user.id, formData);
  await prisma.webhookEndpoint.update({
    where: { id: endpoint.id },
    data: { enabled: getFormValue(formData, "enabled") === "true" },
  });
  revalidatePath("/settings/developer");
});

/** "Send test" fires a request on demand, so it is limited like other actions that reach out. */
const TEST_SENDS_PER_WINDOW = 10;
const TEST_WINDOW_MS = 10 * 60_000;

export const sendTestWebhookAction = formActionWithResult(
  async (formData: FormData): Promise<{ ok: true; delivered: boolean; error: string | null }> => {
    const user = await requireUser();
    const endpoint = await ownEndpoint(user.id, formData);
    await enforceSlidingWindowRateLimit(
      `webhook-test:${user.id}`,
      TEST_SENDS_PER_WINDOW,
      TEST_WINDOW_MS,
      "Too many test sends. Wait a few minutes and try again.",
    );
    const result = await sendTestWebhook(prisma, endpoint.id);
    revalidatePath("/settings/developer");
    return { ok: true, ...result };
  },
);
