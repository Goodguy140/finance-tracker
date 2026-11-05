import type { AppDevice, PrismaClient, User } from "@prisma/client";
import { issueAppDeviceToken, listAppDevices, MAX_APP_DEVICES, tooManyAppDevicesMessage } from "@/lib/app-devices";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { verifyPasskeySignIn } from "@/lib/webauthn";

/**
 * Passkey sign-in from the phone app, without the browser sheet. The app asks iOS for a passkey
 * for this server (Face ID), which only works when the app is built for this server's domain and
 * the server says so in its Apple app-site association (`src/lib/apple-app-site.ts`). On any
 * other server the app signs in through `/app/authorize` as before.
 *
 * The checks are the login page's own (`passkeyProvider` in `auth-options.ts`): the same
 * challenge rows, the same verification with user verification required, and a suspended
 * account is refused. A passkey is already both factors, so there is no `/mfa` wall after it,
 * as on the web. The one thing the web flow adds, the "Allow" page, has nothing to ask here:
 * the person started this from the app, on their own phone, and confirmed it with Face ID.
 */

export type AppPasskeySignInInput = {
  challengeId: string;
  /** The `AuthenticationResponseJSON` the app built from iOS's assertion, as sent. */
  response: unknown;
  deviceName: string;
  platform?: string;
  appVersion?: string;
};

export type AppPasskeySignInResult =
  | { ok: true; token: string; device: AppDevice; user: User }
  | { ok: false; status: 400 | 401 | 403; error: string; user?: User };

const NOT_ACCEPTED = "That passkey was not accepted. Try again, or sign in on the web page.";

export async function signInAppWithPasskey(
  input: AppPasskeySignInInput,
  deps: {
    client?: PrismaClient;
    verify?: (challengeId: string, responseJson: string) => Promise<User | null>;
    now?: number;
  } = {},
): Promise<AppPasskeySignInResult> {
  const client = deps.client ?? defaultPrisma;
  const verify = deps.verify ?? verifyPasskeySignIn;
  const now = deps.now ?? Date.now();

  if (!input.challengeId || !input.response || typeof input.response !== "object") {
    return { ok: false, status: 400, error: NOT_ACCEPTED };
  }
  const user = await verify(input.challengeId, JSON.stringify(input.response));
  if (!user) return { ok: false, status: 401, error: NOT_ACCEPTED };
  if (user.disabledAt) return { ok: false, status: 403, error: "This account has been suspended.", user };

  const live = await listAppDevices(user.id, client, now);
  if (live.length >= MAX_APP_DEVICES) return { ok: false, status: 403, error: tooManyAppDevicesMessage(), user };

  const { token, device } = await issueAppDeviceToken(
    { user, deviceName: input.deviceName, platform: input.platform, appVersion: input.appVersion },
    client,
    now,
  );
  return { ok: true, token, device, user };
}
