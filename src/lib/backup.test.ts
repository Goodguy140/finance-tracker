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
