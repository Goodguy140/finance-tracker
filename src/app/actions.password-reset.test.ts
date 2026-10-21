import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => {
  const db = {
    user: { findUnique: vi.fn(), update: vi.fn() },
    passwordResetToken: { create: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
  };
  return db;
});

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
vi.mock("@/lib/audit-log", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/audit-log")>()),
  recordAuditLog: vi.fn(),
}));

const { requestPasswordResetAction, resetPasswordAction } = await import("./actions/auth");
const { hash } = await import("bcryptjs");
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

describe("resetPasswordAction", () => {
  const token = "reset-token-secret";

  function resetForm() {
    const formData = new FormData();
    formData.set("email", "user@example.com");
    formData.set("token", token);
    formData.set("newPassword", "new-password-123");
    return formData;
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    mockPrisma.user.findUnique.mockResolvedValue({ id: "u1", email: "user@example.com", passwordHash: "$2a$12$hash" });
    mockPrisma.passwordResetToken.findMany.mockResolvedValue([{ id: "t1", tokenHash: await hash(token, 4) }]);
  });

  it("claims the presented token, burns the rest and sets the password", async () => {
    mockPrisma.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });

    await resetPasswordAction(resetForm());

    expect(mockPrisma.passwordResetToken.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: "t1", usedAt: null },
      data: { usedAt: expect.any(Date) },
    });
    expect(mockPrisma.user.update).toHaveBeenCalledTimes(1);
  });

  it("changes nothing when a concurrent reset claimed the same token first", async () => {
    // The token matched, but by the time this request's transaction runs it has been used.
    mockPrisma.passwordResetToken.updateMany.mockResolvedValue({ count: 0 });

    const result = await resetPasswordAction(resetForm());

    expect(result).toMatchObject({ ok: false, error: "Invalid or expired token." });
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });
});
