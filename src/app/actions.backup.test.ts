import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  user: {
    update: vi.fn(),
  },
  passwordResetToken: { deleteMany: vi.fn(), create: vi.fn() },
  authAccount: { deleteMany: vi.fn(), create: vi.fn() },
  budget: { deleteMany: vi.fn(), createMany: vi.fn() },
  budgetAlertNotification: { deleteMany: vi.fn() },
  recurringTransaction: { deleteMany: vi.fn(), create: vi.fn() },
  investmentFlow: { deleteMany: vi.fn(), create: vi.fn(), createMany: vi.fn() },
  portfolioSnapshot: { deleteMany: vi.fn(), create: vi.fn(), createMany: vi.fn() },
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

  it("ignores password reset tokens supplied in the backup file", async () => {
    // A crafted file can name a tokenHash whose raw value the author knows. Restoring it
    // would hand them a working reset link that outlives any password change.
    const backup = {
      ...minimalBackup("user@example.com"),
      passwordResetTokens: [
        {
          tokenHash: "attacker-known-hash",
          expiresAt: "2099-01-01T00:00:00.000Z",
          usedAt: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    };
    const file = new File([JSON.stringify(backup)], "backup.json", { type: "application/json" });
    const formData = new FormData();
    formData.set("backupJson", file);

    await importUserBackupAction(formData);

    expect(mockPrisma.passwordResetToken.create).not.toHaveBeenCalled();
    expect(mockPrisma.passwordResetToken.deleteMany).toHaveBeenCalled();
  });

  it("restores the link between a posted occurrence and its recurring rule", async () => {
    const iso = "2026-01-01T00:00:00.000Z";
    mockPrisma.account.create.mockResolvedValue({ id: "acc-new" });
    mockPrisma.category.create.mockResolvedValue({ id: "cat-new" });
    mockPrisma.recurringTransaction.create.mockResolvedValue({ id: "rule-new" });
    mockPrisma.transaction.create.mockResolvedValue({ id: "txn-new" });
    const backup = {
      ...minimalBackup("user@example.com"),
      accounts: [
        { id: "acc-old", name: "Chequing", type: "CHEQUING", currency: "CAD", countryCode: "CA", provider: null, archived: false, createdAt: iso, updatedAt: iso },
      ],
      categories: [{ id: "cat-old", name: "Rent", kind: "EXPENSE", isDefault: false, createdAt: iso, updatedAt: iso }],
      recurringTransactions: [
        {
          id: "rule-old",
          accountId: "acc-old",
          categoryId: "cat-old",
          type: "EXPENSE",
          name: "Rent",
          amountCents: 150_000,
          cadence: "MONTHLY",
          nextExpectedDate: "2026-03-01T00:00:00.000Z",
          endDate: null,
          postMode: "REVIEW",
          enabled: true,
          note: null,
          createdAt: iso,
          updatedAt: iso,
          members: [],
        },
      ],
      transactions: [
        {
          id: "txn-old",
          accountId: "acc-old",
          categoryId: "cat-old",
          type: "EXPENSE",
          amountCents: 150_000,
          preCreditCents: null,
          creditCents: null,
          creditBreakdownJson: null,
          title: "Rent",
          date: "2026-02-01T00:00:00.000Z",
          postedDate: null,
          accountDescription: null,
          note: null,
          recurringTransactionId: "rule-old",
          recurringExpectedDate: "2026-02-01T00:00:00.000Z",
          createdAt: iso,
          updatedAt: iso,
          splitParts: [],
        },
      ],
    };
    const file = new File([JSON.stringify(backup)], "backup.json", { type: "application/json" });
    const formData = new FormData();
    formData.set("backupJson", file);

    expect(await importUserBackupAction(formData)).toBeUndefined();

    expect(mockPrisma.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          recurringTransactionId: "rule-new",
          recurringExpectedDate: new Date("2026-02-01T00:00:00.000Z"),
        }),
      }),
    );
    // Rules are created before the transactions that reference them.
    const ruleOrder = mockPrisma.recurringTransaction.create.mock.invocationCallOrder[0];
    const txnOrder = mockPrisma.transaction.create.mock.invocationCallOrder[0];
    expect(ruleOrder).toBeLessThan(txnOrder);
  });

  it("refuses a file whose transaction points at a rule it does not contain", async () => {
    const iso = "2026-01-01T00:00:00.000Z";
    mockPrisma.account.create.mockResolvedValue({ id: "acc-new" });
    mockPrisma.category.create.mockResolvedValue({ id: "cat-new" });
    const backup = {
      ...minimalBackup("user@example.com"),
      accounts: [
        { id: "acc-old", name: "Chequing", type: "CHEQUING", currency: "CAD", countryCode: "CA", provider: null, archived: false, createdAt: iso, updatedAt: iso },
      ],
      categories: [{ id: "cat-old", name: "Rent", kind: "EXPENSE", isDefault: false, createdAt: iso, updatedAt: iso }],
      transactions: [
        {
          id: "txn-old", accountId: "acc-old", categoryId: "cat-old", type: "EXPENSE", amountCents: 1, preCreditCents: null,
          creditCents: null, creditBreakdownJson: null, title: null, date: iso, postedDate: null, accountDescription: null,
          note: null, recurringTransactionId: "rule-missing", recurringExpectedDate: iso, createdAt: iso, updatedAt: iso, splitParts: [],
        },
      ],
    };
    const file = new File([JSON.stringify(backup)], "backup.json", { type: "application/json" });
    const formData = new FormData();
    formData.set("backupJson", file);

    expect(await importUserBackupAction(formData)).toEqual({
      ok: false,
      error: "Backup references unknown recurring transaction.",
    });
    expect(mockPrisma.transaction.create).not.toHaveBeenCalled();
  });

  it("never touches linked SSO identities, whatever the file contains", async () => {
    // Linking a provider requires a fresh passkey assertion; a plain session uploading a
    // file must not be able to attach (or silently drop) provider identities.
    const payload = JSON.stringify(minimalBackup("user@example.com"));
    const file = new File([payload], "backup.json", { type: "application/json" });
    const formData = new FormData();
    formData.set("backupJson", file);

    await importUserBackupAction(formData);

    expect(mockPrisma.authAccount.create).not.toHaveBeenCalled();
    expect(mockPrisma.authAccount.deleteMany).not.toHaveBeenCalled();
  });
});
