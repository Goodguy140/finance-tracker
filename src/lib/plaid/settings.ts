/**
 * Pure resolution of the Plaid credentials an operator configures.
 *
 * Mirrors `src/lib/oauth-settings.ts` deliberately: the admin form posts blank secret
 * fields when the operator is not changing them, so "blank means keep what is stored" is
 * the contract here too, and the impure half (reading the rows, decrypting, caching) lives
 * in `config.ts` so this file stays trivially unit-testable.
 */

export const PLAID_SETTING_KEYS = {
  enabled: "plaid.enabled",
  clientId: "plaid.clientId",
  secret: "plaid.secret",
  env: "plaid.env",
} as const;

/** Plaid retired the standalone `development` environment; these are the only two hosts. */
export const PLAID_ENVIRONMENTS = ["sandbox", "production"] as const;
export type PlaidEnvironment = (typeof PLAID_ENVIRONMENTS)[number];

export const PLAID_HOSTS: Record<PlaidEnvironment, string> = {
  sandbox: "https://sandbox.plaid.com",
  production: "https://production.plaid.com",
};

/**
 * Anything unrecognised reads as `sandbox`. Defaulting the other way would point a
 * misconfigured deployment at live banking data, which is the one mistake worth being
 * opinionated about.
 */
export function normalizePlaidEnvironment(raw: string | undefined | null): PlaidEnvironment {
  return raw?.trim().toLowerCase() === "production" ? "production" : "sandbox";
}

export type PlaidSettingsInput = {
  enabledRaw: string;
  clientIdRaw: string;
  secretRaw: string;
  envRaw: string;
  existingClientId: string;
  existingSecret: string;
  existingEnv: string;
};

export type ResolvedPlaidSettings = {
  enabled: string;
  clientId: string;
  secret: string;
  env: PlaidEnvironment;
};

export function resolvePlaidSettings(input: PlaidSettingsInput): ResolvedPlaidSettings {
  const enabled = input.enabledRaw || "false";
  const clientId = input.clientIdRaw.trim() ? input.clientIdRaw.trim() : input.existingClientId;
  const secret = input.secretRaw.trim() ? input.secretRaw.trim() : input.existingSecret;
  const env = normalizePlaidEnvironment(input.envRaw.trim() ? input.envRaw : input.existingEnv);
  return { enabled, clientId, secret, env };
}

export type PlaidCredentialSource = "environment" | "database" | "mixed" | "none";

export type PlaidAdminStatus = {
  enabledRequested: boolean;
  /** True when a usable client id + secret pair resolved from somewhere. */
  configured: boolean;
  source: PlaidCredentialSource;
  environment: PlaidEnvironment;
  warnings: string[];
};

export type PlaidAdminStatusInput = {
  enabled: string;
  clientId: string;
  secret: string;
  env: string;
  /** Null when a stored value could not be decrypted (rotated encryption key). */
  decryptFailedKeys?: string[];
  envVars: { clientId: string; secret: string; env: string };
};

function nonEmpty(value: string | undefined | null): boolean {
  return Boolean(value?.trim());
}

/** Both env vars must be present for the env to take over; a half-set pair is ignored. */
export function envCredentialsComplete(envVars: PlaidAdminStatusInput["envVars"]): boolean {
  return nonEmpty(envVars.clientId) && nonEmpty(envVars.secret);
}

export function buildPlaidAdminStatus(input: PlaidAdminStatusInput): PlaidAdminStatus {
  const warnings: string[] = [];
  const failedKeys = input.decryptFailedKeys ?? [];
  if (failedKeys.length > 0) {
    warnings.push(
      `Some plaid.* server settings failed to decrypt (${failedKeys.join(", ")}). Check SERVER_SETTINGS_ENCRYPTION_KEY — banks linked with those credentials must be relinked.`,
    );
  }

  const envComplete = envCredentialsComplete(input.envVars);
  const dbComplete = nonEmpty(input.clientId) && nonEmpty(input.secret);
  const dbHasAnything = nonEmpty(input.clientId) || nonEmpty(input.secret);
  const enabledRequested = input.enabled.trim() === "true";

  let source: PlaidCredentialSource = "none";
  if (envComplete && dbHasAnything) source = "mixed";
  else if (envComplete) source = "environment";
  else if (dbComplete) source = "database";

  if (envComplete && dbHasAnything) {
    warnings.push(
      "PLAID_CLIENT_ID and PLAID_SECRET are set in the environment and override the values stored below.",
    );
  }
  if (!envComplete && nonEmpty(input.envVars.clientId) !== nonEmpty(input.envVars.secret)) {
    warnings.push(
      "Only one of PLAID_CLIENT_ID / PLAID_SECRET is set in the environment. Both are required for the environment to take over, so the stored values are being used.",
    );
  }

  const configured = envComplete || dbComplete;
  if (enabledRequested && !configured && failedKeys.length === 0) {
    warnings.push("Plaid is enabled but the client ID or secret is missing.");
  }

  // The env var only picks the host when the env credentials are the ones in play;
  // otherwise the environment stored alongside the stored credentials wins.
  const environment = normalizePlaidEnvironment(envComplete ? input.envVars.env : input.env);
  if (enabledRequested && configured && environment === "sandbox") {
    warnings.push("Plaid is pointed at the sandbox. Sandbox items return fake data and never touch a real bank.");
  }

  return { enabledRequested, configured, source, environment, warnings };
}
