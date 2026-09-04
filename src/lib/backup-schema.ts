import { z } from "zod";

const isoDate = z.iso.datetime();

export const userBackupSchema = z.object({
  version: z.literal(1),
  exportedAt: isoDate,
  user: z.object({
    email: z.email(),
    displayName: z.string().min(1).max(60),
    timezone: z.string().min(3),
    countryCode: z.string().length(2),
    role: z.enum(["SERVER_ADMIN", "USER"]),
    passwordHash: z.string().nullable(),
    emailVerifiedAt: isoDate.nullable(),
    createdAt: isoDate,
    updatedAt: isoDate,
    defaultExpenseAccountId: z.string().min(1).nullable().optional(),
  }),
  authAccounts: z.array(
    z.object({
      provider: z.string().min(1),
      providerAccountId: z.string().min(1),
      accessToken: z.string().nullable(),
      refreshToken: z.string().nullable(),
      expiresAt: z.number().int().nullable(),
      tokenType: z.string().nullable(),
      scope: z.string().nullable(),
      idToken: z.string().nullable(),
      createdAt: isoDate,
      updatedAt: isoDate,
    }),
  ),
  /**
   * Accepted for compatibility with existing backup files and then ignored — the import
   * deliberately does not restore reset tokens. See the note in importUserBackupAction.
   */
  passwordResetTokens: z
    .array(
      z.object({
        tokenHash: z.string().min(1),
        expiresAt: isoDate,
        usedAt: isoDate.nullable(),
        createdAt: isoDate,
      }),
    )
    .optional()
    .default([]),
  accounts: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1).max(80),
      type: z.enum(["CHEQUING", "SAVINGS", "CREDIT_CARD", "TFSA", "RRSP", "FHSA", "NON_REGISTERED", "CASH"]),
      currency: z.string().min(1),
      countryCode: z.string().min(1),
      provider: z.string().nullable(),
      archived: z.boolean(),
      createdAt: isoDate,
      updatedAt: isoDate,
    }),
  ),
  categories: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1).max(80),
      kind: z.enum(["EXPENSE", "INCOME"]),
      isDefault: z.boolean(),
      createdAt: isoDate,
      updatedAt: isoDate,
    }),
  ),
  transactions: z.array(
    z.object({
      id: z.string().min(1),
      accountId: z.string().min(1).nullable(),
      categoryId: z.string().min(1),
      type: z.enum(["EXPENSE", "INCOME"]),
      amountCents: z.number().int(),
      preCreditCents: z.number().int().nullable(),
      creditCents: z.number().int().nullable(),
      creditBreakdownJson: z.string().nullable(),
      title: z.string().max(120).nullable(),
      date: isoDate,
      postedDate: isoDate.nullable(),
      accountDescription: z.string().nullable(),
      note: z.string().max(250).nullable(),
      createdAt: isoDate,
      updatedAt: isoDate,
      splitParts: z.array(
        z.object({
          categoryId: z.string().min(1),
          amountCents: z.number().int(),
        }),
      ),
    }),
  ),
  budgets: z.array(
    z.object({
      categoryId: z.string().min(1),
      name: z.string().max(80).nullable(),
      periodMonth: z.string().regex(/^\d{4}-\d{2}$/),
      limitCents: z.number().int().positive(),
      createdAt: isoDate,
      updatedAt: isoDate,
    }),
  ),
  recurringTransactions: z
    .array(
      z.object({
        accountId: z.string().min(1),
        categoryId: z.string().min(1),
        type: z.enum(["EXPENSE", "INCOME"]),
        name: z.string().min(1).max(80),
        amountCents: z.number().int().positive(),
        cadence: z.enum(["WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY", "YEARLY", "BIENNIAL"]),
        nextExpectedDate: isoDate,
        endDate: isoDate.nullable(),
        postMode: z.enum(["REVIEW", "AUTO"]),
        enabled: z.boolean(),
        note: z.string().max(250).nullable(),
        createdAt: isoDate,
        updatedAt: isoDate,
        members: z
          .array(
            z.object({
              name: z.string().min(1).max(80),
              shareCents: z.number().int().positive(),
              createdAt: isoDate,
              updatedAt: isoDate,
              shareStatuses: z
                .array(
                  z.object({
                    expectedDate: isoDate,
                    billSent: z.boolean(),
                    paid: z.boolean(),
                    paidAt: isoDate.nullable(),
                    createdAt: isoDate,
                    updatedAt: isoDate,
                  }),
                )
                .default([]),
            }),
          )
          .default([]),
      }),
    )
    .default([]),
  /** Backward-compatible import for backups exported before recurring transactions replaced subscriptions. */
  subscriptions: z.array(
    z.object({
      accountId: z.string().min(1),
      categoryId: z.string().min(1),
      name: z.string().min(1).max(80),
      amountCents: z.number().int().positive(),
      billingCycle: z.enum(["WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY", "BIENNIAL"]),
      nextChargeDate: isoDate,
      createdAt: isoDate,
      updatedAt: isoDate,
    }),
  ).optional(),
  investmentFlows: z.array(
    z.object({
      accountId: z.string().min(1),
      date: isoDate,
      direction: z.enum(["CONTRIBUTION", "WITHDRAWAL"]),
      amountCents: z.number().int().positive(),
      note: z.string().max(250).nullable(),
      createdAt: isoDate,
    }),
  ),
  portfolioSnapshots: z.array(
    z.object({
      accountId: z.string().min(1),
      date: isoDate,
      totalValueCents: z.number().int().nonnegative(),
      note: z.string().max(250).nullable(),
      createdAt: isoDate,
    }),
  ),
});

export type ParsedUserBackup = z.infer<typeof userBackupSchema>;
