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
  transaction: { deleteMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  account: { deleteMany: vi.fn(), create: vi.fn() },
  category: { deleteMany: vi.fn(), create: vi.fn() },
  plaidItem: { deleteMany: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  plaidAccount: { deleteMany: vi.fn() },
  plaidStagedTransaction: { deleteMany: vi.fn() },
  transactionVerification: { deleteMany: vi.fn(), create: vi.fn() },
  transactionRule: { deleteMany: vi.fn(), createMany: vi.fn() },
  hiddenTitleSuggestion: { deleteMany: vi.fn(), createMany: vi.fn() },
  insightDismissal: { deleteMany: vi.fn(), createMany: vi.fn() },
  insightPreference: { deleteMany: vi.fn(), create: vi.fn() },
  contributionRoom: { deleteMany: vi.fn(), createMany: vi.fn() },
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

const plaidRevoker = vi.hoisted(() => ({ current: null as null | ((item: { itemId: string }) => Promise<void>) }));
vi.mock("@/lib/plaid/service", () => ({
  tryMakePlaidItemRevoker: vi.fn(async () => plaidRevoker.current),
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
    mockPrisma.plaidItem.findMany.mockResolvedValue([]);
    mockPrisma.plaidItem.count.mockResolvedValue(0);
    plaidRevoker.current = null;
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

  it("restores transaction rules and hidden titles with remapped ids", async () => {
    const iso = "2026-01-01T00:00:00.000Z";
    mockPrisma.account.create.mockResolvedValue({ id: "acc-new" });
    mockPrisma.category.create.mockResolvedValue({ id: "cat-new" });
    const backup = {
      ...minimalBackup("user@example.com"),
      accounts: [
        { id: "acc-old", name: "Chequing", type: "CHEQUING", currency: "CAD", countryCode: "CA", provider: null, archived: false, createdAt: iso, updatedAt: iso },
      ],
      categories: [{ id: "cat-old", name: "Streaming", kind: "EXPENSE", isDefault: false, createdAt: iso, updatedAt: iso }],
      transactionRules: [
        {
          priority: 0,
          enabled: true,
          titleOperator: "CONTAINS",
          titlePattern: "netflix",
          transactionType: "EXPENSE",
          matchAccountId: "acc-old",
          minAmountCents: null,
          maxAmountCents: null,
          setCategoryId: "cat-old",
          setTitle: "Netflix",
          setAmountCents: null,
          setAccountId: null,
          appendNote: null,
          createdAt: iso,
        },
      ],
      hiddenTitleSuggestions: [{ titleKey: "coffee" }, { titleKey: "coffee" }],
      insightDismissals: [
        { insightKey: "habit:ALCOHOL", snoozedUntil: null },
        { insightKey: "recurring:EXPENSE:netflix", snoozedUntil: iso },
      ],
      insightPreference: { habitDetectionEnabled: false },
      contributionRooms: [
        { accountType: "TFSA", year: 2026, roomCents: 100_000 },
        { accountType: "TFSA", year: 2026, roomCents: 2_500_000 },
        { accountType: "RRSP", year: 2025, roomCents: 1_800_000 },
      ],
    };
    const file = new File([JSON.stringify(backup)], "backup.json", { type: "application/json" });
    const formData = new FormData();
    formData.set("backupJson", file);

    expect(await importUserBackupAction(formData)).toBeUndefined();

    expect(mockPrisma.transactionRule.deleteMany).toHaveBeenCalledWith({ where: { userId: "user-1" } });
    expect(mockPrisma.transactionRule.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          userId: "user-1",
          titlePattern: "netflix",
          matchAccountId: "acc-new",
          setCategoryId: "cat-new",
          setAccountId: null,
          setTitle: "Netflix",
        }),
      ],
    });
    expect(mockPrisma.hiddenTitleSuggestion.createMany).toHaveBeenCalledWith({
      data: [{ userId: "user-1", titleKey: "coffee" }],
    });
    expect(mockPrisma.insightDismissal.deleteMany).toHaveBeenCalledWith({ where: { userId: "user-1" } });
    expect(mockPrisma.insightDismissal.createMany).toHaveBeenCalledWith({
      data: [
        { userId: "user-1", insightKey: "habit:ALCOHOL", snoozedUntil: null },
        { userId: "user-1", insightKey: "recurring:EXPENSE:netflix", snoozedUntil: new Date(iso) },
      ],
    });
    expect(mockPrisma.insightPreference.create).toHaveBeenCalledWith({
      data: { userId: "user-1", habitDetectionEnabled: false },
    });
    expect(mockPrisma.contributionRoom.deleteMany).toHaveBeenCalledWith({ where: { userId: "user-1" } });
    expect(mockPrisma.contributionRoom.createMany).toHaveBeenCalledWith({
      data: [
        { userId: "user-1", accountType: "TFSA", year: 2026, roomCents: 2_500_000 },
        { userId: "user-1", accountType: "RRSP", year: 2025, roomCents: 1_800_000 },
      ],
    });
  });

  it("refuses a file whose rule points at a category it does not contain", async () => {
    const iso = "2026-01-01T00:00:00.000Z";
    const backup = {
      ...minimalBackup("user@example.com"),
      transactionRules: [
        {
          priority: 0,
          enabled: true,
          titleOperator: "CONTAINS",
          titlePattern: "netflix",
          transactionType: null,
          matchAccountId: null,
          minAmountCents: null,
          maxAmountCents: null,
          setCategoryId: "cat-missing",
          setTitle: null,
          setAmountCents: null,
          setAccountId: null,
          appendNote: null,
          createdAt: iso,
        },
      ],
    };
    const file = new File([JSON.stringify(backup)], "backup.json", { type: "application/json" });
    const formData = new FormData();
    formData.set("backupJson", file);

    expect(await importUserBackupAction(formData)).toEqual({
      ok: false,
      error: "Backup references unknown rule account or category.",
    });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
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

  it("restores a counted transfer's link under the transfer's new id", async () => {
    const iso = "2026-01-01T00:00:00.000Z";
    mockPrisma.account.create.mockResolvedValue({ id: "acc-new" });
    mockPrisma.category.create.mockResolvedValue({ id: "cat-new" });
    mockPrisma.transaction.create.mockResolvedValue({ id: "txn-new" });
    const backup = {
      ...minimalBackup("user@example.com"),
      accounts: [
        { id: "acc-old", name: "TFSA", type: "TFSA", currency: "CAD", countryCode: "CA", provider: null, archived: false, createdAt: iso, updatedAt: iso },
      ],
      categories: [{ id: "cat-old", name: "Transfer", kind: "EXPENSE", isDefault: false, createdAt: iso, updatedAt: iso }],
      transactions: [
        {
          id: "txn-old", accountId: "acc-old", categoryId: "cat-old", type: "TRANSFER", amountCents: -50000, preCreditCents: null,
          creditCents: null, creditBreakdownJson: null, title: null, date: iso, postedDate: null, accountDescription: null,
          note: null, recurringTransactionId: null, recurringExpectedDate: null, createdAt: iso, updatedAt: iso, splitParts: [],
        },
      ],
      investmentFlows: [
        { accountId: "acc-old", date: iso, direction: "CONTRIBUTION", amountCents: 50000, note: null, transactionId: "txn-old", createdAt: iso },
      ],
    };
    const file = new File([JSON.stringify(backup)], "backup.json", { type: "application/json" });
    const formData = new FormData();
    formData.set("backupJson", file);

    await importUserBackupAction(formData);

    expect(mockPrisma.investmentFlow.createMany.mock.calls[0]?.[0]?.data).toEqual([
      expect.objectContaining({ accountId: "acc-new", transactionId: "txn-new" }),
    ]);
  });

  it("restores both legs of a paired transfer, each pointing at the other's new id", async () => {
    const iso = "2026-01-01T00:00:00.000Z";
    mockPrisma.account.create.mockResolvedValueOnce({ id: "chq-new" }).mockResolvedValueOnce({ id: "visa-new" });
    mockPrisma.category.create.mockResolvedValue({ id: "cat-new" });
    mockPrisma.transaction.create.mockResolvedValueOnce({ id: "out-new" }).mockResolvedValueOnce({ id: "in-new" });
    const account = (id: string, name: string, type: string) => ({
      id, name, type, currency: "CAD", countryCode: "CA", provider: null, archived: false, createdAt: iso, updatedAt: iso,
    });
    const leg = (id: string, accountId: string, amountCents: number, transferAccountId: string, transferPeerId: string) => ({
      id, accountId, categoryId: "cat-old", type: "TRANSFER", amountCents, preCreditCents: null, creditCents: null,
      creditBreakdownJson: null, title: null, date: iso, postedDate: null, accountDescription: null, note: null,
      recurringTransactionId: null, recurringExpectedDate: null, transferAccountId, transferPeerId,
      createdAt: iso, updatedAt: iso, splitParts: [],
    });
    const backup = {
      ...minimalBackup("user@example.com"),
      accounts: [account("chq-old", "Chequing", "CHEQUING"), account("visa-old", "Visa", "CREDIT_CARD")],
      categories: [{ id: "cat-old", name: "Transfers", kind: "TRANSFER", isDefault: false, createdAt: iso, updatedAt: iso }],
      transactions: [
        leg("out-old", "chq-old", 50000, "visa-old", "in-old"),
        leg("in-old", "visa-old", -50000, "chq-old", "out-old"),
      ],
    };
    const file = new File([JSON.stringify(backup)], "backup.json", { type: "application/json" });
    const formData = new FormData();
    formData.set("backupJson", file);

    await importUserBackupAction(formData);

    expect(mockPrisma.transaction.create.mock.calls.map((call) => call[0].data.transferAccountId)).toEqual([
      "visa-new",
      "chq-new",
    ]);
    expect(mockPrisma.transaction.update.mock.calls.map((call) => call[0])).toEqual([
      { where: { id: "out-new" }, data: { transferPeerId: "in-new" } },
      { where: { id: "in-new" }, data: { transferPeerId: "out-new" } },
    ]);
  });

  it("refuses a file whose transfer points at a leg it does not contain", async () => {
    const iso = "2026-01-01T00:00:00.000Z";
    const backup = {
      ...minimalBackup("user@example.com"),
      categories: [{ id: "cat-old", name: "Transfers", kind: "TRANSFER", isDefault: false, createdAt: iso, updatedAt: iso }],
      transactions: [
        {
          id: "out-old", accountId: null, categoryId: "cat-old", type: "TRANSFER", amountCents: 50000, preCreditCents: null,
          creditCents: null, creditBreakdownJson: null, title: null, date: iso, postedDate: null, accountDescription: null,
          note: null, recurringTransactionId: null, recurringExpectedDate: null, transferAccountId: null,
          transferPeerId: "in-missing", createdAt: iso, updatedAt: iso, splitParts: [],
        },
      ],
    };
    const file = new File([JSON.stringify(backup)], "backup.json", { type: "application/json" });
    const formData = new FormData();
    formData.set("backupJson", file);

    expect(await importUserBackupAction(formData)).toEqual({
      ok: false,
      error: "Backup references unknown transfer leg.",
    });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("refuses a file whose contribution points at a transfer it does not contain", async () => {
    const iso = "2026-01-01T00:00:00.000Z";
    const backup = {
      ...minimalBackup("user@example.com"),
      accounts: [
        { id: "acc-old", name: "TFSA", type: "TFSA", currency: "CAD", countryCode: "CA", provider: null, archived: false, createdAt: iso, updatedAt: iso },
      ],
      investmentFlows: [
        { accountId: "acc-old", date: iso, direction: "CONTRIBUTION", amountCents: 50000, note: null, transactionId: "txn-missing", createdAt: iso },
      ],
    };
    const file = new File([JSON.stringify(backup)], "backup.json", { type: "application/json" });
    const formData = new FormData();
    formData.set("backupJson", file);

    expect(await importUserBackupAction(formData)).toEqual({
      ok: false,
      error: "Backup references unknown counted transfer.",
    });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
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
  describe("linked banks", () => {
    const linked = [
      { id: "row-1", itemId: "item-1", accessTokenEnc: "enc-1" },
      { id: "row-2", itemId: "item-2", accessTokenEnc: "enc-2" },
    ];
    function backupForm(backup: object = minimalBackup("user@example.com")) {
      const formData = new FormData();
      formData.set("backupJson", new File([JSON.stringify(backup)], "backup.json", { type: "application/json" }));
      return formData;
    }

    it("revokes every linked bank at Plaid before wiping its rows", async () => {
      // Backups carry no bank connections, so the wipe is the end of them. Deleting the
      // rows without /item/remove would leave the Items live and billing at Plaid.
      mockPrisma.plaidItem.findMany.mockResolvedValue(linked);
      const revoke = vi.fn(async (_item: { itemId: string }) => {});
      plaidRevoker.current = revoke;

      expect(await importUserBackupAction(backupForm())).toBeUndefined();

      expect(revoke.mock.calls.map(([item]) => item.itemId)).toEqual(["item-1", "item-2"]);
      expect(mockPrisma.plaidItem.deleteMany).toHaveBeenCalledWith({ where: { userId: "user-1" } });
      const lastRevoke = Math.max(...revoke.mock.invocationCallOrder);
      expect(lastRevoke).toBeLessThan(mockPrisma.plaidItem.deleteMany.mock.invocationCallOrder[0]);
    });

    it("imports nothing when a bank cannot be revoked", async () => {
      mockPrisma.plaidItem.findMany.mockResolvedValue(linked);
      plaidRevoker.current = vi.fn(async (item: { itemId: string }) => {
        if (item.itemId === "item-2") throw new Error("plaid down");
      });

      const result = await importUserBackupAction(backupForm());

      expect(result).toMatchObject({ ok: false, error: expect.stringContaining("Could not revoke 1 of 2") });
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockPrisma.plaidItem.deleteMany).not.toHaveBeenCalled();
    });

    it("imports nothing when banks are linked but Plaid is not configured to revoke them", async () => {
      mockPrisma.plaidItem.findMany.mockResolvedValue(linked);

      const result = await importUserBackupAction(backupForm());

      expect(result).toMatchObject({ ok: false, error: expect.stringContaining("cannot be revoked right now") });
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it("refuses a malformed file before disconnecting anything", async () => {
      // The reference checks inside the transaction would roll the data back, but not the
      // revocations — so a bad file has to be caught while the banks are still connected.
      mockPrisma.plaidItem.findMany.mockResolvedValue(linked);
      const revoke = vi.fn(async () => {});
      plaidRevoker.current = revoke;
      const iso = "2026-01-01T00:00:00.000Z";
      const backup = {
        ...minimalBackup("user@example.com"),
        budgets: [{ categoryId: "cat-missing", name: null, periodMonth: "2026-01", limitCents: 1, createdAt: iso, updatedAt: iso }],
      };

      expect(await importUserBackupAction(backupForm(backup))).toEqual({
        ok: false,
        error: "Backup references unknown budget category.",
      });
      expect(revoke).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it("refuses to delete a bank linked after the revocations ran", async () => {
      mockPrisma.plaidItem.findMany.mockResolvedValue(linked);
      plaidRevoker.current = vi.fn(async () => {});
      mockPrisma.plaidItem.count.mockResolvedValue(1);

      const result = await importUserBackupAction(backupForm());

      expect(result).toMatchObject({ ok: false, error: expect.stringContaining("bank was connected") });
      expect(mockPrisma.plaidItem.count).toHaveBeenCalledWith({
        where: { userId: "user-1", id: { notIn: ["row-1", "row-2"] } },
      });
      expect(mockPrisma.plaidItem.deleteMany).not.toHaveBeenCalled();
    });

    it("needs no Plaid client when nothing is linked", async () => {
      expect(await importUserBackupAction(backupForm())).toBeUndefined();
      expect(mockPrisma.plaidItem.deleteMany).toHaveBeenCalled();
    });
  });
});
