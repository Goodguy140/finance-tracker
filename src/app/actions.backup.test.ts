import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  user: {
    update: vi.fn(),
  },
  passwordResetToken: { deleteMany: vi.fn() },
  authAccount: { deleteMany: vi.fn(), create: vi.fn() },
  budget: { deleteMany: vi.fn() },
  recurringTransaction: { deleteMany: vi.fn(), create: vi.fn() },
  investmentFlow: { deleteMany: vi.fn(), create: vi.fn() },
  portfolioSnapshot: { deleteMany: vi.fn(), create: vi.fn() },
  transaction: { deleteMany: vi.fn(), create: vi.fn() },
  account: { deleteMany: vi.fn(), create: vi.fn() },
  category: { deleteMany: vi.fn(), create: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
}));

vi.mock("@/lib/session", () => ({
  requireUser: vi.fn(async () => ({
    id: "user-1",
    email: "user@example.com",
    role: "USER",
    passwordHash: "keep-hash",
  })),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
}));

vi.mock("@/lib/audit-log", () => ({
  AUDIT_ACTIONS: { user_backup_imported: "user_backup_imported" },
  recordAuditLog: vi.fn(),
}));

const { importUserBackupAction } = await import("./actions/backup");

function minimalBackup(email: string) {
  const iso = "2026-01-01T00:00:00.000Z";
  return {
    version: 1 as const,
    exportedAt: iso,
    user: {
      email,
      displayName: "Imported",
      timezone: "America/Toronto",
      countryCode: "CA",
      role: "SERVER_ADMIN" as const,
      passwordHash: "stolen-hash",
      emailVerifiedAt: null,
      createdAt: iso,
      updatedAt: iso,
    },
    authAccounts: [
      {
        provider: "google",
        providerAccountId: "ga-1",
        accessToken: "secret-at",
        refreshToken: "secret-rt",
        expiresAt: null,
        tokenType: null,
        scope: null,
        idToken: "secret-id",
        createdAt: iso,
        updatedAt: iso,
      },
    ],
    passwordResetTokens: [],
    accounts: [],
    categories: [],
    transactions: [],
    budgets: [],
    recurringTransactions: [],
    investmentFlows: [],
    portfolioSnapshots: [],
  };
}

describe("importUserBackupAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => Promise<void>) => {
      await fn(mockPrisma);
    });
    mockPrisma.user.update.mockResolvedValue({});
  });

  it("does not restore role or passwordHash from backup", async () => {
    const payload = JSON.stringify(minimalBackup("user@example.com"));
    const file = new File([payload], "backup.json", { type: "application/json" });
    const formData = new FormData();
    formData.set("backupJson", file);

    await importUserBackupAction(formData);

    const profileUpdate = mockPrisma.user.update.mock.calls.find(
      (call) => call[0]?.data && "displayName" in (call[0].data as object),
    );
    expect(profileUpdate?.[0]?.data).toMatchObject({
      displayName: "Imported",
      role: "USER",
      passwordHash: "keep-hash",
    });
  });

  it("strips OAuth tokens when restoring auth accounts", async () => {
    const payload = JSON.stringify(minimalBackup("user@example.com"));
    const file = new File([payload], "backup.json", { type: "application/json" });
    const formData = new FormData();
    formData.set("backupJson", file);

    await importUserBackupAction(formData);

    expect(mockPrisma.authAccount.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          accessToken: null,
          refreshToken: null,
          idToken: null,
        }),
      }),
    );
  });
});
