export type GoogleOauthSettingsInput = {
  enabledRaw: string;
  clientIdRaw: string;
  clientSecretRaw: string;
  existingClientId: string;
  existingClientSecret: string;
};

export function resolveGoogleOauthSettings(input: GoogleOauthSettingsInput) {
  const enabled = input.enabledRaw || "false";
  const clientId = input.clientIdRaw.trim() ? input.clientIdRaw.trim() : input.existingClientId;
  const clientSecret = input.clientSecretRaw.trim() ? input.clientSecretRaw.trim() : input.existingClientSecret;
  return { enabled, clientId, clientSecret };
}

export type AuthentikOauthSettingsInput = {
  enabledRaw: string;
  issuerRaw: string;
  clientIdRaw: string;
  clientSecretRaw: string;
  existingIssuer: string;
  existingClientId: string;
  existingClientSecret: string;
};

export function resolveAuthentikOauthSettings(input: AuthentikOauthSettingsInput) {
  const enabled = input.enabledRaw || "false";
  const issuer = input.issuerRaw.trim() ? input.issuerRaw.trim() : input.existingIssuer;
  const clientId = input.clientIdRaw.trim() ? input.clientIdRaw.trim() : input.existingClientId;
  const clientSecret = input.clientSecretRaw.trim() ? input.clientSecretRaw.trim() : input.existingClientSecret;
  return { enabled, issuer, clientId, clientSecret };
}

export function normalizeAuthentikIssuer(issuer: string) {
  return issuer.trim().replace(/\/+$/, "");
}
