"use server";

import { hash, compare } from "bcryptjs";
import crypto from "crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getDefaultTimezone } from "@/lib/country-config";
import { ensureDefaultDataForUser } from "@/lib/defaults";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { revokePlaidItemsForUser } from "@/lib/plaid/unlink";
import { tryMakePlaidItemRevoker } from "@/lib/plaid/service";
import { AUDIT_ACTIONS, clientMetaFromHeaders, recordAuditLog } from "@/lib/audit-log";
import { isPasswordLoginDisabled } from "@/lib/oauth-provider-config";
import { enforceSlidingWindowRateLimit } from "@/lib/rate-limit";
import { sendEmail } from "@/lib/email";
import {
  loginSchema,
  passwordChangeSchema,
  signupSchema,
  updateProfileSchema,
} from "@/lib/validation";
import {
  getFormValue,
  formAction,
  publicSignupAllowed,
  resolveSignupRole,
} from "./_helpers";

const SIGNUP_WINDOW_MS = 15 * 60 * 1000;
const SIGNUP_MAX_PER_IP = 10;

export const signupAction = formAction(async (formData: FormData) => {
  const payload = signupSchema.parse({
    email: getFormValue(formData, "email"),
    password: getFormValue(formData, "password"),
    displayName: getFormValue(formData, "displayName"),
    countryCode: getFormValue(formData, "countryCode") || "CA",
    timezone:
      getFormValue(formData, "timezone") ||
      getDefaultTimezone(getFormValue(formData, "countryCode") || "CA"),
  });
  if (!(await publicSignupAllowed())) {
    throw new Error("Public sign up is disabled.");
  }
  // A password account created while SSO-only is on could never sign in with that password.
  if (await isPasswordLoginDisabled()) {
    throw new Error("This server uses single sign-on. Ask an admin to invite you.");
  }
  const email = payload.email.toLowerCase();
  const tooMany = "Too many signup attempts. Please try again later.";
  await enforceSlidingWindowRateLimit(`signup:${email}`, 5, SIGNUP_WINDOW_MS, tooMany);
  // The per-email budget alone lets one client mint unlimited accounts (and limiter rows)
  // by varying the address; the per-IP budget is what actually bounds that.
  const ip = clientMetaFromHeaders(await headers()).ipAddress;
  if (ip) {
    await enforceSlidingWindowRateLimit(`signup-ip:${ip}`, SIGNUP_MAX_PER_IP, SIGNUP_WINDOW_MS, tooMany);
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new Error("An account with this email already exists.");

  const passwordHash = await hash(payload.password, 12);
  // Count and create in one transaction: two concurrent first signups must not both read
  // zero users and both become the server admin.
  const user = await prisma.$transaction(async (tx) => {
    const count = await tx.user.count();
    return tx.user.create({
      data: {
        email,
        passwordHash,
        displayName: payload.displayName,
        countryCode: payload.countryCode,
        timezone: payload.timezone,
        role: resolveSignupRole(email, count),
      },
    });
  });

  await ensureDefaultDataForUser(user);
  await recordAuditLog(prisma, {
    userId: user.id,
    action: AUDIT_ACTIONS.user_signed_up,
    targetType: "User",
    targetId: user.id,
    // The first account silently becomes SERVER_ADMIN; that belongs in an access review.
    metadata: { role: user.role },
    headers: await headers(),
  });
  revalidatePath("/");
});


export const changePasswordAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const payload = passwordChangeSchema.parse({
    currentPassword: getFormValue(formData, "currentPassword"),
    newPassword: getFormValue(formData, "newPassword"),
    confirmPassword: getFormValue(formData, "confirmPassword"),
  });

  if (!user.passwordHash) throw new Error("Password login is not enabled for this account.");
  const valid = await compare(payload.currentPassword, user.passwordHash);
  if (!valid) throw new Error("Current password is incorrect.");

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hash(payload.newPassword, 12),
      // Revoke every session issued before this change — including the attacker's, which
      // is the whole point of changing a password you think has leaked.
      tokenVersion: { increment: 1 },
    },
  });
  const h = await headers();
  await recordAuditLog(prisma, {
    userId: user.id,
    action: AUDIT_ACTIONS.user_password_changed,
    headers: h,
  });
});

/**
 * Sign out every session, including this one. Sessions are stateless JWTs, so bumping
 * `tokenVersion` is the only revocation channel there is — every guard compares the version
 * the token carries against the current one and rejects anything older.
 */
export const signOutEverywhereAction = formAction(async () => {
  const user = await requireUser();
  await prisma.user.update({
    where: { id: user.id },
    data: { tokenVersion: { increment: 1 } },
  });
  await recordAuditLog(prisma, {
    userId: user.id,
    action: AUDIT_ACTIONS.user_sessions_revoked,
    headers: await headers(),
  });
});

export const updateProfileAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const payload = updateProfileSchema.parse({
    displayName: getFormValue(formData, "displayName") || user.displayName,
    countryCode: getFormValue(formData, "countryCode") || user.countryCode,
    timezone: getFormValue(formData, "timezone") || user.timezone,
  });
  await prisma.user.update({
    where: { id: user.id },
    data: payload,
  });
  revalidatePath("/settings");
});


export const deleteAccountAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const confirmation = getFormValue(formData, "confirmation");
  if (confirmation !== "DELETE") throw new Error("Type DELETE to confirm.");
  // Before the cascade, not after: deleting the PlaidItem rows does not end the bank
  // connections, and once they are gone there is no record of what to revoke.
  await revokePlaidItemsForUser(prisma, user.id, await tryMakePlaidItemRevoker());
  const h = await headers();
  await recordAuditLog(prisma, {
    userId: user.id,
    action: AUDIT_ACTIONS.user_account_deleted,
    targetType: "User",
    targetId: user.id,
    headers: h,
  });
  await prisma.user.delete({ where: { id: user.id } });
});

export const requestPasswordResetAction = formAction(async (formData: FormData) => {
  if (await isPasswordLoginDisabled()) {
    throw new Error("This server uses single sign-on; passwords cannot be reset.");
  }
  const email = loginSchema.parse({
    email: getFormValue(formData, "email"),
    password: "12345678",
  }).email;
  await enforceSlidingWindowRateLimit(
    `password-reset-request:${email.toLowerCase()}`,
    5,
    15 * 60 * 1000,
    "Too many password reset attempts. Please try again later.",
  );
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  // An account that signs in only through SSO or a passkey has no password to reset;
  // minting one here would add a login method its owner never chose. Stay silent, exactly
  // like an unknown address, so the response does not reveal which case applied.
  if (!user?.passwordHash) return;

  const token = crypto.randomUUID();
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: await hash(token, 8),
      expiresAt: new Date(Date.now() + 1000 * 60 * 30),
    },
  });

  const baseUrl = process.env.NEXTAUTH_URL?.replace(/\/$/, "");
  if (baseUrl) {
    const resetUrl = `${baseUrl}/reset-password?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`;
    await sendEmail({
      to: user.email,
      subject: "Reset your Finance Tracker password",
      text: `Use this link within 30 minutes to reset your password:\n\n${resetUrl}\n`,
    });
  }
});

export const resetPasswordAction = formAction(async (formData: FormData) => {
  if (await isPasswordLoginDisabled()) {
    throw new Error("This server uses single sign-on; passwords cannot be reset.");
  }
  const email = getFormValue(formData, "email").toLowerCase();
  const token = getFormValue(formData, "token");
  const newPassword = getFormValue(formData, "newPassword");
  await enforceSlidingWindowRateLimit(
    `password-reset:${email}`,
    10,
    15 * 60 * 1000,
    "Too many password reset attempts. Please try again later.",
  );
  if (newPassword.length < 8) throw new Error("Password must be at least 8 characters.");

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user?.passwordHash) throw new Error("Invalid or expired token.");

  const candidateTokens = await prisma.passwordResetToken.findMany({
    where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });

  let matched: { id: string } | null = null;
  for (const item of candidateTokens) {
    if (await compare(token, item.tokenHash)) {
      matched = { id: item.id };
      break;
    }
  }
  if (!matched) throw new Error("Invalid or expired token.");

  await prisma.$transaction([
    // Burn every outstanding token, not just the one presented: the others were issued to
    // the same mailbox and stay valid for the rest of their window otherwise.
    prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    }),
    prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hash(newPassword, 12),
        tokenVersion: { increment: 1 },
      },
    }),
  ]);
  await recordAuditLog(prisma, {
    userId: user.id,
    action: AUDIT_ACTIONS.user_password_reset,
    headers: await headers(),
  });
});
