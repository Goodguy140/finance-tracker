import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextAuthOptions } from "next-auth";
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
}));

const { getAuthOptions } = await import("@/lib/auth-options");

type JwtCallback = NonNullable<NonNullable<NextAuthOptions["callbacks"]>["jwt"]>;

/**
 * next-auth types `user` and `account` as always present on the jwt callback, but at
 * runtime it passes neither on any request after the initial sign-in — which is the
 * path these tests exercise. Build the params once here rather than casting per call.
 */
function subsequentRequest(token: JWT): Parameters<JwtCallback>[0] {
  return { token, trigger: "update" } as unknown as Parameters<JwtCallback>[0];
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
