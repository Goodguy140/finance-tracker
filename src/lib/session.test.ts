import { beforeEach, describe, expect, it, vi } from "vitest";

const findUnique = vi.fn();
const getServerSession = vi.fn();
const redirect = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
});

vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique } } }));
vi.mock("@/lib/auth-options", () => ({ getAuthOptions: vi.fn(async () => ({})) }));
vi.mock("next-auth", () => ({ getServerSession }));
vi.mock("next/headers", () => ({ headers: vi.fn(), cookies: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/mfa-session", async () => {
  const actual = await vi.importActual<typeof import("@/lib/mfa-session")>("@/lib/mfa-session");
  return { ...actual, getMfaState: vi.fn(async () => ({ verified: false, verifiedAt: null, method: null })) };
});

const { mfaRedirectPath, safeNextPath, MfaStepUpRequiredError, resolveSession, requireSessionUser, STALE_SESSION_PATH } =
  await import("./session");

describe("resolveSession", () => {
  const dbUser = { id: "u1", email: "a@b.c", tokenVersion: 1, _count: { webAuthnCredentials: 0 } };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is anonymous without a session", async () => {
    getServerSession.mockResolvedValue(null);
    expect(await resolveSession()).toEqual({ status: "anonymous" });
    await expect(requireSessionUser()).rejects.toThrow("REDIRECT:/login");
  });

  it("is stale, not anonymous, when the token's user no longer exists", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1", tokenVersion: 1 } });
    findUnique.mockResolvedValue(null);
    expect(await resolveSession()).toEqual({ status: "stale", reason: "user_deleted" });
    await expect(requireSessionUser()).rejects.toThrow(`REDIRECT:${STALE_SESSION_PATH}`);
  });

  it("is stale when the account has been suspended", async () => {
    // Suspension must clear cookies like a revocation, not merely refuse: the proxy only
    // checks that a token exists, so a refused-but-kept cookie loops /login against /.
    getServerSession.mockResolvedValue({ user: { id: "u1", tokenVersion: 1 } });
    findUnique.mockResolvedValue({ ...dbUser, disabledAt: new Date("2026-02-03T00:00:00.000Z") });
    expect(await resolveSession()).toEqual({ status: "stale", reason: "user_disabled" });
    await expect(requireSessionUser()).rejects.toThrow(`REDIRECT:${STALE_SESSION_PATH}`);
  });

  it("is stale when the token version was revoked", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1", tokenVersion: 0 } });
    findUnique.mockResolvedValue(dbUser);
    expect(await resolveSession()).toEqual({ status: "stale", reason: "token_revoked" });
  });

  it("loads the user when the version matches", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1", tokenVersion: 1, sid: "s1", authAt: 5 } });
    findUnique.mockResolvedValue(dbUser);
    const resolution = await resolveSession();
    expect(resolution.status).toBe("ok");
    if (resolution.status === "ok") {
      expect(resolution.loaded.user.id).toBe("u1");
      expect(resolution.loaded.sid).toBe("s1");
      expect(resolution.loaded.authAt).toBe(5);
      expect(resolution.loaded.mfa.required).toBe(false);
    }
  });
});

describe("safeNextPath", () => {
  it("keeps same-origin relative paths", () => {
    expect(safeNextPath("/settings?tab=x")).toBe("/settings?tab=x");
  });

  it("refuses protocol-relative and absolute destinations", () => {
    expect(safeNextPath("//evil.example")).toBe("/");
    expect(safeNextPath("/\\evil.example")).toBe("/");
    expect(safeNextPath("https://evil.example")).toBe("/");
    expect(safeNextPath("settings")).toBe("/");
  });

  it("never loops back onto the wall or the login page", () => {
    expect(safeNextPath("/mfa")).toBe("/");
    expect(safeNextPath("/mfa?next=%2F")).toBe("/");
    expect(safeNextPath("/login")).toBe("/");
    expect(safeNextPath(null)).toBe("/");
  });
});

describe("mfaRedirectPath", () => {
  it("omits next for the root and encodes everything else", () => {
    expect(mfaRedirectPath("/")).toBe("/mfa");
    expect(mfaRedirectPath(null)).toBe("/mfa");
    expect(mfaRedirectPath("/settings?x=1")).toBe("/mfa?next=%2Fsettings%3Fx%3D1");
  });
});

describe("MfaStepUpRequiredError", () => {
  it("carries a machine-readable code for the client", () => {
    expect(new MfaStepUpRequiredError("mfa_step_up").code).toBe("mfa_step_up");
    expect(new MfaStepUpRequiredError("mfa_required").message).toMatch(/passkey/i);
  });
});
