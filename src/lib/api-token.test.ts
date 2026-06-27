import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const {
  generateApiToken,
  hashApiToken,
  parseBearerToken,
  tokenHasScope,
  authenticateApiToken,
} = await import("./api-token");

function reqWithAuth(header?: string): Request {
  return new Request("http://localhost/api/v1/budgets", {
    headers: header ? { authorization: header } : {},
  });
}

function fakeClient(record: unknown) {
  return {
    personalAccessToken: {
      findUnique: vi.fn(async () => record),
      update: vi.fn(async () => ({})),
    },
  } as never;
}

describe("token generation & hashing", () => {
  it("generates a prefixed token whose hash and prefix match the raw value", () => {
    const { raw, hash, prefix } = generateApiToken();
    expect(raw.startsWith("ft_")).toBe(true);
    expect(hash).toBe(hashApiToken(raw));
    expect(prefix).toBe(raw.slice(0, 10));
    expect(hash).toHaveLength(64); // sha256 hex
  });

  it("produces unique tokens", () => {
    expect(generateApiToken().raw).not.toBe(generateApiToken().raw);
  });
});

describe("parseBearerToken", () => {
  it("extracts the token from a Bearer header", () => {
    expect(parseBearerToken("Bearer abc.def")).toBe("abc.def");
    expect(parseBearerToken("bearer abc")).toBe("abc");
  });
  it("returns null for missing or malformed headers", () => {
    expect(parseBearerToken(null)).toBeNull();
    expect(parseBearerToken("Basic abc")).toBeNull();
  });
});

describe("tokenHasScope", () => {
  it("matches an exact scope in a CSV list", () => {
    expect(tokenHasScope("budgets:read,other:write", "budgets:read")).toBe(true);
    expect(tokenHasScope("other:write", "budgets:read")).toBe(false);
  });
});

describe("authenticateApiToken", () => {
  const validRecord = {
    id: "t1",
    userId: "u1",
    scopes: "budgets:read",
    revokedAt: null,
    expiresAt: null,
    user: { id: "u1", email: "u@example.com" },
  };

  it("returns unauthorized when no Authorization header is present", async () => {
    const res = await authenticateApiToken(reqWithAuth(), "budgets:read", fakeClient(null));
    expect(res.status).toBe("unauthorized");
  });

  it("returns unauthorized for an unknown token", async () => {
    const res = await authenticateApiToken(reqWithAuth("Bearer nope"), "budgets:read", fakeClient(null));
    expect(res.status).toBe("unauthorized");
  });

  it("returns ok with the owning user for a valid token", async () => {
    const res = await authenticateApiToken(reqWithAuth("Bearer ft_x"), "budgets:read", fakeClient(validRecord));
    expect(res.status).toBe("ok");
    if (res.status === "ok") {
      expect(res.user.id).toBe("u1");
      expect(res.token.id).toBe("t1");
    }
  });

  it("rejects a revoked token", async () => {
    const res = await authenticateApiToken(
      reqWithAuth("Bearer ft_x"),
      "budgets:read",
      fakeClient({ ...validRecord, revokedAt: new Date() }),
    );
    expect(res.status).toBe("unauthorized");
  });

  it("rejects an expired token", async () => {
    const res = await authenticateApiToken(
      reqWithAuth("Bearer ft_x"),
      "budgets:read",
      fakeClient({ ...validRecord, expiresAt: new Date(Date.now() - 1000) }),
    );
    expect(res.status).toBe("unauthorized");
  });

  it("returns forbidden when the required scope is missing", async () => {
    const res = await authenticateApiToken(
      reqWithAuth("Bearer ft_x"),
      "budgets:read",
      fakeClient({ ...validRecord, scopes: "other:write" }),
    );
    expect(res.status).toBe("forbidden");
  });
});
