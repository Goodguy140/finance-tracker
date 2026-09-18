import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextAuthOptions, Session } from "next-auth";
import type { JWT } from "next-auth/jwt";

const findUnique = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique } },
}));

const isPasswordLoginDisabled = vi.fn(async () => false);
vi.mock("@/lib/oauth-provider-config", () => ({
  getGoogleProvider: vi.fn(async () => null),
  getAuthentikProvider: vi.fn(async () => null),
  isPasswordLoginDisabled,
}));

vi.mock("@/lib/rate-limit", () => ({
  enforceSlidingWindowRateLimit: vi.fn(),
  clearRateLimit: vi.fn(),
}));

vi.mock("@/lib/webauthn", () => ({ verifyPasskeySignIn: vi.fn() }));
// Keep the real AUDIT_ACTIONS so the auditing tests below assert on actual action names
// rather than on `undefined` from a stubbed-out registry.
vi.mock("@/lib/audit-log", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/audit-log")>()),
  recordAuditLog: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: vi.fn(), headers: vi.fn() }));
vi.mock("bcryptjs", () => ({ compare: vi.fn(), hash: vi.fn() }));

const { getAuthOptions, resolveLoginMaxPerIp } = await import("@/lib/auth-options");
const { AUDIT_ACTIONS, recordAuditLog } = await import("@/lib/audit-log");
const { compare } = await import("bcryptjs");

const recordAuditLogMock = vi.mocked(recordAuditLog);
const compareMock = vi.mocked(compare);

/**
 * `CredentialsProvider` returns a stub whose real config — `authorize`, the `id` override —
 * lives under `options` until the NextAuth handler merges it. Reach through to that.
 */
function credentialsConfig(options: NextAuthOptions, id: string) {
  const provider = options.providers.find(
    (p) => ((p as { options?: { id?: string } }).options?.id ?? p.id) === id,
  );
  return (provider as unknown as {
    options: { authorize: (c: unknown, r: unknown) => Promise<unknown> };
  }).options;
}

type JwtCallback = NonNullable<NonNullable<NextAuthOptions["callbacks"]>["jwt"]>;

/**
 * next-auth types `user` and `account` as always present on the jwt callback, but at
 * runtime it passes neither on any request after the initial sign-in — which is the
 * path these tests exercise. Build the params once here rather than casting per call.
 */
function subsequentRequest(token: JWT): Parameters<JwtCallback>[0] {
  return { token, trigger: "update" } as unknown as Parameters<JwtCallback>[0];
}

function signInRequest(token: JWT, user: Record<string, unknown>): Parameters<JwtCallback>[0] {
  return { token, user, trigger: "signIn" } as unknown as Parameters<JwtCallback>[0];
}

describe("jwt callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findUnique.mockResolvedValue({
      id: "u1",
      role: "USER",
      displayName: "Test",
    });
  });

  it("queries the database only once within the refresh window", async () => {
    const options = await getAuthOptions();
    const jwt = options.callbacks?.jwt;
    expect(jwt).toBeDefined();

    const token: JWT = { email: "user@example.com", sub: "u1", role: "USER" };
    await jwt!(subsequentRequest(token));
    await jwt!(subsequentRequest(token));

    expect(findUnique).toHaveBeenCalledTimes(1);
  });
});

describe("jwt callback at sign-in", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findUnique.mockResolvedValue({ id: "u1", email: "user@example.com", role: "USER", displayName: "Test", tokenVersion: 2 });
  });

  it("mints a fresh sid per login and keys the lookup on the local user id", async () => {
    const jwt = (await getAuthOptions()).callbacks!.jwt!;
    const first = await jwt(signInRequest({ email: "user@example.com" }, { id: "u1", email: "user@example.com" }));
    const second = await jwt(signInRequest({ email: "user@example.com" }, { id: "u1", email: "user@example.com" }));
    expect(first.sid).toMatch(/[0-9a-f-]{36}/);
    expect(second.sid).not.toBe(first.sid);
    expect(first.tokenVersion).toBe(2);
    expect(first.mfa).toBeUndefined();
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "u1" } }));
  });

  it("stamps authAt at sign-in only and exposes it on the session", async () => {
    const options = await getAuthOptions();
    const jwt = options.callbacks!.jwt!;
    const before = Date.now();
    const token = (await jwt(signInRequest({}, { id: "u1", email: "user@example.com" }))) as JWT & { authAt?: number };
    expect(token.authAt).toBeGreaterThanOrEqual(before);
    expect(token.authAt).toBeLessThanOrEqual(Date.now());

    const stamped = token.authAt;
    const refreshed = (await jwt(subsequentRequest({ ...token, roleRefreshedAt: 0 }))) as JWT & { authAt?: number };
    expect(refreshed.authAt).toBe(stamped);

    const session = await options.callbacks!.session!({
      session: { user: { id: "" }, expires: "" } as unknown as Session,
      token: refreshed,
    } as never);
    expect((session.user as { authAt?: number } | undefined)?.authAt).toBe(stamped);
  });

  it("keeps the sid across refreshes", async () => {
    const jwt = (await getAuthOptions()).callbacks!.jwt!;
    const token = await jwt(signInRequest({ email: "user@example.com" }, { id: "u1" }));
    const refreshed = await jwt(subsequentRequest({ ...token, roleRefreshedAt: 0 }));
    expect(refreshed.sid).toBe(token.sid);
    expect(findUnique).toHaveBeenLastCalledWith(expect.objectContaining({ where: { id: "u1" } }));
  });

  it("carries a passwordless passkey assertion into the token, and the session exposes it", async () => {
    const options = await getAuthOptions();
    const token = await options.callbacks!.jwt!(
      signInRequest({ email: "user@example.com" }, { id: "u1", mfaVerifiedAt: 1_700_000_000_000 }),
    );
    expect(token.mfa).toEqual({ at: 1_700_000_000_000, method: "passkey" });

    const session = (await options.callbacks!.session!({
      session: { user: { id: "", email: "user@example.com" }, expires: "" },
      token,
    } as never)) as Session;
    expect(session.user.sid).toBe(token.sid);
    expect(session.user.mfa).toEqual({ at: 1_700_000_000_000, method: "passkey" });
    expect(session.user.tokenVersion).toBe(2);
  });

  it("registers the passkey credentials provider", async () => {
    // NextAuth v4 keeps per-instance overrides under `options` until the handler merges them.
    const ids = (await getAuthOptions()).providers.map((p) => (p as { options?: { id?: string } }).options?.id ?? p.id);
    expect(ids).toContain("passkey");
    expect(ids).toContain("credentials");
  });
});

describe("resolveLoginMaxPerIp", () => {
  it("defaults to 30 and accepts only positive integers", () => {
    expect(resolveLoginMaxPerIp(undefined)).toBe(30);
    expect(resolveLoginMaxPerIp("")).toBe(30);
    expect(resolveLoginMaxPerIp("0")).toBe(30);
    expect(resolveLoginMaxPerIp("-5")).toBe(30);
    expect(resolveLoginMaxPerIp("lots")).toBe(30);
    expect(resolveLoginMaxPerIp(" 250 ")).toBe(250);
  });
});

describe("credentials authorize auditing", () => {
  const req = { headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1", "user-agent": "probe/1.0" } };

  async function authorize(credentials: Record<string, string>) {
    const config = credentialsConfig(await getAuthOptions(), "credentials");
    return config.authorize(credentials, req);
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("records an unknown email with no user id attached", async () => {
    findUnique.mockResolvedValue(null);

    expect(await authorize({ email: "Nobody@Example.com ", password: "hunter2" })).toBeNull();
    expect(recordAuditLogMock).toHaveBeenCalledTimes(1);
    expect(recordAuditLogMock.mock.calls[0][1]).toMatchObject({
      userId: null,
      action: AUDIT_ACTIONS.user_login_failed,
      metadata: { email: "nobody@example.com", reason: "unknown_email" },
    });
  });

  it("distinguishes an account that has no password login from a wrong password", async () => {
    findUnique.mockResolvedValue({ id: "u1", email: "sso@example.com", passwordHash: null });

    expect(await authorize({ email: "sso@example.com", password: "hunter2" })).toBeNull();
    expect(recordAuditLogMock.mock.calls[0][1]).toMatchObject({
      userId: "u1",
      metadata: { reason: "password_login_unavailable" },
    });
    expect(compareMock).not.toHaveBeenCalled();
  });

  it("refuses a suspended account before checking its password", async () => {
    findUnique.mockResolvedValue({
      id: "u1",
      email: "gone@example.com",
      passwordHash: "hashed",
      disabledAt: new Date("2026-02-03T00:00:00.000Z"),
    });

    expect(await authorize({ email: "gone@example.com", password: "right" })).toBeNull();
    expect(recordAuditLogMock.mock.calls[0][1]).toMatchObject({
      userId: "u1",
      metadata: { reason: "account_disabled" },
    });
    expect(compareMock).not.toHaveBeenCalled();
  });

  it("records a wrong password against the user", async () => {
    findUnique.mockResolvedValue({ id: "u1", email: "user@example.com", passwordHash: "hashed" });
    compareMock.mockResolvedValue(false as never);

    expect(await authorize({ email: "user@example.com", password: "wrong" })).toBeNull();
    expect(recordAuditLogMock.mock.calls[0][1]).toMatchObject({
      userId: "u1",
      metadata: { reason: "invalid_password" },
    });
  });

  it("carries the client IP and user agent onto the audit row", async () => {
    findUnique.mockResolvedValue(null);
    await authorize({ email: "nobody@example.com", password: "hunter2" });

    // `authorize` is handed a plain object, so the headers must be rebuilt as a `Headers`
    // instance for recordAuditLog to read them at all.
    const carried = recordAuditLogMock.mock.calls[0][1].headers;
    expect(carried).toBeInstanceOf(Headers);
    expect(carried?.get("x-forwarded-for")).toBe("203.0.113.9, 10.0.0.1");
    expect(carried?.get("user-agent")).toBe("probe/1.0");
  });

  it("does not audit the unmetered empty-credentials bail-out", async () => {
    // That branch sits above the rate limiter, so auditing it would be a log-flooding lever.
    expect(await authorize({ email: "", password: "" })).toBeNull();
    expect(await authorize({ email: "user@example.com", password: "" })).toBeNull();
    expect(recordAuditLogMock).not.toHaveBeenCalled();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("records nothing on a successful sign-in — events.signIn owns that", async () => {
    findUnique.mockResolvedValue({
      id: "u1",
      email: "user@example.com",
      passwordHash: "hashed",
      displayName: "Test",
      role: "USER",
    });
    compareMock.mockResolvedValue(true as never);

    expect(await authorize({ email: "user@example.com", password: "right" })).toMatchObject({ id: "u1" });
    expect(recordAuditLogMock).not.toHaveBeenCalled();
  });
});

describe("sign-in and sign-out events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("records a successful sign-in with the provider that produced it", async () => {
    const events = (await getAuthOptions()).events!;
    await events.signIn!({ user: { id: "u1", email: "user@example.com" }, account: { provider: "authentik" } } as never);

    expect(recordAuditLogMock.mock.calls[0][1]).toMatchObject({
      userId: "u1",
      action: AUDIT_ACTIONS.user_login_succeeded,
      metadata: { provider: "authentik" },
    });
  });

  it("falls back to credentials when no account is attached", async () => {
    const events = (await getAuthOptions()).events!;
    await events.signIn!({ user: { id: "u1" }, account: null } as never);

    expect(recordAuditLogMock.mock.calls[0][1]).toMatchObject({ metadata: { provider: "credentials" } });
  });

  it("records sign-out against the token subject", async () => {
    const events = (await getAuthOptions()).events!;
    await events.signOut!({ token: { sub: "u1" } } as never);

    expect(recordAuditLogMock.mock.calls[0][1]).toMatchObject({
      userId: "u1",
      action: AUDIT_ACTIONS.user_logout,
    });
  });
});

describe("SSO-only switch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isPasswordLoginDisabled.mockResolvedValue(false);
  });

  function providerIds(options: NextAuthOptions) {
    return options.providers.map((p) => (p as { options?: { id?: string } }).options?.id ?? p.id);
  }

  it("registers the credentials provider while password login is allowed", async () => {
    expect(providerIds(await getAuthOptions())).toContain("credentials");
  });

  it("removes the credentials provider but keeps passkeys when disabled", async () => {
    // Passkeys are a passwordless first factor; turning passwords off must not take away
    // the one credential that needs no identity provider at all.
    isPasswordLoginDisabled.mockResolvedValue(true);
    const ids = providerIds(await getAuthOptions());
    expect(ids).not.toContain("credentials");
    expect(ids).toContain("passkey");
  });

  it("refuses a password sign-in even if a stale options object still holds the provider", async () => {
    const config = credentialsConfig(await getAuthOptions(), "credentials");
    isPasswordLoginDisabled.mockResolvedValue(true);

    expect(await config.authorize({ email: "user@example.com", password: "right" }, {})).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });
});
