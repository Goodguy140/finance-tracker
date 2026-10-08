import { describe, expect, it } from "vitest";
import { sanitizeBackupPayload, type UserBackupPayload } from "@/lib/backup";

function fixture(): UserBackupPayload {
  const iso = "2026-01-01T00:00:00.000Z";
  return {
    version: 1,
    exportedAt: iso,
    user: {
      email: "u@example.com",
      displayName: "User",
      timezone: "America/Toronto",
      countryCode: "CA",
      role: "USER",
      passwordHash: "secret-hash",
      emailVerifiedAt: null,
      createdAt: iso,
      updatedAt: iso,
    },
    authAccounts: [
      {
        provider: "google",
        providerAccountId: "1",
        accessToken: "at",
        refreshToken: "rt",
        expiresAt: null,
        tokenType: null,
        scope: null,
        idToken: "id",
        createdAt: iso,
        updatedAt: iso,
      },
    ],
    passwordResetTokens: [
      {
        tokenHash: "hash",
        expiresAt: iso,
        usedAt: null,
        createdAt: iso,
      },
    ],
    accounts: [],
    categories: [],
    transactions: [],
    budgets: [],
    recurringTransactions: [],
    investmentFlows: [],
    portfolioSnapshots: [],
    accountBalances: [],
  };
}

describe("sanitizeBackupPayload", () => {
  it("removes password hash, OAuth tokens, and reset tokens", () => {
    const sanitized = sanitizeBackupPayload(fixture());

    expect(sanitized.user.passwordHash).toBeNull();
    expect(sanitized.authAccounts[0]?.accessToken).toBeNull();
    expect(sanitized.authAccounts[0]?.refreshToken).toBeNull();
    expect(sanitized.authAccounts[0]?.idToken).toBeNull();
    expect(sanitized.passwordResetTokens).toEqual([]);
    expect(sanitized.user.role).toBe("USER");
    expect(sanitized.user.email).toBe("u@example.com");
  });
});

describe("transactionVerifications in a backup", () => {
  it("survives sanitising, because nothing in it is a secret", () => {
    const payload = fixture();
    payload.transactionVerifications = [
      {
        transactionId: "txn-1",
        source: "MATCHED",
        institutionName: "Test Credit Union",
        verifiedAt: "2026-02-01T00:00:00.000Z",
        removedByPlaidAt: null,
      },
    ];
    const sanitized = sanitizeBackupPayload(payload);
    expect(sanitized.transactionVerifications).toHaveLength(1);
    expect(sanitized.transactionVerifications?.[0]?.institutionName).toBe("Test Credit Union");
  });

  it("carries no Plaid identifiers and no bank connection", () => {
    // The export must never contain an access token, item id, or Plaid transaction id:
    // they belong to the Plaid client of the deployment that produced them, and the
    // retention doc already treats a backup file as a credential.
    const payload = fixture();
    payload.transactionVerifications = [
      {
        transactionId: "txn-1",
        source: "IMPORTED",
        institutionName: "Test Credit Union",
        verifiedAt: "2026-02-01T00:00:00.000Z",
        removedByPlaidAt: null,
      },
    ];
    const serialized = JSON.stringify(sanitizeBackupPayload(payload));
    // Plaid-specific only: `accessToken` on its own would match the existing OAuth field,
    // whose value sanitising already nulls (covered above).
    for (const forbidden of [
      "accessTokenEnc",
      "plaidTransactionId",
      "plaidItem",
      "plaidAccount",
      "plaidStaged",
      "institutionId",
      "cursor",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

describe("userBackupSchema transactionVerifications", () => {
  it("defaults to an empty array for files written before Plaid sync existed", async () => {
    const { userBackupSchema } = await import("@/lib/backup-schema");
    const payload = JSON.parse(JSON.stringify(sanitizeBackupPayload(fixture()))) as Record<string, unknown>;
    delete payload.transactionVerifications;
    const parsed = userBackupSchema.parse(payload);
    expect(parsed.transactionVerifications).toEqual([]);
  });

  it("accepts and validates the rows when present", async () => {
    const { userBackupSchema } = await import("@/lib/backup-schema");
    const payload = JSON.parse(JSON.stringify(sanitizeBackupPayload(fixture()))) as Record<string, unknown>;
    payload.transactionVerifications = [
      {
        transactionId: "txn-1",
        source: "MATCHED",
        institutionName: null,
        verifiedAt: "2026-02-01T00:00:00.000Z",
        removedByPlaidAt: null,
      },
    ];
    expect(userBackupSchema.parse(payload).transactionVerifications).toHaveLength(1);

    payload.transactionVerifications = [{ transactionId: "txn-1", source: "NOPE", institutionName: null, verifiedAt: "2026-02-01T00:00:00.000Z", removedByPlaidAt: null }];
    expect(() => userBackupSchema.parse(payload)).toThrow();
  });
});
