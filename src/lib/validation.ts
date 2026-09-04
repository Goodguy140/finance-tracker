import { z } from "zod";

export const signupSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
  displayName: z.string().min(2).max(60),
  countryCode: z.string().length(2).default("CA"),
  timezone: z.string().min(3).default("America/Toronto"),
});

export const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
});

/**
 * Profile edits. Same bounds `signupSchema` already enforces — this action used to write
 * straight from the form with no validation at all. Timezone is checked for shape rather
 * than membership so users outside the seeded country list can still set a real zone.
 */
export const updateProfileSchema = z.object({
  displayName: z.string().trim().min(2).max(60),
  countryCode: z.string().trim().toUpperCase().length(2),
  timezone: z
    .string()
    .trim()
    .min(3)
    .max(64)
    .regex(/^[A-Za-z][A-Za-z0-9+\-_]*(\/[A-Za-z0-9+\-_]+)*$/, "Enter a valid IANA time zone."),
});

const nonZeroExpenseAmount = z.coerce
  .number()
  .refine((n) => Number.isFinite(n) && n !== 0, {
    message: "Enter a non-zero amount. Use a negative value for credits (e.g. refunds) shown on statements.",
  });

export const expenseBaseSchema = z.object({
  accountId: z.string().min(1),
  categoryId: z.string().min(1),
  date: z.string().min(1),
  postedDate: z.string().optional(),
  title: z.string().trim().min(1, "Title is required.").max(120),
  note: z.string().max(250).optional(),
});

/** Full expense payload including a single amount field (e.g. CSV tooling). */
export const expenseSchema = expenseBaseSchema.extend({
  amount: nonZeroExpenseAmount,
});

export const updateExpenseBaseSchema = expenseBaseSchema.extend({
  transactionId: z.string().min(1),
});

export const incomeBaseSchema = z.object({
  accountId: z.string().min(1),
  categoryId: z.string().min(1),
  date: z.string().min(1),
  title: z.string().trim().max(120).optional(),
  note: z.string().max(250).optional(),
});

export const incomeSchema = incomeBaseSchema.extend({
  amount: z.coerce.number().positive(),
  postedDate: z.string().optional(),
});

export const updateIncomeBaseSchema = incomeBaseSchema.extend({
  transactionId: z.string().min(1),
});

export const splitExpenseSchema = z.object({
  accountId: z.string().min(1),
  date: z.string().min(1),
  title: z.string().trim().max(120).optional(),
  note: z.string().max(250).optional(),
  parts: z.array(
    z.object({
      categoryId: z.string().min(1),
      amount: z.coerce.number().positive(),
    }),
  ),
});

export const budgetSchema = z.object({
  categoryName: z.string().trim().min(1).max(80),
  limit: z.coerce.number().positive(),
  periodMonth: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
});

export const updateBudgetSchema = z.object({
  budgetId: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  limit: z.coerce.number().positive(),
});

export const deleteBudgetSchema = z.object({
  budgetId: z.string().min(1),
});

export const reallocateBudgetSchema = z.object({
  destinationCategoryId: z.string().min(1),
  transfers: z
    .array(
      z.object({
        categoryId: z.string().min(1),
        amountCents: z.number().int().positive(),
      }),
    )
    .min(1),
});

/** Calendar month `YYYY-MM` query/param, e.g. for the budgets API. */
export const monthParamSchema = z
  .string()
  .regex(/^\d{4}-\d{2}$/, "month must be in YYYY-MM format");

export const API_TOKEN_SCOPES = ["budgets:read"] as const;

/** Selectable token lifetimes, in days. `never` stays available but is not the default. */
export const API_TOKEN_EXPIRY_CHOICES = ["30", "90", "365", "never"] as const;

export const createApiTokenSchema = z.object({
  name: z.string().trim().min(1).max(60),
  scopes: z
    .array(z.enum(API_TOKEN_SCOPES))
    .min(1)
    .default(["budgets:read"]),
  expiresInDays: z.enum(API_TOKEN_EXPIRY_CHOICES).default("90"),
});

export const revokeApiTokenSchema = z.object({
  tokenId: z.string().min(1),
});

export const recurringTransactionSchema = z.object({
  type: z.enum(["EXPENSE", "INCOME"]),
  accountId: z.string().min(1),
  categoryId: z.string().min(1),
  name: z.string().trim().min(2).max(80),
  amount: z.coerce.number().positive(),
  cadence: z.enum(["WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY", "YEARLY", "BIENNIAL"]),
  nextExpectedDate: z.string().min(1),
  endDate: z.string().optional(),
  note: z.string().trim().max(250).optional(),
});

export const updateRecurringTransactionSchema = recurringTransactionSchema.extend({
  recurringTransactionId: z.string().min(1),
});

export const deleteRecurringTransactionSchema = z.object({
  recurringTransactionId: z.string().min(1),
});

export const setRecurringTransactionEnabledSchema = z.object({
  recurringTransactionId: z.string().min(1),
  enabled: z.enum(["true", "false"]),
});

export const postRecurringTransactionSchema = z.object({
  recurringTransactionId: z.string().min(1),
  expectedDate: z.string().min(1),
});

export const skipRecurringOccurrenceSchema = z.object({
  recurringTransactionId: z.string().min(1),
  expectedDate: z.string().min(1),
  reason: z.enum(["skip_once", "already_logged"]),
  transactionId: z.string().min(1).optional(),
});

export const subscriptionMemberSchema = z.object({
  recurringTransactionId: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  share: z.coerce.number().positive(),
});

export const updateSubscriptionMemberSchema = z.object({
  memberId: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  share: z.coerce.number().positive(),
});

export const deleteSubscriptionMemberSchema = z.object({
  memberId: z.string().min(1),
});

export const setSubscriptionShareStatusSchema = z.object({
  memberId: z.string().min(1),
  expectedDate: z.string().min(1),
  field: z.enum(["billSent", "paid"]),
  value: z.enum(["true", "false"]),
});

export const investmentFlowSchema = z.object({
  accountId: z.string().min(1),
  direction: z.enum(["CONTRIBUTION", "WITHDRAWAL"]),
  amount: z.coerce.number().positive(),
  date: z.string().min(1),
  note: z.string().max(250).optional(),
});

export const portfolioSnapshotSchema = z.object({
  accountId: z.string().min(1),
  totalValue: z.coerce.number().nonnegative(),
  date: z.string().min(1),
  note: z.string().max(250).optional(),
});

export const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(8),
    newPassword: z.string().min(8),
    confirmPassword: z.string().min(8),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

const importFieldOptions = z.enum([
  "",
  "amount",
  "date",
  "postedDate",
  "title",
  "note",
  "accountName",
  "categoryName",
]);

export const expenseCsvImportSchema = z.object({
  rows: z.array(z.record(z.string(), z.string())).min(1),
  mapping: z.object({
    amount: z.string().min(1),
    date: z.string().optional(),
    postedDate: z.string().optional(),
    title: z.string().optional(),
    note: z.string().optional(),
    accountName: z.string().optional(),
    categoryName: z.string().optional(),
  }),
  manualValues: z.object({
    date: z.string().optional(),
    postedDate: z.string().optional(),
    title: z.string().max(120).optional(),
    note: z.string().max(250).optional(),
    accountName: z.string().optional(),
    categoryName: z.string().optional(),
  }),
  defaults: z.object({
    accountId: z.string().min(1),
    categoryId: z.string().min(1),
  }),
  fieldSelections: z.array(importFieldOptions),
});

export const accountSchema = z.object({
  name: z.string().trim().min(2).max(80),
  type: z.enum(["CHEQUING", "SAVINGS", "CREDIT_CARD", "TFSA", "RRSP", "FHSA", "NON_REGISTERED", "CASH"]),
});

export const updateAccountSchema = accountSchema.extend({
  accountId: z.string().min(1),
  currency: z
    .string()
    .trim()
    .length(3)
    .transform((value) => value.toUpperCase()),
});

export const setAccountArchivedSchema = z.object({
  accountId: z.string().min(1),
  archived: z.enum(["true", "false"]),
});

export const updateDefaultExpenseAccountSchema = z.object({
  defaultExpenseAccountId: z
    .string()
    .trim()
    .transform((value) => (value === "" ? null : value)),
});

/** Passkeys / MFA. Names are user-facing labels only ("MacBook Touch ID"). */
export const passkeyNameSchema = z.string().trim().min(1).max(40);

export const beginPasskeyRegistrationSchema = z.object({
  name: passkeyNameSchema,
  currentPassword: z.string().optional(),
});

export const passkeyRowIdSchema = z.object({ passkeyId: z.string().min(1) });

export const renamePasskeySchema = z.object({
  passkeyId: z.string().min(1),
  name: passkeyNameSchema,
});

/** Codes are shown as `xxxxx-xxxxx` (base32, lower-case); accept them with or without the dash. */
export const recoveryCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .toLowerCase()
    .transform((value) => value.replace(/[\s-]/g, ""))
    .pipe(z.string().regex(/^[a-z2-7]{10}$/, "Enter a valid recovery code.")),
});

export const ssoLinkProviderSchema = z.object({ provider: z.enum(["google", "authentik"]) });
