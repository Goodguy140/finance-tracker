import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  account: { count: vi.fn() },
  category: { count: vi.fn() },
  tag: { count: vi.fn() },
  savedSearch: { count: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "user-1" })) }));
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

const { saveSearchAction } = await import("./saved-searches");

function form(entries: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

describe("saveSearchAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.account.count.mockResolvedValue(1);
    mockPrisma.category.count.mockResolvedValue(1);
    mockPrisma.tag.count.mockResolvedValue(1);
    mockPrisma.savedSearch.count.mockResolvedValue(0);
  });

  it("saves the filters on screen under the name given", async () => {
    expect(
      await saveSearchAction(form({ name: " Coffee ", q: "coffee", type: "EXPENSE", category: "cat-1", account: "", tag: "" })),
    ).toBeUndefined();
    expect(mockPrisma.savedSearch.create).toHaveBeenCalledWith({
      data: { userId: "user-1", name: "Coffee", query: "coffee", type: "EXPENSE", accountId: null, categoryId: "cat-1", tagId: null },
    });
    expect(mockPrisma.category.count).toHaveBeenCalledWith({ where: { id: "cat-1", userId: "user-1" } });
  });

  it("refuses a filter that is not the user's, rather than saving a wider search", async () => {
    mockPrisma.category.count.mockResolvedValue(0);
    expect(await saveSearchAction(form({ name: "Theirs", category: "someone-elses" }))).toMatchObject({ ok: false });
    expect(await saveSearchAction(form({ name: "Nothing" }))).toMatchObject({ ok: false, error: expect.stringMatching(/Search for something/) });
    expect(mockPrisma.savedSearch.create).not.toHaveBeenCalled();
  });
});
