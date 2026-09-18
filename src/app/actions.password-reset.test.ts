import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  passwordResetToken: { create: vi.fn() },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/lib/rate-limit", () => ({
  enforceSlidingWindowRateLimit: vi.fn(),
}));
vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn(async () => ({ sent: true })),
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/oauth-provider-config", () => ({ isPasswordLoginDisabled: vi.fn(async () => false) }));

const { requestPasswordResetAction } = await import("./actions/auth");
const { sendEmail } = await import("@/lib/email");

describe("requestPasswordResetAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXTAUTH_URL = "http://127.0.0.1:3050";
    mockPrisma.user.findUnique.mockResolvedValue({ id: "u1", email: "user@example.com", passwordHash: "$2a$12$hash" });
    mockPrisma.passwordResetToken.create.mockResolvedValue({});
  });

  it("creates a token and sends reset email when user exists", async () => {
    const formData = new FormData();
    formData.set("email", "user@example.com");

    await requestPasswordResetAction(formData);

    expect(mockPrisma.passwordResetToken.create).toHaveBeenCalled();
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "user@example.com",
        subject: expect.stringContaining("Reset"),
      }),
    );
  });

  it("stays silent for an account that has no password (SSO or passkey only)", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: "u2", email: "sso@example.com", passwordHash: null });
    const formData = new FormData();
    formData.set("email", "sso@example.com");

    await requestPasswordResetAction(formData);

    expect(mockPrisma.passwordResetToken.create).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
