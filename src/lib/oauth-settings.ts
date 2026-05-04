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
