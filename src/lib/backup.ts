import { prisma } from "@/lib/prisma";

export const BACKUP_VERSION = 1;

type IsoString = string;

export type UserBackupPayload = {
  version: number;
  exportedAt: IsoString;
  user: {
    email: string;
    displayName: string;
    timezone: string;
    countryCode: string;
    role: "SERVER_ADMIN" | "USER";
    passwordHash: string | null;
    emailVerifiedAt: IsoString | null;
    createdAt: IsoString;
    updatedAt: IsoString;
    defaultExpenseAccountId?: string | null;
  };
  authAccounts: Array<{
    provider: string;
    providerAccountId: string;
    accessToken: string | null;
    refreshToken: string | null;
    expiresAt: number | null;
    tokenType: string | null;
    scope: string | null;
    idToken: string | null;
    createdAt: IsoString;
    updatedAt: IsoString;
  }>;
  passwordResetTokens: Array<{
    tokenHash: string;
    expiresAt: IsoString;
    usedAt: IsoString | null;
    createdAt: IsoString;
  }>;
  accounts: Array<{
    id: string;
    name: string;
    type: string;
    currency: string;
    countryCode: string;
    provider: string | null;
    archived: boolean;
    createdAt: IsoString;
    updatedAt: IsoString;
  }>;
  categories: Array<{
    id: string;
    name: string;
    kind: "EXPENSE" | "INCOME";
    isDefault: boolean;
    createdAt: IsoString;
    updatedAt: IsoString;
  }>;
  transactions: Array<{
    id: string;
    accountId: string | null;
    categoryId: string;
    type: "EXPENSE" | "INCOME";
    amountCents: number;
    preCreditCents: number | null;
    creditCents: number | null;
    creditBreakdownJson: string | null;
    title: string | null;
    date: IsoString;
    postedDate: IsoString | null;
    accountDescription: string | null;
    note: string | null;
    /** The recurring rule (by its exported `id`) this row was posted from, if any. */
    recurringTransactionId: string | null;
    recurringExpectedDate: IsoString | null;
    createdAt: IsoString;
    updatedAt: IsoString;
    splitParts: Array<{
      categoryId: string;
      amountCents: number;
    }>;
  }>;
  budgets: Array<{
    categoryId: string;
    name: string | null;
    periodMonth: string;
    limitCents: number;
    createdAt: IsoString;
    updatedAt: IsoString;
  }>;
  recurringTransactions: Array<{
    /** Referenced by `transactions[].recurringTransactionId`; remapped on import. */
    id: string;
    accountId: string;
    categoryId: string;
    type: "EXPENSE" | "INCOME";
    name: string;
    amountCents: number;
    cadence: "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY" | "BIENNIAL";
    nextExpectedDate: IsoString;
    endDate: IsoString | null;
    postMode: "REVIEW" | "AUTO";
    enabled: boolean;
    note: string | null;
    createdAt: IsoString;
    updatedAt: IsoString;
    members: Array<{
      name: string;
      shareCents: number;
      createdAt: IsoString;
      updatedAt: IsoString;
      shareStatuses: Array<{
        expectedDate: IsoString;
        billSent: boolean;
        paid: boolean;
        paidAt: IsoString | null;
        createdAt: IsoString;
        updatedAt: IsoString;
      }>;
    }>;
  }>;
  investmentFlows: Array<{
    accountId: string;
    date: IsoString;
    direction: "CONTRIBUTION" | "WITHDRAWAL";
    amountCents: number;
    note: string | null;
    createdAt: IsoString;
  }>;
  portfolioSnapshots: Array<{
    accountId: string;
    date: IsoString;
    totalValueCents: number;
    note: string | null;
    createdAt: IsoString;
  }>;
  /**
   * Which transactions were confirmed against a bank record, keyed by the exported
   * `transactions[].id` (remapped on import like every other cross-reference).
   *
   * Deliberately carries no Plaid identifiers: a transaction id, item id, or access token
   * is bound to the Plaid client of the deployment that created it, and restoring one
   * elsewhere would at best be meaningless and at worst a bank-connection takeover. The
   * bank connections themselves (PlaidItem, PlaidAccount, PlaidStagedTransaction) are not
   * exported at all, for the same reason WebAuthn credentials are not.
   *
   * Optional: backups written before this existed must still import.
   */
  transactionVerifications?: Array<{
    /** References `transactions[].id`. */
    transactionId: string;
    source: "IMPORTED" | "MATCHED";
    institutionName: string | null;
    verifiedAt: IsoString;
    removedByPlaidAt: IsoString | null;
  }>;
  /**
   * Not a field. Recording an omission so it does not read as an oversight: the desktop
   * dashboard layout (`DashboardLayout`) is deliberately outside this payload. It is a UI
   * preference rather than financial data, and import/clear are wipe-and-replace — carrying
   * it here would silently reset someone's dashboard every time they restored a backup.
   */
};

/** Remove secrets before writing backup JSON to disk or HTTP responses. */
export function sanitizeBackupPayload(payload: UserBackupPayload): UserBackupPayload {
  return {
    ...payload,
    user: {
      ...payload.user,
      passwordHash: null,
    },
    authAccounts: payload.authAccounts.map((row) => ({
      ...row,
      accessToken: null,
      refreshToken: null,
      idToken: null,
    })),
    passwordResetTokens: [],
  };
}

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export async function buildUserBackupPayload(userId: string): Promise<UserBackupPayload> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: {
      authAccounts: true,
      resetTokens: true,
      accounts: true,
      categories: true,
      transactions: { include: { splitParts: true } },
      budgets: true,
      recurringTransactions: {
        include: { subscriptionMembers: { include: { shareStatuses: true } } },
      },
      investmentFlows: true,
      portfolioSnapshots: true,
      transactionVerifications: true,
    },
  });

  return sanitizeBackupPayload({
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    user: {
      email: user.email,
      displayName: user.displayName,
      timezone: user.timezone,
      countryCode: user.countryCode,
      role: user.role,
      passwordHash: user.passwordHash,
      emailVerifiedAt: toIso(user.emailVerifiedAt),
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      defaultExpenseAccountId: user.defaultExpenseAccountId,
    },
    authAccounts: user.authAccounts.map((row) => ({
      provider: row.provider,
      providerAccountId: row.providerAccountId,
      accessToken: row.accessToken,
      refreshToken: row.refreshToken,
      expiresAt: row.expiresAt,
      tokenType: row.tokenType,
      scope: row.scope,
      idToken: row.idToken,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
    passwordResetTokens: user.resetTokens.map((row) => ({
      tokenHash: row.tokenHash,
      expiresAt: row.expiresAt.toISOString(),
      usedAt: toIso(row.usedAt),
      createdAt: row.createdAt.toISOString(),
    })),
    accounts: user.accounts.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      currency: row.currency,
      countryCode: row.countryCode,
      provider: row.provider,
      archived: row.archived,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
    categories: user.categories.map((row) => ({
      id: row.id,
      name: row.name,
      kind: row.kind,
      isDefault: row.isDefault,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
    transactions: user.transactions.map((row) => ({
      id: row.id,
      accountId: row.accountId,
      categoryId: row.categoryId,
      type: row.type,
      amountCents: row.amountCents,
      preCreditCents: row.preCreditCents,
      creditCents: row.creditCents,
      creditBreakdownJson: row.creditBreakdownJson,
      title: row.title,
      date: row.date.toISOString(),
      postedDate: toIso(row.postedDate),
      accountDescription: row.accountDescription,
      note: row.note,
      recurringTransactionId: row.recurringTransactionId,
      recurringExpectedDate: toIso(row.recurringExpectedDate),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      splitParts: row.splitParts.map((part) => ({
        categoryId: part.categoryId,
        amountCents: part.amountCents,
      })),
    })),
    budgets: user.budgets.map((row) => ({
      categoryId: row.categoryId,
      name: row.name,
      periodMonth: row.periodMonth,
      limitCents: row.limitCents,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
    recurringTransactions: user.recurringTransactions.map((row) => ({
      id: row.id,
      accountId: row.accountId,
      categoryId: row.categoryId,
      type: row.type,
      name: row.name,
      amountCents: row.amountCents,
      cadence: row.cadence,
      nextExpectedDate: row.nextExpectedDate.toISOString(),
      endDate: toIso(row.endDate),
      postMode: row.postMode,
      enabled: row.enabled,
      note: row.note,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      members: row.subscriptionMembers.map((member) => ({
        name: member.name,
        shareCents: member.shareCents,
        createdAt: member.createdAt.toISOString(),
        updatedAt: member.updatedAt.toISOString(),
        shareStatuses: member.shareStatuses.map((status) => ({
          expectedDate: status.expectedDate.toISOString(),
          billSent: status.billSent,
          paid: status.paid,
          paidAt: toIso(status.paidAt),
          createdAt: status.createdAt.toISOString(),
          updatedAt: status.updatedAt.toISOString(),
        })),
      })),
    })),
    investmentFlows: user.investmentFlows.map((row) => ({
      accountId: row.accountId,
      date: row.date.toISOString(),
      direction: row.direction,
      amountCents: row.amountCents,
      note: row.note,
      createdAt: row.createdAt.toISOString(),
    })),
    portfolioSnapshots: user.portfolioSnapshots.map((row) => ({
      accountId: row.accountId,
      date: row.date.toISOString(),
      totalValueCents: row.totalValueCents,
      note: row.note,
      createdAt: row.createdAt.toISOString(),
    })),
    transactionVerifications: user.transactionVerifications.map((row) => ({
      transactionId: row.transactionId,
      source: row.source,
      institutionName: row.institutionName,
      verifiedAt: row.verifiedAt.toISOString(),
      removedByPlaidAt: toIso(row.removedByPlaidAt),
    })),
  });
}
