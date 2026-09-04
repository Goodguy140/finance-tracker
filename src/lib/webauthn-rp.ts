/**
 * WebAuthn relying-party identity. A passkey is bound to the RP ID at registration, so this
 * must be the hostname users actually see in the address bar — which is what NEXTAUTH_URL
 * already has to be for OAuth callbacks to work. Note Chromium refuses IP literals as an
 * RP ID; `localhost` over plain http is a secure context and works for development.
 */
export type WebAuthnRp = { rpID: string; rpName: string; origin: string };

export const RP_NAME = "Finance Tracker";

const DEV_FALLBACK_URL = "http://localhost:3000";

export function getWebAuthnRp(nextAuthUrl = process.env.NEXTAUTH_URL): WebAuthnRp {
  const raw = nextAuthUrl?.trim();
  if (!raw) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Missing required env var NEXTAUTH_URL in production (needed for passkeys).");
    }
    return rpFromUrl(DEV_FALLBACK_URL);
  }
  return rpFromUrl(raw);
}

function rpFromUrl(raw: string): WebAuthnRp {
  const url = new URL(raw);
  return { rpID: url.hostname, rpName: RP_NAME, origin: url.origin };
}
