"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { AUDIT_ACTIONS, recordAuditLog } from "@/lib/audit-log";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
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

/** Adds an endpoint and returns its signing secret **once**; only the encrypted copy is kept. */
export async function createWebhookAction(_prev: CreateWebhookState, formData: FormData): Promise<CreateWebhookState> {
  const user = await requireUser();
  let url: string;
  let events: string[];
  try {
    url = parseWebhookUrl(getFormValue(formData, "url"));
    events = parseWebhookEvents(formData.getAll("events").map(String));
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

export const sendTestWebhookAction = formActionWithResult(
  async (formData: FormData): Promise<{ ok: true; delivered: boolean; error: string | null }> => {
    const user = await requireUser();
    const endpoint = await ownEndpoint(user.id, formData);
    const result = await sendTestWebhook(prisma, endpoint.id);
    revalidatePath("/settings/developer");
    return { ok: true, ...result };
  },
);
