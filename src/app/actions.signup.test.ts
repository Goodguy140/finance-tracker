import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UserRole } from "@prisma/client";

const mockPrisma = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ enforceSlidingWindowRateLimit: vi.fn() }));
vi.mock("@/lib/defaults", () => ({ ensureDefaultDataForUser: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

const { signupAction } = await import("./actions/auth");

function signupForm(email: string) {
  const data = new FormData();
  data.set("email", email);
  data.set("password", "password1234");
  data.set("displayName", "New User");
  data.set("countryCode", "CA");
  data.set("timezone", "America/Toronto");
  return data;
}

describe("signupAction", () => {
  const env = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...env, ALLOW_PUBLIC_SIGNUP: "true", NODE_ENV: "test" };
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.user.count.mockResolvedValue(0);
    mockPrisma.user.create.mockImplementation(async ({ data }: { data: { role: UserRole } }) => ({
      id: "new",
      ...data,
    }));
  });

  afterEach(() => {
    process.env = env;
  });

  it("first signup is SERVER_ADMIN when INITIAL_ADMIN_EMAIL is unset", async () => {
    delete process.env.INITIAL_ADMIN_EMAIL;
    await signupAction(signupForm("first@example.com"));
    expect(mockPrisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ role: UserRole.SERVER_ADMIN }),
      }),
    );
  });

  it("only INITIAL_ADMIN_EMAIL becomes admin on first signup", async () => {
    process.env.INITIAL_ADMIN_EMAIL = "admin@example.com";
    await signupAction(signupForm("other@example.com"));
    expect(mockPrisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ role: UserRole.USER }),
      }),
    );

    vi.clearAllMocks();
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.user.count.mockResolvedValue(0);
    await signupAction(signupForm("admin@example.com"));
    expect(mockPrisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ role: UserRole.SERVER_ADMIN }),
      }),
    );
  });
});
