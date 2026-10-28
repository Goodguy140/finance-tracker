import type { UserRole } from "@prisma/client";
import type { ParsedUserBackup } from "@/lib/backup-schema";

export type BackupUserProfileRestore = {
  displayName: string;
  timezone: string;
  countryCode: string;
  emailVerifiedAt: Date | null;
  role: UserRole;
  passwordHash: string | null;
};

type ParsedBackupUser = {
  displayName: string;
  timezone: string;
  countryCode: string;
  emailVerifiedAt: string | null;
  role: UserRole;
  passwordHash: string | null;
};

/** Profile fields safe to apply from a backup; role and password never come from the file. */
export function resolveBackupUserProfileFields(params: {
  currentUser: { role: UserRole; passwordHash: string | null };
  parsedUser: ParsedBackupUser;
}): BackupUserProfileRestore {
  const { currentUser, parsedUser } = params;
  return {
    displayName: parsedUser.displayName,
    timezone: parsedUser.timezone,
    countryCode: parsedUser.countryCode,
    emailVerifiedAt: parsedUser.emailVerifiedAt ? new Date(parsedUser.emailVerifiedAt) : null,
    role: currentUser.role,
    passwordHash: currentUser.passwordHash,
  };
}

/**
 * Throws if any cross-reference in the backup points at a row the file does not contain.
 *
 * The import re-checks each of these as it writes, but only *after* it has revoked the
 * user's bank connections at Plaid — which cannot be undone. Running the same checks up
 * front means a malformed file is refused while those connections are still live, rather
 * than rolling back the data and leaving the banks disconnected for nothing. The messages
 * match the in-transaction ones so the user sees the same thing either way.
 */
export function assertBackupReferencesResolve(parsed: ParsedUserBackup): void {
  const accountIds = new Set(parsed.accounts.map((row) => row.id));
  const categoryIds = new Set(parsed.categories.map((row) => row.id));
  const recurringIds = new Set(parsed.recurringTransactions.flatMap((row) => (row.id ? [row.id] : [])));
  const transactionIds = new Set(parsed.transactions.map((row) => row.id));
  const tagIds = new Set((parsed.tags ?? []).map((row) => row.id));

  for (const row of parsed.recurringTransactions) {
    if (!categoryIds.has(row.categoryId) || !accountIds.has(row.accountId)) {
      throw new Error("Backup references unknown recurring transaction account or category.");
    }
    if (row.transferAccountId && !accountIds.has(row.transferAccountId)) {
      throw new Error("Backup references unknown recurring transfer account.");
    }
  }
  for (const row of parsed.transactions) {
    if (!categoryIds.has(row.categoryId)) {
      throw new Error("Backup references unknown transaction category.");
    }
    if (row.accountId && !accountIds.has(row.accountId)) {
      throw new Error("Backup references unknown transaction account.");
    }
    if (row.recurringTransactionId && !recurringIds.has(row.recurringTransactionId)) {
      throw new Error("Backup references unknown recurring transaction.");
    }
    if (row.transferAccountId && !accountIds.has(row.transferAccountId)) {
      throw new Error("Backup references unknown transfer account.");
    }
    if (row.transferPeerId && !transactionIds.has(row.transferPeerId)) {
      throw new Error("Backup references unknown transfer leg.");
    }
    if (row.splitParts.some((part) => !categoryIds.has(part.categoryId))) {
      throw new Error("Backup references unknown split category.");
    }
    if ((row.tagIds ?? []).some((id) => !tagIds.has(id))) {
      throw new Error("Backup references unknown tag.");
    }
  }
  for (const row of parsed.transactionVerifications ?? []) {
    if (!transactionIds.has(row.transactionId)) {
      throw new Error("Backup references unknown verified transaction.");
    }
  }
  for (const row of [...parsed.budgets, ...(parsed.yearlyBudgets ?? [])]) {
    if (!categoryIds.has(row.categoryId)) {
      throw new Error("Backup references unknown budget category.");
    }
  }
  for (const row of parsed.subscriptions ?? []) {
    if (!categoryIds.has(row.categoryId) || !accountIds.has(row.accountId)) {
      throw new Error("Backup references unknown legacy recurring account or category.");
    }
  }
  for (const row of parsed.investmentFlows) {
    if (!accountIds.has(row.accountId)) {
      throw new Error("Backup references unknown investment account.");
    }
    if (row.transactionId && !transactionIds.has(row.transactionId)) {
      throw new Error("Backup references unknown counted transfer.");
    }
  }
  for (const row of parsed.portfolioSnapshots) {
    if (!accountIds.has(row.accountId)) {
      throw new Error("Backup references unknown snapshot account.");
    }
  }
  for (const row of parsed.accountBalances ?? []) {
    if (!accountIds.has(row.accountId)) {
      throw new Error("Backup references unknown balance account.");
    }
  }
  for (const row of parsed.savingsGoals ?? []) {
    if (row.accountId && !accountIds.has(row.accountId)) {
      throw new Error("Backup references unknown savings goal account.");
    }
  }
  for (const row of parsed.plannedTransactions ?? []) {
    if (!accountIds.has(row.accountId) || !categoryIds.has(row.categoryId)) {
      throw new Error("Backup references unknown plan account or category.");
    }
    if (row.transactionId && !transactionIds.has(row.transactionId)) {
      throw new Error("Backup references unknown plan transaction.");
    }
  }
  for (const row of parsed.savedSearches ?? []) {
    if (
      (row.accountId && !accountIds.has(row.accountId)) ||
      (row.categoryId && !categoryIds.has(row.categoryId)) ||
      (row.tagId && !tagIds.has(row.tagId))
    ) {
      throw new Error("Backup references unknown saved search account, category or tag.");
    }
  }
  for (const row of parsed.transactionRules ?? []) {
    if (
      (row.setCategoryId && !categoryIds.has(row.setCategoryId)) ||
      (row.matchAccountId && !accountIds.has(row.matchAccountId)) ||
      (row.setAccountId && !accountIds.has(row.setAccountId)) ||
      (row.setTransferAccountId && !accountIds.has(row.setTransferAccountId)) ||
      (row.splits ?? []).some((line) => !categoryIds.has(line.categoryId))
    ) {
      throw new Error("Backup references unknown rule account or category.");
    }
    if (row.addTagId && !tagIds.has(row.addTagId)) {
      throw new Error("Backup references unknown tag.");
    }
  }
}
