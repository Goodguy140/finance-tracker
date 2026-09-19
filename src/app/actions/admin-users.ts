"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { AUDIT_ACTIONS, recordAuditLog } from "@/lib/audit-log";
import {
  countActiveAdmins,
  describeUserMutationRefusal,
  type AdminUserGuardTarget,
} from "@/lib/admin-users";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import { revokePlaidItemsForUser } from "@/lib/plaid/unlink";
import { tryMakePlaidItemRevoker } from "@/lib/plaid/service";
import {
  adminDeleteUserSchema,
  adminSetUserDisabledSchema,
  adminSetUserRoleSchema,
  adminUserIdSchema,
} from "@/lib/validation";
import { formAction, getFormValue } from "./_helpers";

const ADMIN_USERS_PATH = "/settings/admin/users";

/** Loads the target and runs the shared guard rails. Returns the acting admin and target. */
async function loadTarget(userId: string, intent: "demote" | "disable" | "delete" | null) {
  const actor = await requireAdmin();
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, role: true, disabledAt: true },
  });
  if (!target) throw new Error("That account no longer exists.");

  if (intent) {
    const refusal = describeUserMutationRefusal({
      actorId: actor.id,
      target: target satisfies AdminUserGuardTarget,
      intent,
      activeAdminCount: await countActiveAdmins(prisma),
    });
    if (refusal) throw new Error(refusal);
  }
  return { actor, target };
}

export const setUserRoleAction = formAction(async (formData: FormData) => {
  const payload = adminSetUserRoleSchema.parse({
    userId: getFormValue(formData, "userId"),
    role: getFormValue(formData, "role"),
  });
  // Only a demotion can strand the server without an admin; promoting never needs the guard.
  const demoting = payload.role === "USER";
  const { actor, target } = await loadTarget(payload.userId, demoting ? "demote" : null);
  if (target.role === payload.role) return;

  await prisma.user.update({ where: { id: target.id }, data: { role: payload.role } });
  await recordAuditLog(prisma, {
    userId: actor.id,
    action: AUDIT_ACTIONS.admin_user_role_changed,
    targetType: "User",
    targetId: target.id,
    metadata: { email: target.email, from: target.role, to: payload.role },
    headers: await headers(),
  });
  revalidatePath(ADMIN_USERS_PATH);
});

export const setUserDisabledAction = formAction(async (formData: FormData) => {
  const payload = adminSetUserDisabledSchema.parse({
    userId: getFormValue(formData, "userId"),
    disabled: getFormValue(formData, "disabled"),
  });
  const disabling = payload.disabled === "true";
  const { actor, target } = await loadTarget(payload.userId, disabling ? "disable" : null);
  if (Boolean(target.disabledAt) === disabling) return;

  await prisma.user.update({
    where: { id: target.id },
    data: {
      disabledAt: disabling ? new Date() : null,
      // Suspending has to end live sessions now, not when their JWTs expire a week later.
      // Restoring bumps it too, so nothing issued during the suspension survives it.
      tokenVersion: { increment: 1 },
    },
  });
  await recordAuditLog(prisma, {
    userId: actor.id,
    action: disabling ? AUDIT_ACTIONS.admin_user_disabled : AUDIT_ACTIONS.admin_user_enabled,
    targetType: "User",
    targetId: target.id,
    metadata: { email: target.email },
    headers: await headers(),
  });
  revalidatePath(ADMIN_USERS_PATH);
});

export const forceSignOutUserAction = formAction(async (formData: FormData) => {
  const payload = adminUserIdSchema.parse({ userId: getFormValue(formData, "userId") });
  // No guard rail: revoking sessions is recoverable by signing back in, and an admin
  // signing themselves out everywhere is a legitimate thing to want.
  const { actor, target } = await loadTarget(payload.userId, null);

  await prisma.user.update({
    where: { id: target.id },
    data: { tokenVersion: { increment: 1 } },
  });
  await recordAuditLog(prisma, {
    userId: actor.id,
    action: AUDIT_ACTIONS.admin_user_sessions_revoked,
    targetType: "User",
    targetId: target.id,
    metadata: { email: target.email },
    headers: await headers(),
  });
  revalidatePath(ADMIN_USERS_PATH);
});

export const deleteUserAction = formAction(async (formData: FormData) => {
  const payload = adminDeleteUserSchema.parse({
    userId: getFormValue(formData, "userId"),
    confirmEmail: getFormValue(formData, "confirmEmail"),
  });
  const { actor, target } = await loadTarget(payload.userId, "delete");
  if (payload.confirmEmail !== target.email.toLowerCase()) {
    throw new Error("The email you typed does not match this account.");
  }

  // Refuses the delete if any of the target's bank connections cannot be revoked at Plaid;
  // an orphaned item keeps billing and keeps its access, with nothing left pointing at it.
  await revokePlaidItemsForUser(prisma, target.id, await tryMakePlaidItemRevoker());

  // Written before the delete: `AuditLog.userId` is SetNull on the *actor*, but the target
  // is only a plain string column, so the row survives the cascade with its subject intact.
  await recordAuditLog(prisma, {
    userId: actor.id,
    action: AUDIT_ACTIONS.admin_user_deleted,
    targetType: "User",
    targetId: target.id,
    metadata: { email: target.email, role: target.role },
    headers: await headers(),
  });
  await prisma.user.delete({ where: { id: target.id } });
  revalidatePath(ADMIN_USERS_PATH);
});
