import { prisma } from "@/lib/prisma";
import { isRegisteredAccountType } from "@/lib/contribution-room";

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
    countsAsSavings: boolean;
    createdAt: IsoString;
    updatedAt: IsoString;
  }>;
  categories: Array<{
    id: string;
    name: string;
    kind: "EXPENSE" | "INCOME" | "TRANSFER";
    isDefault: boolean;
    /** Budget rollover's first month (`YYYY-MM`), or null when it is off. */
    rolloverSinceMonth: string | null;
    /** The category group it is filed under, or null. */
    groupName: string | null;
    createdAt: IsoString;
    updatedAt: IsoString;
  }>;
  transactions: Array<{
    id: string;
    accountId: string | null;
    categoryId: string;
    type: "EXPENSE" | "INCOME" | "TRANSFER";
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
    /** Transfers: the account (by its exported `id`) on the other side. */
    transferAccountId: string | null;
    /** Transfers: the other leg (by its exported `id`) when both are in the log. */
    transferPeerId: string | null;
    /** The transaction's tags, by their exported `tags[].id`. */
    tagIds: string[];
    createdAt: IsoString;
    updatedAt: IsoString;
    splitParts: Array<{
      categoryId: string;
      amountCents: number;
    }>;
    /** What others owe back on this expense; already taken out of `amountCents`. */
    owedShares: Array<{
      name: string;
      amountCents: number;
      paidAt: IsoString | null;
      createdAt: IsoString;
      updatedAt: IsoString;
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
  /** Optional: absent in files exported before yearly budgets existed. */
  yearlyBudgets?: Array<{
    categoryId: string;
    year: number;
    limitCents: number;
    createdAt: IsoString;
    updatedAt: IsoString;
  }>;
  recurringTransactions: Array<{
    /** Referenced by `transactions[].recurringTransactionId`; remapped on import. */
    id: string;
    accountId: string;
    categoryId: string;
    type: "EXPENSE" | "INCOME" | "TRANSFER";
    name: string;
    amountCents: number;
    cadence: "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY" | "BIENNIAL";
    nextExpectedDate: IsoString;
    /** Day of the month the rule falls on; null for a rule saved before it was stored. */
    anchorDay: number | null;
    /** A transfer rule's other side; null on bills and income. */
    transferAccountId: string | null;
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
    /** The transfer it was counted from; absent in backups written before the link existed. */
    transactionId?: string | null;
    createdAt: IsoString;
  }>;
  portfolioSnapshots: Array<{
    accountId: string;
    date: IsoString;
    totalValueCents: number;
    note: string | null;
    createdAt: IsoString;
  }>;
  /** Balance history for net worth. Plaid-sourced rows carry no Plaid id. */
  accountBalances: Array<{
    accountId: string;
    date: IsoString;
    balanceCents: number;
    source: string;
    createdAt: IsoString;
  }>;
  /** Savings goals; `accountId` is an exported account id or null. Optional for older backups. */
  savingsGoals?: Array<{
    name: string;
    targetCents: number;
    targetDate: IsoString | null;
    accountId: string | null;
    savedCents: number;
    createdAt: IsoString;
  }>;
  /**
   * One-off plans. `accountId`, `categoryId` and `transactionId` are exported ids; the last is
   * set on a plan that has happened. Optional for older backups.
   */
  plannedTransactions?: Array<{
    type: "EXPENSE" | "INCOME";
    name: string;
    amountCents: number;
    date: IsoString;
    accountId: string;
    categoryId: string;
    note: string | null;
    transactionId: string | null;
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
   * The user's transaction rules, in priority order. Category and account ids reference the
   * exported `categories[].id` / `accounts[].id` and are remapped on import. Optional: older
   * backups predate rules.
   */
  transactionRules?: Array<{
    priority: number;
    enabled: boolean;
    titleOperator: "CONTAINS" | "EQUALS" | "STARTS_WITH";
    titlePattern: string;
    transactionType: "EXPENSE" | "INCOME" | "TRANSFER" | null;
    matchAccountId: string | null;
    minAmountCents: number | null;
    maxAmountCents: number | null;
    setCategoryId: string | null;
    setTitle: string | null;
    setAmountCents: number | null;
    setAccountId: string | null;
    appendNote: string | null;
    /** By its exported `tags[].id`. */
    addTagId: string | null;
    /** Optional: older backups predate the transfer action. */
    markAsTransfer?: boolean;
    setTransferAccountId?: string | null;
    createdAt: IsoString;
  }>;
  /** The user's tags. Optional: older backups predate them. */
  tags?: Array<{ id: string; name: string; createdAt: IsoString }>;
  /** Learned Title → Category combos the user hid (normalised title keys). Optional. */
  hiddenTitleSuggestions?: Array<{ titleKey: string }>;
  /**
   * Insights the user dismissed or snoozed. Optional. Some keys embed a category or rule id,
   * which restore re-issues; those dismissals simply stop matching and the insight may
   * reappear once, which is the harmless direction to fail in.
   */
  insightDismissals?: Array<{ insightKey: string; snoozedUntil: IsoString | null; dismissedCents?: number | null }>;
  /** Insight settings. Optional; absent means the defaults. */
  insightPreference?: { habitDetectionEnabled: boolean } | null;
  /** Yearly TFSA/RRSP/FHSA room figures copied from CRA. Optional: older backups predate them. */
  contributionRooms?: Array<{ accountType: "TFSA" | "RRSP" | "FHSA"; year: number; roomCents: number }>;
  /**
   * Which category each Plaid category lands in, where the user changed it. `categoryId`
   * references `categories[].id`. Carries no Plaid identifiers — the codes are Plaid's public
   * taxonomy, the same for every deployment. Optional: older backups predate them.
   */
  plaidCategoryMappings?: Array<{ plaidCategory: string; categoryId: string }>;
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
      transactions: {
        include: {
          splitParts: true,
          tags: { select: { tagId: true } },
          owedShares: { orderBy: { createdAt: "asc" } },
        },
      },
      budgets: true,
      yearlyBudgets: true,
      recurringTransactions: {
        include: { subscriptionMembers: { include: { shareStatuses: true } } },
      },
      investmentFlows: true,
      portfolioSnapshots: true,
      balanceSnapshots: true,
      savingsGoals: { orderBy: { createdAt: "asc" } },
      plannedTransactions: { orderBy: { createdAt: "asc" } },
      transactionVerifications: true,
      transactionRules: { orderBy: [{ priority: "asc" }, { id: "asc" }] },
      hiddenTitleSuggestions: true,
      tags: { orderBy: { nameKey: "asc" } },
      insightDismissals: true,
      insightPreference: true,
      contributionRooms: { orderBy: [{ accountType: "asc" }, { year: "asc" }] },
      plaidCategoryMappings: { orderBy: { plaidCategory: "asc" } },
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
      countsAsSavings: row.countsAsSavings,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
    categories: user.categories.map((row) => ({
      id: row.id,
      name: row.name,
      kind: row.kind,
      isDefault: row.isDefault,
      rolloverSinceMonth: row.rolloverSinceMonth,
      groupName: row.groupName,
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
      transferAccountId: row.transferAccountId,
      transferPeerId: row.transferPeerId,
      tagIds: row.tags.map((link) => link.tagId),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      splitParts: row.splitParts.map((part) => ({
        categoryId: part.categoryId,
        amountCents: part.amountCents,
      })),
      owedShares: row.owedShares.map((share) => ({
        name: share.name,
        amountCents: share.amountCents,
        paidAt: toIso(share.paidAt),
        createdAt: share.createdAt.toISOString(),
        updatedAt: share.updatedAt.toISOString(),
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
    yearlyBudgets: user.yearlyBudgets.map((row) => ({
      categoryId: row.categoryId,
      year: row.year,
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
      anchorDay: row.anchorDay,
      transferAccountId: row.transferAccountId,
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
      transactionId: row.transactionId,
      createdAt: row.createdAt.toISOString(),
    })),
    portfolioSnapshots: user.portfolioSnapshots.map((row) => ({
      accountId: row.accountId,
      date: row.date.toISOString(),
      totalValueCents: row.totalValueCents,
      note: row.note,
      createdAt: row.createdAt.toISOString(),
    })),
    accountBalances: user.balanceSnapshots.map((row) => ({
      accountId: row.accountId,
      date: row.date.toISOString(),
      balanceCents: row.balanceCents,
      source: row.source,
      createdAt: row.createdAt.toISOString(),
    })),
    savingsGoals: user.savingsGoals.map((row) => ({
      name: row.name,
      targetCents: row.targetCents,
      targetDate: toIso(row.targetDate),
      accountId: row.accountId,
      savedCents: row.savedCents,
      createdAt: row.createdAt.toISOString(),
    })),
    plannedTransactions: user.plannedTransactions.map((row) => ({
      type: row.type === "INCOME" ? ("INCOME" as const) : ("EXPENSE" as const),
      name: row.name,
      amountCents: row.amountCents,
      date: row.date.toISOString(),
      accountId: row.accountId,
      categoryId: row.categoryId,
      note: row.note,
      transactionId: row.transactionId,
      createdAt: row.createdAt.toISOString(),
    })),
    transactionVerifications: user.transactionVerifications.map((row) => ({
      transactionId: row.transactionId,
      source: row.source,
      institutionName: row.institutionName,
      verifiedAt: row.verifiedAt.toISOString(),
      removedByPlaidAt: toIso(row.removedByPlaidAt),
    })),
    transactionRules: user.transactionRules.map((row) => ({
      priority: row.priority,
      enabled: row.enabled,
      titleOperator: row.titleOperator,
      titlePattern: row.titlePattern,
      transactionType: row.transactionType,
      matchAccountId: row.matchAccountId,
      minAmountCents: row.minAmountCents,
      maxAmountCents: row.maxAmountCents,
      setCategoryId: row.setCategoryId,
      setTitle: row.setTitle,
      setAmountCents: row.setAmountCents,
      setAccountId: row.setAccountId,
      appendNote: row.appendNote,
      addTagId: row.addTagId,
      markAsTransfer: row.markAsTransfer,
      setTransferAccountId: row.setTransferAccountId,
      createdAt: row.createdAt.toISOString(),
    })),
    tags: user.tags.map((row) => ({ id: row.id, name: row.name, createdAt: row.createdAt.toISOString() })),
    hiddenTitleSuggestions: user.hiddenTitleSuggestions.map((row) => ({ titleKey: row.titleKey })),
    insightDismissals: user.insightDismissals.map((row) => ({
      insightKey: row.insightKey,
      snoozedUntil: row.snoozedUntil?.toISOString() ?? null,
      dismissedCents: row.dismissedCents,
    })),
    insightPreference: user.insightPreference
      ? { habitDetectionEnabled: user.insightPreference.habitDetectionEnabled }
      : null,
    contributionRooms: user.contributionRooms.flatMap((row) =>
      isRegisteredAccountType(row.accountType)
        ? [{ accountType: row.accountType, year: row.year, roomCents: row.roomCents }]
        : [],
    ),
    plaidCategoryMappings: user.plaidCategoryMappings.map((row) => ({
      plaidCategory: row.plaidCategory,
      categoryId: row.categoryId,
    })),
  });
}
