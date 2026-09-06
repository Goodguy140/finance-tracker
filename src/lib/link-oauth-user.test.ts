import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Account, User } from "next-auth";

const db = {
  authAccount: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
  user: { findUnique: vi.fn(), create: vi.fn(), count: vi.fn() },
  $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
};
vi.mock("@/lib/prisma", () => ({ prisma: db }));

const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined),
    set: (name: string, value: string) => {
      if (value === "") cookieJar.delete(name);
      else cookieJar.set(name, value);
    },
  })),
  headers: vi.fn(async () => new Headers()),
}));

const consumeChallenge = vi.fn();
vi.mock("@/lib/webauthn", () => ({ consumeChallenge }));

const recordAuditLog = vi.fn();
vi.mock("@/lib/audit-log", async () => {
  const actual = await vi.importActual<typeof import("@/lib/audit-log")>("@/lib/audit-log");
  return { ...actual, recordAuditLog };
});

process.env.NEXTAUTH_SECRET = "link-test-secret";
delete process.env.NEXTAUTH_URL;

const { linkOAuthUser } = await import("./link-oauth-user");
const { signPayload, ssoLinkCookieName } = await import("./mfa-session");

function profile(overrides: Partial<User> = {}): User {
  return { id: "google-sub-123", email: "Alice@Example.com", name: "Alice G", ...overrides };
}

const account: Account = {
  provider: "google",
  providerAccountId: "google-sub-123",
  type: "oauth",
  expires_at: 1_900_000_000,
};

const localUser = { id: "u-local", email: "alice@example.com", displayName: "Alice Local" };

beforeEach(() => {
  vi.clearAllMocks();
  cookieJar.clear();
  process.env.ALLOW_PUBLIC_SIGNUP = "true";
  delete process.env.INITIAL_ADMIN_EMAIL;
  db.authAccount.findUnique.mockResolvedValue(null);
  db.user.findUnique.mockResolvedValue(null);
});

describe("linkOAuthUser", () => {
  it("signs an already-linked identity in as the linked local account, whatever email the provider sends", async () => {
    const other = { id: "u-other", email: "other@example.com", displayName: "Other" };
    db.authAccount.findUnique.mockResolvedValue({ id: "aa1", userId: other.id, user: other });
    const user = profile({ email: "alice@example.com" });

    expect(await linkOAuthUser({ user, account, defaultDisplayName: "x" })).toBe(true);
    expect(user.id).toBe("u-other");
    expect(user.email).toBe("other@example.com");
    // Never re-pointed to whoever owns the profile email.
    expect(db.authAccount.update).toHaveBeenCalledWith({ where: { id: "aa1" }, data: { expiresAt: account.expires_at } });
    expect(db.authAccount.create).not.toHaveBeenCalled();
    expect(db.user.findUnique).not.toHaveBeenCalledWith({ where: { email: "alice@example.com" } });
  });

  it("refuses to auto-link by email when there is no link intent", async () => {
    db.user.findUnique.mockResolvedValue(localUser);
    const result = await linkOAuthUser({ user: profile(), account, defaultDisplayName: "x" });
    expect(typeof result).toBe("string");
    expect(result).toBe("/login?error=LinkRequired");
    expect(db.authAccount.create).not.toHaveBeenCalled();
    expect(recordAuditLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "sso_link_rejected" }));
  });

  it("links to the intent's user (not the email match) and redirects without a session", async () => {
    cookieJar.set(
      ssoLinkCookieName(),
      signPayload("sso-link", { userId: "u-intent", provider: "google", challengeId: "c1", exp: Date.now() + 60_000 }),
    );
    consumeChallenge.mockResolvedValue("nonce");
    db.user.findUnique.mockImplementation(async ({ where }: { where: { id?: string; email?: string } }) =>
      where.id === "u-intent" ? { id: "u-intent", email: "intent@example.com", displayName: "Intent" } : localUser,
    );

    const result = await linkOAuthUser({ user: profile(), account, defaultDisplayName: "x" });
    expect(result).toBe("/settings?linked=google");
    expect(consumeChallenge).toHaveBeenCalledWith("c1", "sso-link", "u-intent");
    expect(db.authAccount.create).toHaveBeenCalledWith({
      data: { provider: "google", providerAccountId: "google-sub-123", userId: "u-intent", expiresAt: account.expires_at },
    });
    expect(cookieJar.has(ssoLinkCookieName())).toBe(false);
    expect(recordAuditLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "sso_account_linked" }));
  });

  it("ignores an intent for a different provider or with a spent nonce", async () => {
    cookieJar.set(
      ssoLinkCookieName(),
      signPayload("sso-link", { userId: "u-intent", provider: "authentik", challengeId: "c1", exp: Date.now() + 60_000 }),
    );
    db.user.findUnique.mockResolvedValue(localUser);
    expect(await linkOAuthUser({ user: profile(), account, defaultDisplayName: "x" })).toBe("/login?error=LinkRequired");
    expect(consumeChallenge).not.toHaveBeenCalled();

    cookieJar.set(
      ssoLinkCookieName(),
      signPayload("sso-link", { userId: "u-intent", provider: "google", challengeId: "c1", exp: Date.now() + 60_000 }),
    );
    consumeChallenge.mockResolvedValue(null);
    expect(await linkOAuthUser({ user: profile(), account, defaultDisplayName: "x" })).toBe("/login?error=LinkRequired");
    expect(db.authAccount.create).not.toHaveBeenCalled();
  });

  it("creates a brand-new account when nobody owns the email and sign-up is open", async () => {
    db.user.count.mockResolvedValue(3);
    db.user.create.mockResolvedValue({ id: "u-new", email: "alice@example.com", displayName: "Alice G" });
    const user = profile();

    expect(await linkOAuthUser({ user, account, defaultDisplayName: "Google User" })).toBe(true);
    expect(db.user.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ email: "alice@example.com", role: "USER" }) }),
    );
    expect(db.authAccount.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: "u-new", providerAccountId: "google-sub-123" }) }),
    );
    expect(user.id).toBe("u-new");
  });

  it("makes the first account the admin, unless INITIAL_ADMIN_EMAIL names someone else", async () => {
    db.user.count.mockResolvedValue(0);
    db.user.create.mockImplementation(async ({ data }: { data: { role: string } }) => ({
      id: "u-first",
      email: "alice@example.com",
      displayName: "Alice G",
      role: data.role,
    }));

    await linkOAuthUser({ user: profile(), account, defaultDisplayName: "x" });
    expect(db.user.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: "SERVER_ADMIN" }) }),
    );

    process.env.INITIAL_ADMIN_EMAIL = "owner@example.com";
    await linkOAuthUser({ user: profile(), account, defaultDisplayName: "x" });
    expect(db.user.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: "USER" }) }),
    );
    expect(db.$transaction).toHaveBeenCalled();
  });

  it("denies unknown identities when public sign-up is closed", async () => {
    process.env.ALLOW_PUBLIC_SIGNUP = "false";
    expect(await linkOAuthUser({ user: profile(), account, defaultDisplayName: "x" })).toBe(false);
    expect(db.user.create).not.toHaveBeenCalled();
  });
});
