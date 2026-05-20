import { beforeEach, describe, expect, it, vi } from "vitest";

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

    const token = { email: "user@example.com", sub: "u1", role: "USER" as const };
    await jwt!({ token, user: undefined, account: undefined, trigger: "update" });
    await jwt!({ token, user: undefined, account: undefined, trigger: "update" });

    expect(findUnique).toHaveBeenCalledTimes(1);
  });
});
