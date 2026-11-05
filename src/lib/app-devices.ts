import crypto from "crypto";
import type { AppDevice, PrismaClient, User } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";

/**
 * Phone app sign-in: OAuth 2.0 for native apps with PKCE (RFC 8252, RFC 7636), reduced to
 * the one client this server has.
 *
 * 1. The app opens `/app/authorize?code_challenge=…&state=…&device=…` in the system sign-in
 *    sheet. That page is an ordinary signed-in page, so password, passkey, authenticator
 *    code, SSO and the `/mfa` wall all apply unchanged.
 * 2. The person allows it (with a recent "confirm it's you"); the page hands the app a
 *    one-time code through `APP_REDIRECT_URI`.
 * 3. The app posts the code and its verifier to `POST /api/v1/app/token` and gets a device
 *    token, which it keeps in the Keychain and sends as `Authorization: Bearer ftd_…`.
 *
 * The app can also sign in with a passkey directly, on the one server it is built for (its
 * associated domain): `src/lib/app-passkey-sign-in.ts` verifies the passkey as the login page
 * does and hands out a device token through `issueAppDeviceToken`, with no browser sheet.
 *
 * Device tokens are long-lived (until signed out, `APP_DEVICE_IDLE_DAYS` unused, or a
 * `User.tokenVersion` bump) rather than short tokens with rotating refresh tokens: an app, a
 * widget and background refresh all hold the same token, and refreshes racing each other
 * sign people out at random.
 */

/** Where `/app/authorize` sends the code. The only redirect it will ever use. */
export const APP_REDIRECT_URI = "financetracker://signed-in";
/** Marks a device token apart from a personal access token (`ft_`). */
export const DEVICE_TOKEN_PREFIX = "ftd_";
/** Characters of the raw token kept for display ("ftd_" + 6). */
const DISPLAY_PREFIX_LEN = 10;
export const SIGN_IN_CODE_TTL_MS = 60_000;
export const APP_DEVICE_IDLE_DAYS = 90;
const IDLE_MS = APP_DEVICE_IDLE_DAYS * 24 * 60 * 60 * 1000;
/** Phones per account; an old phone that was never signed out still takes a slot until it idles out. */
export const MAX_APP_DEVICES = 10;
/** `lastUsedAt` only needs day accuracy for the idle limit, so it is written at most this often. */
const LAST_USED_WRITE_INTERVAL_MS = 10 * 60 * 1000;
const DEVICE_NAME_MAX = 60;
const DEFAULT_DEVICE_NAME = "iPhone";

const PKCE_VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;
/** base64url of a SHA-256: exactly 43 characters, no padding. */
const PKCE_CHALLENGE = /^[A-Za-z0-9\-_]{43}$/;
const STATE_PATTERN = /^[A-Za-z0-9\-._~]{1,200}$/;

export type AuthorizeRequest = { codeChallenge: string; state: string; deviceName: string };

type Param = string | string[] | undefined;

function single(value: Param): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** A device name fit to show in a list: no control characters, one line, at most 60 characters. */
export function cleanDeviceName(raw: string | undefined | null): string {
  const cleaned = (raw ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, DEVICE_NAME_MAX)
    .trim();
  return cleaned || DEFAULT_DEVICE_NAME;
}

/**
 * Reads `/app/authorize`'s query. Only S256 is accepted (`plain` would make PKCE pointless),
 * and a `redirect_uri`, if sent, must be the app's own: the page never redirects anywhere else.
 */
export function parseAuthorizeRequest(
  params: Record<string, Param>,
): { ok: true; request: AuthorizeRequest } | { ok: false; error: string } {
  const codeChallenge = single(params.code_challenge) ?? "";
  const method = single(params.code_challenge_method) ?? "S256";
  const state = single(params.state) ?? "";
  const redirectUri = single(params.redirect_uri);
  if (redirectUri !== undefined && redirectUri !== APP_REDIRECT_URI) {
    return { ok: false, error: "This sign-in link is for a different app." };
  }
  if (method !== "S256" || !PKCE_CHALLENGE.test(codeChallenge) || !STATE_PATTERN.test(state)) {
    return { ok: false, error: "This sign-in link is incomplete. Start again from the app." };
  }
  return { ok: true, request: { codeChallenge, state, deviceName: cleanDeviceName(single(params.device)) } };
}

/** The URL `/app/authorize` hands back to the app, with the code or `error=access_denied`. */
export function appRedirectUrl(result: { code: string } | { error: "access_denied" }, state: string): string {
  const query = new URLSearchParams("code" in result ? { code: result.code, state } : { error: result.error, state });
  return `${APP_REDIRECT_URI}?${query.toString()}`;
}

/** RFC 7636 S256: base64url(SHA-256(verifier)). */
export function pkceChallengeFor(verifier: string): string {
  return crypto.createHash("sha256").update(verifier, "ascii").digest("base64url");
}

function challengeMatches(verifier: string, challenge: string): boolean {
  if (!PKCE_VERIFIER.test(verifier)) return false;
  const expected = Buffer.from(pkceChallengeFor(verifier));
  const actual = Buffer.from(challenge);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

/**
 * SHA-256 hex, as `hashApiToken` in `api-token.ts` (which imports this module, so it is not
 * imported back): the secret is 256 random bits, so a slow hash would add nothing.
 */
function hashSecret(raw: string): string {
  return crypto.createHash("sha256").update(raw, "utf8").digest("hex");
}

export function isDeviceToken(raw: string): boolean {
  return raw.startsWith(DEVICE_TOKEN_PREFIX);
}

/** A device past `APP_DEVICE_IDLE_DAYS` without use, or from before the user's last revocation. */
export function isAppDeviceLive(
  device: Pick<AppDevice, "createdAt" | "lastUsedAt" | "tokenVersion">,
  user: Pick<User, "tokenVersion">,
  now = Date.now(),
): boolean {
  if (device.tokenVersion !== user.tokenVersion) return false;
  const lastSeen = (device.lastUsedAt ?? device.createdAt).getTime();
  return now - lastSeen < IDLE_MS;
}

/**
 * Step 2: a one-time code for the signed-in user. Refused once the account has
 * `MAX_APP_DEVICES` live phones, so the person signs an old one out first.
 */
export async function createAppSignInCode(
  input: { userId: string; request: AuthorizeRequest },
  client: PrismaClient = defaultPrisma,
  now = Date.now(),
): Promise<{ ok: true; code: string } | { ok: false; error: string }> {
  const live = await listAppDevices(input.userId, client, now);
  if (live.length >= MAX_APP_DEVICES) {
    return { ok: false, error: tooManyAppDevicesMessage() };
  }
  const code = crypto.randomBytes(32).toString("base64url");
  await client.$transaction([
    // A code nobody exchanged is worthless after a minute; clearing them here keeps the table
    // to the codes in flight.
    client.appSignInCode.deleteMany({ where: { userId: input.userId, expiresAt: { lt: new Date(now) } } }),
    client.appSignInCode.create({
      data: {
        userId: input.userId,
        codeHash: hashSecret(code),
        codeChallenge: input.request.codeChallenge,
        deviceName: input.request.deviceName,
        expiresAt: new Date(now + SIGN_IN_CODE_TTL_MS),
      },
    }),
  ]);
  return { ok: true, code };
}

export type ExchangeInput = { code: string; codeVerifier: string; platform?: string; appVersion?: string };

export type ExchangeResult =
  | { ok: true; token: string; device: AppDevice; user: User }
  | { ok: false; status: 400 | 403; error: string };

const INVALID_GRANT = "The sign-in code is invalid or has expired. Start again from the app.";

/**
 * Step 3: the code and the verifier only the app that started the sign-in knows, for a device
 * token. A code works once: it is deleted whether or not the verifier matches, so a code read
 * off the screen or out of a log is useless without the verifier, and gets one try at most.
 */
export async function exchangeAppSignInCode(
  input: ExchangeInput,
  client: PrismaClient = defaultPrisma,
  now = Date.now(),
): Promise<ExchangeResult> {
  if (!input.code || !input.codeVerifier) return { ok: false, status: 400, error: INVALID_GRANT };
  const row = await client.appSignInCode.findUnique({
    where: { codeHash: hashSecret(input.code) },
    include: { user: true },
  });
  if (!row) return { ok: false, status: 400, error: INVALID_GRANT };
  // Claiming by delete: of two requests racing with the same code, only one deletes the row.
  const claimed = await client.appSignInCode.deleteMany({ where: { id: row.id } });
  if (claimed.count !== 1) return { ok: false, status: 400, error: INVALID_GRANT };
  if (row.expiresAt.getTime() <= now) return { ok: false, status: 400, error: INVALID_GRANT };
  if (!challengeMatches(input.codeVerifier, row.codeChallenge)) {
    return { ok: false, status: 400, error: INVALID_GRANT };
  }
  if (row.user.disabledAt) return { ok: false, status: 403, error: "This account has been suspended." };

  const { token, device } = await issueAppDeviceToken(
    { user: row.user, deviceName: row.deviceName, platform: input.platform, appVersion: input.appVersion },
    client,
    now,
  );
  return { ok: true, token, device, user: row.user };
}

/**
 * Creates the device and its token. Callers have already decided the person may have one:
 * the account is not suspended, and it has a slot (`MAX_APP_DEVICES`).
 */
export async function issueAppDeviceToken(
  input: { user: Pick<User, "id" | "tokenVersion">; deviceName: string; platform?: string; appVersion?: string },
  client: PrismaClient = defaultPrisma,
  now = Date.now(),
): Promise<{ token: string; device: AppDevice }> {
  const raw = DEVICE_TOKEN_PREFIX + crypto.randomBytes(32).toString("base64url");
  const device = await client.appDevice.create({
    data: {
      userId: input.user.id,
      name: cleanDeviceName(input.deviceName),
      platform: (input.platform ?? "ios").slice(0, 20) || "ios",
      appVersion: input.appVersion ? input.appVersion.slice(0, 40) : null,
      tokenHash: hashSecret(raw),
      tokenPrefix: raw.slice(0, DISPLAY_PREFIX_LEN),
      tokenVersion: input.user.tokenVersion,
      lastUsedAt: new Date(now),
    },
  });
  return { token: raw, device };
}

/** The refusal `createAppSignInCode` gives, for any other way in. */
export function tooManyAppDevicesMessage(): string {
  return `This account already has ${MAX_APP_DEVICES} phones signed in. Sign one out under Settings → Security first.`;
}

export type AppDeviceAuth =
  | { status: "ok"; user: User; device: AppDevice }
  | { status: "unauthorized" };

/**
 * Checks a raw `ftd_` token: a live device of a live user. A device that has idled out or
 * outlived a revocation is deleted on sight, so the Signed-in apps list never shows it again.
 */
export async function authenticateAppDevice(
  raw: string,
  client: PrismaClient = defaultPrisma,
  now = Date.now(),
): Promise<AppDeviceAuth> {
  const record = await client.appDevice.findUnique({ where: { tokenHash: hashSecret(raw) }, include: { user: true } });
  if (!record) return { status: "unauthorized" };
  const { user, ...device } = record;
  if (user.disabledAt) return { status: "unauthorized" };
  if (!isAppDeviceLive(device, user, now)) {
    await client.appDevice.deleteMany({ where: { id: device.id } }).catch(() => {});
    return { status: "unauthorized" };
  }
  const lastSeen = (device.lastUsedAt ?? device.createdAt).getTime();
  if (now - lastSeen > LAST_USED_WRITE_INTERVAL_MS) {
    // Best-effort, as for personal access tokens: must never block or fail the request.
    void client.appDevice
      .update({ where: { id: device.id }, data: { lastUsedAt: new Date(now) } })
      .catch(() => {});
  }
  return { status: "ok", user, device };
}

/** The user's live phones, newest first. Dead rows (idled out, revoked by version) are cleared. */
export async function listAppDevices(
  userId: string,
  client: PrismaClient = defaultPrisma,
  now = Date.now(),
): Promise<AppDevice[]> {
  const [devices, user] = await Promise.all([
    client.appDevice.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }),
    client.user.findUnique({ where: { id: userId }, select: { tokenVersion: true } }),
  ]);
  if (!user) return [];
  const dead = devices.filter((d) => !isAppDeviceLive(d, user, now)).map((d) => d.id);
  if (dead.length > 0) await client.appDevice.deleteMany({ where: { id: { in: dead } } });
  return devices.filter((d) => !dead.includes(d.id));
}

/** Signs one phone out. Scoped to its owner, so an id from someone else's list does nothing. */
export async function signOutAppDevice(
  input: { userId: string; deviceId: string },
  client: PrismaClient = defaultPrisma,
): Promise<AppDevice | null> {
  const device = await client.appDevice.findFirst({ where: { id: input.deviceId, userId: input.userId } });
  if (!device) return null;
  await client.appDevice.deleteMany({ where: { id: device.id } });
  return device;
}

/**
 * The app's own "Sign out": ends the device whose token this is. Unknown, idled-out and
 * already-revoked tokens all come back null (RFC 7009 has nothing to say to them either).
 */
export async function revokeAppDeviceToken(
  raw: string,
  client: PrismaClient = defaultPrisma,
): Promise<AppDevice | null> {
  if (!isDeviceToken(raw)) return null;
  const device = await client.appDevice.findUnique({ where: { tokenHash: hashSecret(raw) } });
  if (!device) return null;
  const removed = await client.appDevice.deleteMany({ where: { id: device.id } });
  return removed.count === 1 ? device : null;
}
