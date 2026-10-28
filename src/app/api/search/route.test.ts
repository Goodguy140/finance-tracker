import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUserApiUser: vi.fn() }));
vi.mock("@/lib/search/search-data", () => ({
  searchUserData: vi.fn(async () => ({ groups: [], transactionTotal: 0 })),
}));
vi.mock("@/lib/search/quick-add-server", () => ({ previewQuickAdd: vi.fn(async () => null) }));
vi.mock("@/lib/search/saved-searches", () => ({ savedSearchHits: vi.fn(async () => []) }));
vi.mock("@/lib/prisma", () => ({
  prisma: { plaidItem: { count: vi.fn(async () => 2) } },
}));

const { requireUserApiUser } = await import("@/lib/session");
const { searchUserData } = await import("@/lib/search/search-data");
const { GET } = await import("./route");

const request = (q: string) => new Request(`http://localhost/api/search?q=${encodeURIComponent(q)}`);

describe("GET /api/search", () => {
  beforeEach(() => {
    vi.mocked(requireUserApiUser).mockReset();
    vi.mocked(searchUserData).mockClear();
  });

  it("answers 401 signed out and 403 while a passkey check is owed, without searching", async () => {
    vi.mocked(requireUserApiUser).mockResolvedValue({ status: 401 });
    expect((await GET(request("coffee"))).status).toBe(401);
    vi.mocked(requireUserApiUser).mockResolvedValue({ status: 403, reason: "mfa_required" });
    expect((await GET(request("coffee"))).status).toBe(403);
    expect(searchUserData).not.toHaveBeenCalled();
  });

  it("searches as the signed-in user, with a capped query, and says what the palette may offer", async () => {
    vi.mocked(requireUserApiUser).mockResolvedValue({
      status: "ok",
      user: { id: "u1", countryCode: "CA", role: "USER" } as never,
    });
    const res = await GET(request("x".repeat(500)));
    expect(res.status).toBe(200);
    expect(vi.mocked(searchUserData).mock.calls[0][1]).toMatchObject({ id: "u1" });
    expect(vi.mocked(searchUserData).mock.calls[0][2]).toHaveLength(100);
    expect(await res.json()).toEqual({
      groups: [],
      transactionTotal: 0,
      quickAdd: null,
      saved: [],
      context: { isAdmin: false, hasBanks: true },
    });
  });
});
