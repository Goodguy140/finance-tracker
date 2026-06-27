"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { AUDIT_ACTIONS, recordAuditLog } from "@/lib/audit-log";
import { generateApiToken } from "@/lib/api-token";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { createApiTokenSchema, revokeApiTokenSchema } from "@/lib/validation";
import { getFormValue } from "./_helpers";

/** Max active (non-revoked) tokens per user — keeps the attack surface small. */
const MAX_ACTIVE_TOKENS = 20;

export type CreateApiTokenState =
  | { ok: null }
  | { ok: true; token: string; name: string; prefix: string }
  | { ok: false; error: string };

/**
 * Creates a personal access token and returns the raw value **once**.
 * Designed for `useActionState` — the raw token is never stored or re-fetchable.
 */
export async function createApiTokenAction(
  _prev: CreateApiTokenState,
  formData: FormData,
): Promise<CreateApiTokenState> {
  const user = await requireUser();
  const parsed = createApiTokenSchema.safeParse({
    name: getFormValue(formData, "name"),
    scopes: ["budgets:read"],
  });
  if (!parsed.success) {
    return { ok: false, error: "Enter a name (1–60 characters) for the token." };
  }

  const activeCount = await prisma.personalAccessToken.count({
    where: { userId: user.id, revokedAt: null },
  });
  if (activeCount >= MAX_ACTIVE_TOKENS) {
    return { ok: false, error: `Token limit reached (${MAX_ACTIVE_TOKENS}). Revoke an unused token first.` };
  }

  const { raw, hash, prefix } = generateApiToken();
  const created = await prisma.personalAccessToken.create({
    data: {
      userId: user.id,
      name: parsed.data.name,
      tokenHash: hash,
      tokenPrefix: prefix,
      scopes: parsed.data.scopes.join(","),
    },
    select: { id: true },
  });

  await recordAuditLog(prisma, {
    userId: user.id,
    action: AUDIT_ACTIONS.api_token_created,
    targetType: "personal_access_token",
    targetId: created.id,
    metadata: { name: parsed.data.name, scopes: parsed.data.scopes },
    headers: await headers(),
  });

  revalidatePath("/settings");
  return { ok: true, token: raw, name: parsed.data.name, prefix };
}

export async function revokeApiTokenAction(formData: FormData) {
  const user = await requireUser();
  const parsed = revokeApiTokenSchema.parse({ tokenId: getFormValue(formData, "tokenId") });

  const existing = await prisma.personalAccessToken.findFirst({
    where: { id: parsed.tokenId, userId: user.id, revokedAt: null },
    select: { id: true, name: true },
  });
  if (!existing) throw new Error("Token not found.");

  await prisma.personalAccessToken.update({
    where: { id: existing.id },
    data: { revokedAt: new Date() },
  });

  await recordAuditLog(prisma, {
    userId: user.id,
    action: AUDIT_ACTIONS.api_token_revoked,
    targetType: "personal_access_token",
    targetId: existing.id,
    metadata: { name: existing.name },
    headers: await headers(),
  });

  revalidatePath("/settings");
}
