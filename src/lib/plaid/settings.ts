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
  syncScheduler: "plaid.syncScheduler",
} as const;

/**
 * Parses an off switch: `false` or `0` mean off, and *everything else — including unset —
 * means on*.
 *
 * Default-on is the point. This is read both from `PLAID_SYNC_SCHEDULER` and from the
 * `plaid.syncScheduler` row, and every deployment that predates that row has no row at
 * all; defaulting the other way would silently stop the sweep the moment this shipped.
 */
export function plaidSweepSwitchEnabled(raw: string | undefined | null): boolean {
  const value = raw?.trim().toLowerCase();
  return value !== "false" && value !== "0";
}

/**
 * Whether the *scheduled* sweep may run, given both switches.
 *
 * The environment wins when it says no: an operator who set `PLAID_SYNC_SCHEDULER=false`
 * on the container did so to stop it running at all, and an admin ticking a checkbox in
 * the app should not be able to overrule the box it runs on. Either switch alone is enough
 * to turn it off.
 *
 * Neither switch touches **Sync now** or **Sync all**, which a person is standing right
 * there having asked for.
 */
export function plaidSweepAllowed(input: { envRaw?: string | null; storedRaw?: string | null }): boolean {
  return plaidSweepSwitchEnabled(input.envRaw) && plaidSweepSwitchEnabled(input.storedRaw);
}

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
  syncSchedulerRaw: string;
  clientIdRaw: string;
  secretRaw: string;
  envRaw: string;
  existingClientId: string;
  existingSecret: string;
  existingEnv: string;
};

export type ResolvedPlaidSettings = {
  enabled: string;
  syncScheduler: string;
  clientId: string;
  secret: string;
  env: PlaidEnvironment;
};

export function resolvePlaidSettings(input: PlaidSettingsInput): ResolvedPlaidSettings {
  const enabled = input.enabledRaw || "false";
  // Unchecked checkboxes post nothing, so an absent field here means the admin cleared it.
  // That is not the same as the row never having existed, which reads as on.
  const syncScheduler = input.syncSchedulerRaw || "false";
  const clientId = input.clientIdRaw.trim() ? input.clientIdRaw.trim() : input.existingClientId;
  const secret = input.secretRaw.trim() ? input.secretRaw.trim() : input.existingSecret;
  const env = normalizePlaidEnvironment(input.envRaw.trim() ? input.envRaw : input.existingEnv);
  return { enabled, syncScheduler, clientId, secret, env };
}

export type PlaidCredentialSource = "environment" | "database" | "mixed" | "none";

export type PlaidAdminStatus = {
  enabledRequested: boolean;
  /** What the stored switch says, independent of the environment overriding it. */
  syncSchedulerRequested: boolean;
  /** True when `PLAID_SYNC_SCHEDULER` is holding the sweep off regardless of the above. */
  syncSchedulerForcedOffByEnv: boolean;
  /** True when a usable client id + secret pair resolved from somewhere. */
  configured: boolean;
  source: PlaidCredentialSource;
  environment: PlaidEnvironment;
  warnings: string[];
};

export type PlaidAdminStatusInput = {
  enabled: string;
  /** The `plaid.syncScheduler` row. Absent reads as on — see `plaidSweepSwitchEnabled`. */
  syncScheduler?: string;
  clientId: string;
  secret: string;
  env: string;
  /** Null when a stored value could not be decrypted (rotated encryption key). */
  decryptFailedKeys?: string[];
  envVars: { clientId: string; secret: string; env: string; syncScheduler?: string };
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
  const syncSchedulerRequested = plaidSweepSwitchEnabled(input.syncScheduler);
  const syncSchedulerForcedOffByEnv = !plaidSweepSwitchEnabled(input.envVars.syncScheduler);

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

  if (enabledRequested && syncSchedulerRequested && syncSchedulerForcedOffByEnv) {
    warnings.push(
      "PLAID_SYNC_SCHEDULER is set to false in the environment, so the background sweep stays off no matter what is saved here. Sync now and Sync all still work.",
    );
  }

  return {
    enabledRequested,
    syncSchedulerRequested,
    syncSchedulerForcedOffByEnv,
    configured,
    source,
    environment,
    warnings,
  };
}
