import { beforeEach, describe, expect, it, vi } from "vitest";

const mockTx = vi.hoisted(() => ({
  rateLimitEntry: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(async (fn: (tx: typeof mockTx) => Promise<void>) => fn(mockTx)),
  },
}));

const { enforceSlidingWindowRateLimit } = await import("@/lib/rate-limit");

describe("enforceSlidingWindowRateLimit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a new window when no entry exists", async () => {
    mockTx.rateLimitEntry.findUnique.mockResolvedValue(null);
    await enforceSlidingWindowRateLimit("login:test", 5, 60_000, "Too many");
    expect(mockTx.rateLimitEntry.upsert).toHaveBeenCalled();
  });

  it("throws when limit exceeded within window", async () => {
    mockTx.rateLimitEntry.findUnique.mockResolvedValue({
      key: "login:test",
      count: 5,
      resetAt: new Date(Date.now() + 60_000),
    });
    await expect(
      enforceSlidingWindowRateLimit("login:test", 5, 60_000, "Too many"),
    ).rejects.toThrow("Too many");
  });

  it("increments count when under limit", async () => {
    mockTx.rateLimitEntry.findUnique.mockResolvedValue({
      key: "login:test",
      count: 2,
      resetAt: new Date(Date.now() + 60_000),
    });
    await enforceSlidingWindowRateLimit("login:test", 5, 60_000, "Too many");
    expect(mockTx.rateLimitEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { count: 3 } }),
    );
  });
});
