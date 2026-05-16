import type { PrismaClient } from "@prisma/client";
import { checkOAuthDecryptHealth, tryDecryptServerSetting, type OAuthProviderHealth } from "@/lib/migration-health";

export type OAuthAdminErrorCode = "DECRYPT_FAILED" | "ENABLED_BUT_INCOMPLETE" | "ENV_OVERRIDES_DB";

export type OauthProviderSource = "database" | "environment" | "none" | "mixed";

export type ProviderAdminOauthStatus = {
  enabledRequested: boolean;
  runtimeRegistered: boolean;
  configured: boolean;
  source: OauthProviderSource;
  warnings: string[];
  errorCodes: OAuthAdminErrorCode[];
};

export type AdminOauthStatus = {
  google: ProviderAdminOauthStatus;
  authentik: ProviderAdminOauthStatus;
  globalWarnings: string[];
};

export type AdminOauthStatusInput = {
  oauthHealth: {
    allReadable: boolean;
    failedKeys: string[];
    google: OAuthProviderHealth;
    authentik: OAuthProviderHealth;
  };
  googleEnabled: string;
  googleClientId: string;
  googleClientSecret: string;
  authentikEnabled: string;
  authentikIssuer: string;
  authentikClientId: string;
  authentikClientSecret: string;
  env: {
    issuer: string;
    clientId: string;
    clientSecret: string;
    enabledFlag: string;
  };
};

function nonEmpty(s: string) {
  return Boolean(s?.trim());
}

function envAuthentikRuntime(env: AdminOauthStatusInput["env"]): boolean {
  if (!nonEmpty(env.issuer) || !nonEmpty(env.clientId) || !nonEmpty(env.clientSecret)) return false;
  const f = env.enabledFlag.trim().toLowerCase();
  if (f === "false" || f === "0") return false;
  return true;
}

function dbAuthentikRuntime(
  authentikEnabled: string,
  authentikIssuer: string,
  authentikClientId: string,
  authentikClientSecret: string,
): boolean {
  return (
    authentikEnabled.trim() === "true" &&
    nonEmpty(authentikIssuer) &&
    nonEmpty(authentikClientId) &&
    nonEmpty(authentikClientSecret)
  );
}

function dbAuthentikHasStoredValues(
  authentikIssuer: string,
  authentikClientId: string,
  authentikClientSecret: string,
): boolean {
  return nonEmpty(authentikIssuer) || nonEmpty(authentikClientId) || nonEmpty(authentikClientSecret);
}

/**
 * Pure status builder (used by tests with fixed snapshots).
 */
export function buildAdminOauthStatus(input: AdminOauthStatusInput): AdminOauthStatus {
  const globalWarnings: string[] = [];
  if (!input.oauthHealth.allReadable && input.oauthHealth.failedKeys.length > 0) {
    globalWarnings.push(
      `Some oauth.* server settings failed to decrypt (${input.oauthHealth.failedKeys.join(", ")}). Check SERVER_SETTINGS_ENCRYPTION_KEY.`,
    );
  }

  const googleEnabledRequested = input.googleEnabled.trim() === "true";
  const googleRuntime =
    googleEnabledRequested && nonEmpty(input.googleClientId) && nonEmpty(input.googleClientSecret);
  const googleWarnings: string[] = [];
  const googleCodes: OAuthAdminErrorCode[] = [];
  if (input.oauthHealth.google === "decrypt_failed") {
    googleWarnings.push("Google OAuth settings are stored but at least one value failed to decrypt.");
    googleCodes.push("DECRYPT_FAILED");
  }
  if (googleEnabledRequested && !googleRuntime && input.oauthHealth.google !== "decrypt_failed") {
    googleWarnings.push("Google is enabled in admin settings but client ID or client secret is missing.");
    googleCodes.push("ENABLED_BUT_INCOMPLETE");
  }

  const authentikEnabledRequested = input.authentikEnabled.trim() === "true";
  const envRt = envAuthentikRuntime(input.env);
  const dbRt = dbAuthentikRuntime(
    input.authentikEnabled,
    input.authentikIssuer,
    input.authentikClientId,
    input.authentikClientSecret,
  );
  const authentikRuntime = envRt || dbRt;

  let authentikSource: OauthProviderSource = "none";
  if (envRt && dbAuthentikHasStoredValues(input.authentikIssuer, input.authentikClientId, input.authentikClientSecret)) {
    authentikSource = "mixed";
  } else if (envRt) {
    authentikSource = "environment";
  } else if (dbRt) {
    authentikSource = "database";
  }

  const authentikWarnings: string[] = [];
  const authentikCodes: OAuthAdminErrorCode[] = [];
  if (input.oauthHealth.authentik === "decrypt_failed") {
    authentikWarnings.push("Authentik OAuth settings are stored but at least one value failed to decrypt.");
    authentikCodes.push("DECRYPT_FAILED");
  }
  if (authentikEnabledRequested && !authentikRuntime && input.oauthHealth.authentik !== "decrypt_failed") {
    authentikWarnings.push(
      "Authentik is enabled in admin settings but issuer, client ID, or client secret is missing (and no complete Authentik env credentials are active).",
    );
    authentikCodes.push("ENABLED_BUT_INCOMPLETE");
  }
  if (
    envRt &&
    dbAuthentikHasStoredValues(input.authentikIssuer, input.authentikClientId, input.authentikClientSecret)
  ) {
    authentikWarnings.push(
      "Authentik credentials are set in the environment; runtime sign-in uses env values and overrides database-stored Authentik settings.",
    );
    authentikCodes.push("ENV_OVERRIDES_DB");
  }

  return {
    globalWarnings,
    google: {
      enabledRequested: googleEnabledRequested,
      runtimeRegistered: googleRuntime,
      configured: googleRuntime,
      source:
        input.oauthHealth.google !== "not_configured" ||
        googleEnabledRequested ||
        nonEmpty(input.googleClientId) ||
        nonEmpty(input.googleClientSecret)
          ? "database"
          : "none",
      warnings: googleWarnings,
      errorCodes: googleCodes,
    },
    authentik: {
      enabledRequested: authentikEnabledRequested,
      runtimeRegistered: authentikRuntime,
      configured: authentikRuntime,
      source: authentikSource,
      warnings: authentikWarnings,
      errorCodes: authentikCodes,
    },
  };
}

async function readSetting(prisma: PrismaClient, key: string): Promise<string> {
  const row = await prisma.serverSetting.findUnique({ where: { key } });
  if (!row) return "";
  return tryDecryptServerSetting(row.encryptedValue) ?? "";
}

export async function getAdminOauthStatus(prisma: PrismaClient): Promise<AdminOauthStatus> {
  const [
    oauthHealth,
    googleEnabled,
    googleClientId,
    googleClientSecret,
    authentikEnabled,
    authentikIssuer,
    authentikClientId,
    authentikClientSecret,
  ] = await Promise.all([
    checkOAuthDecryptHealth(prisma),
    readSetting(prisma, "oauth.google.enabled"),
    readSetting(prisma, "oauth.google.clientId"),
    readSetting(prisma, "oauth.google.clientSecret"),
    readSetting(prisma, "oauth.authentik.enabled"),
    readSetting(prisma, "oauth.authentik.issuer"),
    readSetting(prisma, "oauth.authentik.clientId"),
    readSetting(prisma, "oauth.authentik.clientSecret"),
  ]);

  return buildAdminOauthStatus({
    oauthHealth,
    googleEnabled,
    googleClientId,
    googleClientSecret,
    authentikEnabled,
    authentikIssuer,
    authentikClientId,
    authentikClientSecret,
    env: {
      issuer: process.env.AUTHENTIK_ISSUER?.trim() ?? "",
      clientId: process.env.AUTHENTIK_CLIENT_ID?.trim() ?? "",
      clientSecret: process.env.AUTHENTIK_CLIENT_SECRET?.trim() ?? "",
      enabledFlag: process.env.AUTHENTIK_ENABLED?.trim() ?? "",
    },
  });
}
