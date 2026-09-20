"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { encryptSecret, tryDecryptSecret } from "@/lib/security";
import { requireAdmin } from "@/lib/session";
import { AUDIT_ACTIONS, recordAuditLog } from "@/lib/audit-log";
import { PASSWORD_LOGIN_DISABLED_KEY, describeSsoOnlyRefusal } from "@/lib/auth-settings";
import {
  getAuthentikProvider,
  getGoogleProvider,
  invalidateOAuthProviderCache,
} from "@/lib/oauth-provider-config";
import { setServerSetting } from "@/lib/server-settings";
import { adminSetPasswordLoginDisabledSchema } from "@/lib/validation";
import { resolveAuthentikOauthSettings, resolveGoogleOauthSettings } from "@/lib/oauth-settings";
import { invalidatePlaidConfigCache } from "@/lib/plaid/config";
import { PLAID_SETTING_KEYS, resolvePlaidSettings } from "@/lib/plaid/settings";
import {
  getFormValue,
  formAction,
} from "./_helpers";
export const updateAdminOauthSettingsAction = formAction(async (formData: FormData) => {
  const user = await requireAdmin();
  const [googleClientIdRow, googleClientSecretRow, authentikIssuerRow, authentikClientIdRow, authentikClientSecretRow] =
    await Promise.all([
      prisma.serverSetting.findUnique({ where: { key: "oauth.google.clientId" } }),
      prisma.serverSetting.findUnique({ where: { key: "oauth.google.clientSecret" } }),
      prisma.serverSetting.findUnique({ where: { key: "oauth.authentik.issuer" } }),
      prisma.serverSetting.findUnique({ where: { key: "oauth.authentik.clientId" } }),
      prisma.serverSetting.findUnique({ where: { key: "oauth.authentik.clientSecret" } }),
    ]);
  const googleResolved = resolveGoogleOauthSettings({
    enabledRaw: getFormValue(formData, "googleEnabled"),
    clientIdRaw: getFormValue(formData, "googleClientId"),
    clientSecretRaw: getFormValue(formData, "googleClientSecret"),
    existingClientId: googleClientIdRow ? tryDecryptSecret(googleClientIdRow.encryptedValue) ?? "" : "",
    existingClientSecret: googleClientSecretRow ? tryDecryptSecret(googleClientSecretRow.encryptedValue) ?? "" : "",
  });
  const authentikResolved = resolveAuthentikOauthSettings({
    enabledRaw: getFormValue(formData, "authentikEnabled"),
    issuerRaw: getFormValue(formData, "authentikIssuer"),
    clientIdRaw: getFormValue(formData, "authentikClientId"),
    clientSecretRaw: getFormValue(formData, "authentikClientSecret"),
    existingIssuer: authentikIssuerRow ? tryDecryptSecret(authentikIssuerRow.encryptedValue) ?? "" : "",
    existingClientId: authentikClientIdRow ? tryDecryptSecret(authentikClientIdRow.encryptedValue) ?? "" : "",
    existingClientSecret: authentikClientSecretRow ? tryDecryptSecret(authentikClientSecretRow.encryptedValue) ?? "" : "",
  });
  const entries = [
    { key: "oauth.google.enabled", value: googleResolved.enabled },
    { key: "oauth.google.clientId", value: googleResolved.clientId },
    { key: "oauth.google.clientSecret", value: googleResolved.clientSecret },
    { key: "oauth.authentik.enabled", value: authentikResolved.enabled },
    { key: "oauth.authentik.issuer", value: authentikResolved.issuer },
    { key: "oauth.authentik.clientId", value: authentikResolved.clientId },
    { key: "oauth.authentik.clientSecret", value: authentikResolved.clientSecret },
  ];

  for (const entry of entries) {
    await prisma.serverSetting.upsert({
      where: { key: entry.key },
      create: {
        key: entry.key,
        encryptedValue: encryptSecret(entry.value),
        updatedByUserId: user.id,
      },
      update: {
        encryptedValue: encryptSecret(entry.value),
        updatedByUserId: user.id,
      },
    });
  }
  invalidateOAuthProviderCache();
  const h = await headers();
  await recordAuditLog(prisma, {
    userId: user.id,
    action: AUDIT_ACTIONS.admin_oauth_settings_updated,
    metadata: {
      googleEnabled: googleResolved.enabled,
      authentikEnabled: authentikResolved.enabled,
    },
    headers: h,
  });
  revalidatePath("/settings/admin");
});

/**
 * Stores the Plaid client credentials, encrypted, alongside the OAuth ones.
 *
 * Blank secret fields mean "keep what is stored" — the form never renders the secret back,
 * so an operator editing only the environment dropdown must not wipe it. `PLAID_CLIENT_ID`
 * and `PLAID_SECRET` in the environment override whatever is saved here (both halves
 * required); the admin page says so when that is in play.
 */
export const updateAdminPlaidSettingsAction = formAction(async (formData: FormData) => {
  const user = await requireAdmin();
  const [clientIdRow, secretRow, envRow] = await Promise.all([
    prisma.serverSetting.findUnique({ where: { key: PLAID_SETTING_KEYS.clientId } }),
    prisma.serverSetting.findUnique({ where: { key: PLAID_SETTING_KEYS.secret } }),
    prisma.serverSetting.findUnique({ where: { key: PLAID_SETTING_KEYS.env } }),
  ]);

  const resolved = resolvePlaidSettings({
    enabledRaw: getFormValue(formData, "plaidEnabled"),
    clientIdRaw: getFormValue(formData, "plaidClientId"),
    secretRaw: getFormValue(formData, "plaidSecret"),
    envRaw: getFormValue(formData, "plaidEnv"),
    existingClientId: clientIdRow ? tryDecryptSecret(clientIdRow.encryptedValue) ?? "" : "",
    existingSecret: secretRow ? tryDecryptSecret(secretRow.encryptedValue) ?? "" : "",
    existingEnv: envRow ? tryDecryptSecret(envRow.encryptedValue) ?? "" : "",
  });

  const entries = [
    { key: PLAID_SETTING_KEYS.enabled, value: resolved.enabled },
    { key: PLAID_SETTING_KEYS.clientId, value: resolved.clientId },
    { key: PLAID_SETTING_KEYS.secret, value: resolved.secret },
    { key: PLAID_SETTING_KEYS.env, value: resolved.env },
  ];
  for (const entry of entries) {
    await prisma.serverSetting.upsert({
      where: { key: entry.key },
      create: { key: entry.key, encryptedValue: encryptSecret(entry.value), updatedByUserId: user.id },
      update: { encryptedValue: encryptSecret(entry.value), updatedByUserId: user.id },
    });
  }
  invalidatePlaidConfigCache();

  await recordAuditLog(prisma, {
    userId: user.id,
    action: AUDIT_ACTIONS.plaid_settings_updated,
    // No credential values: `scrubAuditMetadata` would drop a key named "secret" anyway,
    // but the point is not to hand it one.
    metadata: {
      enabled: resolved.enabled,
      environment: resolved.env,
      clientIdConfigured: Boolean(resolved.clientId),
    },
    headers: await headers(),
  });
  revalidatePath("/settings/admin");
});

/**
 * Turn password sign-in off, leaving SSO and passkeys as the only ways in.
 *
 * Guarded on the way in, never on the way out: re-enabling password login is always allowed,
 * because it is the recovery path. An env `DISABLE_PASSWORD_LOGIN` still overrides whatever
 * is stored here, which is how an admin locked out by a broken IdP gets back in.
 */
export const updatePasswordLoginSettingAction = formAction(async (formData: FormData) => {
  const user = await requireAdmin();
  const { disabled } = adminSetPasswordLoginDisabledSchema.parse({
    disabled: getFormValue(formData, "passwordLoginDisabled") || "false",
  });
  const turningOff = disabled === "true";

  if (turningOff) {
    const [google, authentik, linkedProviders] = await Promise.all([
      getGoogleProvider(),
      getAuthentikProvider(),
      prisma.authAccount.count({ where: { userId: user.id } }),
    ]);
    const refusal = describeSsoOnlyRefusal({
      hasOAuthProvider: Boolean(google || authentik),
      actorHasLinkedProvider: linkedProviders > 0,
    });
    if (refusal) throw new Error(refusal);
  }

  await setServerSetting(PASSWORD_LOGIN_DISABLED_KEY, turningOff ? "true" : "false", user.id);
  invalidateOAuthProviderCache();
  await recordAuditLog(prisma, {
    userId: user.id,
    action: AUDIT_ACTIONS.admin_auth_settings_updated,
    metadata: { passwordLoginDisabled: turningOff },
    headers: await headers(),
  });
  revalidatePath("/settings/admin");
  revalidatePath("/login");
});
