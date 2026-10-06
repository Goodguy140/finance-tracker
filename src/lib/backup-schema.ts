import { z } from "zod";
import { MAX_AMOUNT_CENTS } from "@/lib/money";
import { YM_PATTERN } from "@/lib/period-month";
import { MAX_TAG_NAME_LENGTH, MAX_TAGS_PER_TRANSACTION } from "@/lib/tags";

const isoDate = z.iso.datetime();
/** Money columns are 32-bit ints; bound every cents field so a bad file fails validation, not the DB write. */
const signedCents = z.number().int().min(-MAX_AMOUNT_CENTS).max(MAX_AMOUNT_CENTS);
const positiveCents = z.number().int().positive().max(MAX_AMOUNT_CENTS);
const nonNegativeCents = z.number().int().nonnegative().max(MAX_AMOUNT_CENTS);

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
      kind: z.enum(["EXPENSE", "INCOME", "TRANSFER"]),
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
      type: z.enum(["EXPENSE", "INCOME", "TRANSFER"]),
      amountCents: signedCents,
      preCreditCents: signedCents.nullable(),
      creditCents: signedCents.nullable(),
      creditBreakdownJson: z.string().nullable(),
      title: z.string().max(120).nullable(),
      date: isoDate,
      postedDate: isoDate.nullable(),
      accountDescription: z.string().nullable(),
      note: z.string().max(250).nullable(),
      /** Absent in files exported before recurring links were included. */
      recurringTransactionId: z.string().min(1).nullable().optional(),
      recurringExpectedDate: isoDate.nullable().optional(),
      /** Absent in files exported before transfers carried their other side. */
      transferAccountId: z.string().min(1).nullable().optional(),
      transferPeerId: z.string().min(1).nullable().optional(),
      /** Exported `tags[].id`s. Optional: older backups predate tags. */
      tagIds: z.array(z.string().min(1)).max(MAX_TAGS_PER_TRANSACTION).optional().default([]),
      createdAt: isoDate,
      updatedAt: isoDate,
      splitParts: z.array(
        z.object({
          categoryId: z.string().min(1),
          amountCents: signedCents,
        }),
      ),
      /** Absent in files exported before reimbursements. */
      owedShares: z
        .array(
          z.object({
            name: z.string().min(1).max(80),
            amountCents: positiveCents,
            paidAt: isoDate.nullable(),
            createdAt: isoDate,
            updatedAt: isoDate,
          }),
        )
        .default([]),
    }),
  ),
  budgets: z.array(
    z.object({
      categoryId: z.string().min(1),
      name: z.string().max(80).nullable(),
      periodMonth: z.string().regex(YM_PATTERN),
      limitCents: positiveCents,
      createdAt: isoDate,
      updatedAt: isoDate,
    }),
  ),
  recurringTransactions: z
    .array(
      z.object({
        /** Absent in files exported before recurring links were included. */
        id: z.string().min(1).optional(),
        accountId: z.string().min(1),
        categoryId: z.string().min(1),
        type: z.enum(["EXPENSE", "INCOME", "TRANSFER"]),
        name: z.string().min(1).max(80),
        amountCents: positiveCents,
        cadence: z.enum(["WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY", "YEARLY", "BIENNIAL"]),
        nextExpectedDate: isoDate,
        /** Absent in files exported before rules stored the day they fall on. */
        anchorDay: z.number().int().min(1).max(31).nullable().optional(),
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
              shareCents: positiveCents,
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
      amountCents: positiveCents,
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
      amountCents: positiveCents,
      note: z.string().max(250).nullable(),
      transactionId: z.string().min(1).nullable().optional(),
      createdAt: isoDate,
    }),
  ),
  portfolioSnapshots: z.array(
    z.object({
      accountId: z.string().min(1),
      date: isoDate,
      totalValueCents: nonNegativeCents,
      note: z.string().max(250).nullable(),
      createdAt: isoDate,
    }),
  ),
  // Optional with a default so every backup written before Plaid sync existed still
  // validates, the same way earlier additions were handled.
  transactionVerifications: z
    .array(
      z.object({
        transactionId: z.string().min(1),
        source: z.enum(["IMPORTED", "MATCHED"]),
        institutionName: z.string().max(120).nullable(),
        verifiedAt: isoDate,
        removedByPlaidAt: isoDate.nullable(),
      }),
    )
    .optional()
    .default([]),
  transactionRules: z
    .array(
      z.object({
        priority: z.number().int(),
        enabled: z.boolean(),
        titleOperator: z.enum(["CONTAINS", "EQUALS", "STARTS_WITH"]),
        titlePattern: z.string().min(1).max(200),
        transactionType: z.enum(["EXPENSE", "INCOME", "TRANSFER"]).nullable(),
        matchAccountId: z.string().min(1).nullable(),
        minAmountCents: nonNegativeCents.nullable(),
        maxAmountCents: nonNegativeCents.nullable(),
        setCategoryId: z.string().min(1).nullable(),
        setTitle: z.string().max(120).nullable(),
        setAmountCents: nonNegativeCents.nullable(),
        setAccountId: z.string().min(1).nullable(),
        appendNote: z.string().max(250).nullable(),
        addTagId: z.string().min(1).nullable().optional(),
        createdAt: isoDate,
      }),
    )
    .max(200)
    .optional()
    .default([]),
  tags: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1).max(MAX_TAG_NAME_LENGTH),
        createdAt: isoDate,
      }),
    )
    .max(5000)
    .optional()
    .default([]),
  hiddenTitleSuggestions: z
    .array(z.object({ titleKey: z.string().min(1).max(200) }))
    .optional()
    .default([]),
  insightDismissals: z
    .array(z.object({ insightKey: z.string().min(1).max(300), snoozedUntil: isoDate.nullable() }))
    .max(5000)
    .optional()
    .default([]),
  insightPreference: z.object({ habitDetectionEnabled: z.boolean() }).nullable().optional(),
  contributionRooms: z
    .array(
      z.object({
        accountType: z.enum(["TFSA", "RRSP", "FHSA"]),
        year: z.number().int().min(2009).max(2200),
        roomCents: signedCents,
      }),
    )
    .max(1000)
    .optional()
    .default([]),
});

export type ParsedUserBackup = z.infer<typeof userBackupSchema>;
