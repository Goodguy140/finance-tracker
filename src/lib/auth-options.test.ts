import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextAuthOptions, Session } from "next-auth";
import type { JWT } from "next-auth/jwt";

const findUnique = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique } },
}));

vi.mock("@/lib/oauth-provider-config", () => ({
  getGoogleProvider: vi.fn(async () => null),
  getAuthentikProvider: vi.fn(async () => null),
}));

vi.mock("@/lib/rate-limit", () => ({
  enforceSlidingWindowRateLimit: vi.fn(),
  clearRateLimit: vi.fn(),
}));

vi.mock("@/lib/webauthn", () => ({ verifyPasskeySignIn: vi.fn() }));
vi.mock("@/lib/audit-log", () => ({ AUDIT_ACTIONS: {}, recordAuditLog: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn(), headers: vi.fn() }));

const { getAuthOptions, resolveLoginMaxPerIp } = await import("@/lib/auth-options");

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
