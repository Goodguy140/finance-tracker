import { summarizeDatabaseUrlDisplay } from "@/lib/admin-system-health";

export type EnvPresence = "present" | "missing" | "invalid";

export type AdminEnvDisplay =
  | { kind: "value"; value: string }
  | { kind: "presence"; presence: EnvPresence }
  | { kind: "database"; label: string };

export type AdminEnvEntry = {
  name: string;
  display: AdminEnvDisplay;
  note?: string;
};

const SECRET_NAME_PATTERN =
  /password|secret|token|hash|encrypted|clientsecret|authorization|cookie|session|pass$/i;

/** Env vars that may show a non-secret value on the admin page. */
const PUBLIC_VALUE_NAMES = new Set([
  "NODE_ENV",
  "AUTH_TRUST_HOST",
  "ALLOW_PUBLIC_SIGNUP",
  "DISABLE_PASSWORD_LOGIN",
  "AUTHENTIK_ENABLED",
  "AUTHENTIK_ISSUER",
  "AUTHENTIK_CLIENT_ID",
  "PLAID_CLIENT_ID",
  "PLAID_ENV",
  "NEXTAUTH_URL",
  "TZ",
  "SMTP_HOST",
  "SMTP_FROM",
  "VERCEL",
  "APP_GIT_SHA",
  "VERCEL_GIT_COMMIT_SHA",
  "GITHUB_SHA",
]);

function envTrim(name: string): string {
  return process.env[name]?.trim() ?? "";
}

function classifyPresence(value: string, minLen = 1): EnvPresence {
  if (!value) return "missing";
  if (value.length < minLen) return "invalid";
  return "present";
}

function isSecretName(name: string): boolean {
  return SECRET_NAME_PATTERN.test(name);
}

function displayForPublicName(name: string, raw: string): AdminEnvDisplay {
  if (name === "DATABASE_URL") {
    const summary = summarizeDatabaseUrlDisplay(raw);
    return { kind: "database", label: summary.label };
  }
  if (name === "NEXTAUTH_URL") {
    if (!raw) return { kind: "presence", presence: "missing" };
    return {
      kind: "value",
      value: raw.startsWith("http") ? raw : "(invalid — must start with http)",
    };
  }
  if (name === "AUTHENTIK_ENABLED" || name === "AUTH_TRUST_HOST" || name === "ALLOW_PUBLIC_SIGNUP") {
    return { kind: "value", value: raw || "(unset)" };
  }
  if (name === "APP_GIT_SHA" || name === "VERCEL_GIT_COMMIT_SHA" || name === "GITHUB_SHA") {
    const short = raw.slice(0, 7);
    return short ? { kind: "value", value: short } : { kind: "presence", presence: "missing" };
  }
  return { kind: "value", value: raw || "(unset)" };
}

function entryForName(name: string): AdminEnvEntry {
  const raw = envTrim(name);
  if (name === "DATABASE_URL") {
    const summary = summarizeDatabaseUrlDisplay(raw);
    return {
      name,
      display: { kind: "database", label: summary.label },
      note: summary.kind === "other" ? "Connection string type only; credentials never shown." : undefined,
    };
  }
  if (isSecretName(name) || !PUBLIC_VALUE_NAMES.has(name)) {
    const presence = classifyPresence(raw, name === "NEXTAUTH_SECRET" ? 16 : name === "SERVER_SETTINGS_ENCRYPTION_KEY" ? 32 : 1);
    return { name, display: { kind: "presence", presence }, note: "Value hidden (secret or sensitive)." };
  }
  return { name, display: displayForPublicName(name, raw) };
}

/** Curated, safe env snapshot for server admins (secrets never expose values). */
export function buildAdminEnvConfig(): AdminEnvEntry[] {
  const names = [
    "NODE_ENV",
    "DATABASE_URL",
    "NEXTAUTH_URL",
    "NEXTAUTH_SECRET",
    "SERVER_SETTINGS_ENCRYPTION_KEY",
    "AUTH_TRUST_HOST",
    "ALLOW_PUBLIC_SIGNUP",
  "DISABLE_PASSWORD_LOGIN",
    "AUTHENTIK_ENABLED",
    "AUTHENTIK_ISSUER",
    "AUTHENTIK_CLIENT_ID",
    "AUTHENTIK_CLIENT_SECRET",
    "PLAID_CLIENT_ID",
    "PLAID_SECRET",
    "PLAID_ENV",
    "SMTP_HOST",
    "SMTP_USER",
    "SMTP_PASS",
    "SMTP_FROM",
    "TZ",
    "VERCEL",
    "APP_GIT_SHA",
  ];
  return names.map(entryForName);
}

export function formatEnvDisplay(display: AdminEnvDisplay): string {
  switch (display.kind) {
    case "value":
      return display.value;
    case "database":
      return display.label;
    case "presence":
      switch (display.presence) {
        case "present":
          return "set (hidden)";
        case "missing":
          return "not set";
        case "invalid":
          return "set but invalid / too short";
      }
  }
}
