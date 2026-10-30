import { z } from "zod";
import { MAX_AMOUNT, MAX_AMOUNT_CENTS } from "@/lib/money";
import { YM_PATTERN } from "@/lib/period-month";
import { MAX_GOAL_NAME_LENGTH } from "@/lib/savings-goals";
import { MAX_TAG_NAME_LENGTH } from "@/lib/tags";
import {
  FULL_SPLIT_BASIS_POINTS,
  joinRuleTitlePatterns,
  MAX_RULE_SPLIT_LINES,
  MAX_RULE_TITLE_PATTERN_LENGTH,
  MAX_RULE_TITLE_PATTERNS,
} from "@/lib/transaction-rules";

/**
 * Money inputs. Every money column is a 32-bit `Int` of cents, so amounts are capped at
 * `MAX_AMOUNT` here rather than surfacing as a database error later.
 */
const amountTooLarge = { message: `Amount cannot exceed ${MAX_AMOUNT.toLocaleString("en-CA")}.` };
export const positiveAmount = z.coerce.number().positive().max(MAX_AMOUNT, amountTooLarge);
export const nonNegativeAmount = z.coerce.number().nonnegative().max(MAX_AMOUNT, amountTooLarge);

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
  /** Optional; null clears it. */
  birthYear: z
    .number({ message: "Enter a four-digit year." })
    .int("Enter a four-digit year.")
    .min(1900, "Enter a four-digit year.")
    .max(new Date().getUTCFullYear(), "That year hasn't happened yet.")
    .nullable()
    .optional(),
});

const nonZeroExpenseAmount = z.coerce
  .number()
  .refine((n) => Number.isFinite(n) && n !== 0, {
    message: "Enter a non-zero amount. Use a negative value for credits (e.g. refunds) shown on statements.",
  })
  .refine((n) => Math.abs(n) <= MAX_AMOUNT, amountTooLarge);

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
  amount: positiveAmount,
  postedDate: z.string().optional(),
});

/** A transfer entered by hand: money leaving one of the user's accounts for another. */
export const transferSchema = z
  .object({
    fromAccountId: z.string().min(1, "Choose the account the money left."),
    toAccountId: z.string().min(1, "Choose the account the money went to."),
    amount: positiveAmount,
    date: z.string().min(1),
    title: z.string().trim().max(120).optional(),
    note: z.string().max(250).optional(),
  })
  .refine((t) => t.fromAccountId !== t.toAccountId, {
    message: "Choose two different accounts.",
    path: ["toAccountId"],
  });

export const updateIncomeBaseSchema = incomeBaseSchema.extend({
  transactionId: z.string().min(1),
});

export const budgetSchema = z.object({
  categoryName: z.string().trim().min(1).max(80),
  limit: positiveAmount,
  periodMonth: z.string().regex(YM_PATTERN).optional(),
});

export const updateBudgetSchema = z.object({
  budgetId: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  limit: positiveAmount,
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
        amountCents: z.number().int().positive().max(MAX_AMOUNT_CENTS),
      }),
    )
    .min(1),
});

/** "Suggest budgets": the rows ticked, each a category and the monthly amount to set. */
export const applyBudgetSuggestionsSchema = z
  .array(
    z.object({
      categoryId: z.string().min(1),
      limitCents: z.number().int().positive().max(MAX_AMOUNT_CENTS),
    }),
  )
  .min(1)
  .max(500);

/** Calendar month `YYYY-MM` query/param, e.g. for the budgets API. */
export const monthParamSchema = z
  .string()
  .regex(YM_PATTERN, "month must be a calendar month in YYYY-MM format");

export const API_TOKEN_SCOPES = ["budgets:read", "transactions:read", "transactions:write", "accounts:read"] as const;

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
  type: z.enum(["EXPENSE", "INCOME", "TRANSFER"]),
  /** Where the money books to; for a transfer, the account it leaves. */
  accountId: z.string().min(1),
  /** Required for bills and income. A transfer goes to the user's Transfers category. */
  categoryId: z.string().min(1).optional(),
  /** A transfer's other side: the account the money goes to. Ignored for bills and income. */
  transferAccountId: z.string().min(1).optional(),
  name: z.string().trim().min(2).max(80),
  amount: positiveAmount,
  cadence: z.enum(["WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY", "YEARLY", "BIENNIAL", "SEMI_MONTHLY"]),
  nextExpectedDate: z.string().min(1),
  /** A twice-a-month rule's two days of the month; 31 is the last day. Ignored on other cadences. */
  firstDay: z.coerce.number().int().min(1).max(31).optional(),
  secondDay: z.coerce.number().int().min(1).max(31).optional(),
  /** A twice-a-month rule's dates on a weekend move to the Friday before. */
  beforeWeekend: z.enum(["on"]).optional(),
  endDate: z.string().optional(),
  note: z.string().trim().max(250).optional(),
  /** REVIEW: post from the dashboard by hand. AUTO: posted when due, no click needed. */
  postMode: z.enum(["REVIEW", "AUTO"]).default("REVIEW"),
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

/**
 * A transaction rule. Empty optional fields arrive as `undefined` (the action maps "" to
 * undefined). A category action pins the rule to that category's type, which the action
 * checks against the category itself — the schema only knows the ids.
 */
export const transactionRuleSchema = z
  .object({
    titleOperator: z.enum(["CONTAINS", "EQUALS", "STARTS_WITH"]),
    /** One entry per "Text to match" field; the rule matches if any of them does. Stored joined. */
    titlePatterns: z
      .array(z.string().trim().max(MAX_RULE_TITLE_PATTERN_LENGTH, "Keep each text to match under 200 characters."))
      .transform(joinRuleTitlePatterns)
      .refine((joined) => joined.length > 0, "Enter the text to match.")
      .refine(
        (joined) => joined.split("\n").length <= MAX_RULE_TITLE_PATTERNS,
        `A rule can match up to ${MAX_RULE_TITLE_PATTERNS} texts.`,
      ),
    transactionType: z.enum(["EXPENSE", "INCOME"]).optional(),
    matchAccountId: z.string().min(1).optional(),
    minAmount: nonNegativeAmount.optional(),
    maxAmount: nonNegativeAmount.optional(),
    setCategoryId: z.string().min(1).optional(),
    setTitle: z.string().trim().max(120).optional(),
    setAmount: positiveAmount.optional(),
    setAccountId: z.string().min(1).optional(),
    appendNote: z.string().trim().max(250).optional(),
    /** A tag name; the action creates the tag if the user does not have it yet. */
    addTag: z.string().trim().max(MAX_TAG_NAME_LENGTH + 10).optional(),
    markAsTransfer: z.boolean().optional(),
    setTransferAccountId: z.string().min(1).optional(),
    /** "Split by percentage": empty when the rule does not split. */
    split: z
      .array(
        z.object({
          categoryId: z.string().min(1, "Pick a category for each split line."),
          /** As typed, in percent; kept in hundredths of a percent. */
          basisPoints: z.coerce
            .number({ error: "Enter a percentage for each split line." })
            .refine((n) => Number.isFinite(n) && n > 0 && n < 100, "Each split line takes more than 0% and less than 100%.")
            .transform((n) => Math.round(n * 100)),
        }),
      )
      .max(MAX_RULE_SPLIT_LINES, `A rule can split into up to ${MAX_RULE_SPLIT_LINES} categories.`)
      .default([])
      .refine((lines) => lines.length !== 1, "A split needs at least two categories.")
      .refine(
        (lines) => new Set(lines.map((l) => l.categoryId)).size === lines.length,
        "Each split line needs a different category.",
      )
      .refine(
        (lines) => lines.length === 0 || lines.reduce((sum, l) => sum + l.basisPoints, 0) === FULL_SPLIT_BASIS_POINTS,
        "The split lines must add up to 100%.",
      ),
  })
  .refine((r) => r.minAmount === undefined || r.maxAmount === undefined || r.minAmount <= r.maxAmount, {
    message: "The minimum amount must not exceed the maximum.",
    path: ["maxAmount"],
  })
  .refine(
    (r) =>
      !!(
        r.setCategoryId ||
        r.setTitle ||
        r.setAmount !== undefined ||
        r.setAccountId ||
        r.appendNote ||
        r.addTag ||
        r.markAsTransfer ||
        r.split.length > 0
      ),
    { message: "Choose at least one thing for the rule to set.", path: ["setCategoryId"] },
  )
  .refine((r) => !r.setTransferAccountId || r.markAsTransfer, {
    message: "Tick “Mark as transfer” to name the other account.",
    path: ["setTransferAccountId"],
  })
  // A transfer has only the transfer category, so a rule cannot both mark one and pick another.
  .refine((r) => !(r.markAsTransfer && r.setCategoryId), {
    message: "A transfer has no category; leave Category as is or untick “Mark as transfer”.",
    path: ["setCategoryId"],
  })
  // A split is how the rule sets the category, and only an expense can be split.
  .refine((r) => !(r.split.length > 0 && r.setCategoryId), {
    message: "A split sets the categories itself; leave Category as is or remove the split.",
    path: ["setCategoryId"],
  })
  .refine((r) => !(r.split.length > 0 && r.markAsTransfer), {
    message: "A transfer cannot be split; remove the split or untick “Mark as transfer”.",
    path: ["markAsTransfer"],
  })
  .refine((r) => !(r.split.length > 0 && r.transactionType === "INCOME"), {
    message: "Only expenses can be split; change the type or remove the split.",
    path: ["transactionType"],
  });

export const updateTransactionRuleSchema = z.object({ ruleId: z.string().min(1) });

export const moveTransactionRuleSchema = z.object({
  ruleId: z.string().min(1),
  direction: z.enum(["up", "down"]),
});

export const setTransactionRuleEnabledSchema = z.object({
  ruleId: z.string().min(1),
  enabled: z.enum(["true", "false"]),
});

export const learnedTitleSchema = z.object({ title: z.string().trim().min(1).max(200) });

export const subscriptionMemberSchema = z.object({
  recurringTransactionId: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  share: positiveAmount,
});

export const updateSubscriptionMemberSchema = z.object({
  memberId: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  share: positiveAmount,
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

export const setOwedSharePaidSchema = z.object({
  shareId: z.string().min(1),
  paid: z.enum(["true", "false"]),
});

export const investmentFlowSchema = z.object({
  accountId: z.string().min(1),
  direction: z.enum(["CONTRIBUTION", "WITHDRAWAL"]),
  amount: positiveAmount,
  date: z.string().min(1),
  note: z.string().max(250).optional(),
});

/**
 * One year's contribution room from CRA. Signed, because a TFSA room statement reports an
 * existing excess as negative room. The year runs up to next year so a notice that arrives
 * early can be entered ahead of January.
 */
export const contributionRoomSchema = z.object({
  accountType: z.enum(["TFSA", "RRSP", "FHSA"]),
  year: z.coerce
    .number()
    .int()
    .min(2009, { message: "Registered-account room starts in 2009." })
    // Checked per call, not at import: a server that runs past New Year must accept the new year.
    .refine((year) => year <= new Date().getUTCFullYear() + 1, { message: "That year is too far ahead." }),
  room: z.coerce.number().min(-MAX_AMOUNT, amountTooLarge).max(MAX_AMOUNT, amountTooLarge),
});

export const portfolioSnapshotSchema = z.object({
  accountId: z.string().min(1),
  totalValue: nonNegativeAmount,
  date: z.string().min(1),
  note: z.string().max(250).optional(),
});

/** A balance entered by hand. Negative is allowed: an overdrawn account, a card in credit. */
export const accountBalanceSchema = z.object({
  accountId: z.string().min(1),
  balance: z.coerce.number().min(-MAX_AMOUNT, amountTooLarge).max(MAX_AMOUNT, amountTooLarge),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Pick a date." }),
});

/** A savings goal from its form. Empty `accountId` means tracked by hand; empty date, no deadline. */
export const savingsGoalSchema = z.object({
  name: z.string().trim().min(1, { message: "Name the goal." }).max(MAX_GOAL_NAME_LENGTH),
  target: positiveAmount,
  targetDate: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Pick a date." })]),
  accountId: z.string(),
  saved: z.union([z.literal(""), nonNegativeAmount]),
});

/** Money put toward (positive) or taken back from (negative) a goal tracked by hand. */
export const savingsGoalContributionSchema = z.object({
  goalId: z.string().min(1),
  amount: z.coerce
    .number()
    .min(-MAX_AMOUNT, amountTooLarge)
    .max(MAX_AMOUNT, amountTooLarge)
    .refine((n) => n !== 0, { message: "Enter an amount." }),
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

/** One import runs inside a single database transaction; keep it bounded. */
export const MAX_CSV_IMPORT_ROWS = 5000;

const importFieldOptions = z.enum([
  "",
  "amount",
  "date",
  "postedDate",
  "title",
  "note",
  "accountName",
  "categoryName",
  "amountIn",
]);

export const expenseCsvImportSchema = z.object({
  rows: z
    .array(z.record(z.string(), z.string()))
    .min(1, "The CSV has no data rows.")
    .max(MAX_CSV_IMPORT_ROWS, `Import at most ${MAX_CSV_IMPORT_ROWS} rows at a time.`),
  mapping: z.object({
    amount: z.string().min(1),
    amountIn: z.string().optional(),
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
    incomeCategoryId: z.string().optional(),
  }),
  amountSign: z.enum(["spending-positive", "spending-negative"]).default("spending-positive"),
  moneyIn: z.enum(["refund", "income"]).default("refund"),
  fieldSelections: z.array(importFieldOptions),
});

export const accountSchema = z.object({
  name: z.string().trim().min(2).max(80),
  type: z.enum(["CHEQUING", "SAVINGS", "CREDIT_CARD", "TFSA", "RRSP", "FHSA", "NON_REGISTERED", "CASH", "LOAN", "MORTGAGE", "PROPERTY"]),
});

export const updateAccountSchema = accountSchema.extend({
  accountId: z.string().min(1),
  countsAsSavings: z.boolean(),
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

/** Admin user management. `userId` is always the target, never the acting admin. */
export const adminUserIdSchema = z.object({ userId: z.string().min(1) });

export const adminSetUserRoleSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(["SERVER_ADMIN", "USER"]),
});

export const adminSetUserDisabledSchema = z.object({
  userId: z.string().min(1),
  // Checkbox/button values arrive as strings; an unchecked box submits nothing at all.
  disabled: z.enum(["true", "false"]),
});

/** Deleting a user is irreversible and cascades their whole financial history. */
export const adminDeleteUserSchema = z.object({
  userId: z.string().min(1),
  confirmEmail: z.string().trim().toLowerCase().min(1, "Type the account's email to confirm."),
});

/** SSO-only switch; an unchecked checkbox submits nothing, hence the string enum. */
export const adminSetPasswordLoginDisabledSchema = z.object({
  disabled: z.enum(["true", "false"]),
});

export const insightKeySchema = z.object({ insightKey: z.string().trim().min(1).max(300) });

export const dismissInsightSchema = insightKeySchema.extend({
  mode: z.enum(["snooze", "forever"]).default("forever"),
});

export const habitDetectionSchema = z.object({ enabled: z.enum(["true", "false"]).transform((v) => v === "true") });

export const trackHabitSchema = z.object({
  habit: z.enum(["TOBACCO_VAPE", "CANNABIS", "ALCOHOL", "GAMBLING", "GAMING_PURCHASES"]),
});

/** A planned one-off expense or income (the Add card's Plan tab). */
export const plannedTransactionSchema = z.object({
  type: z.enum(["EXPENSE", "INCOME"]),
  name: z.string().trim().min(1, { message: "Name what you are planning for." }).max(120),
  amount: positiveAmount,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Pick the date you expect it." }),
  accountId: z.string().min(1, { message: "Choose an account." }),
  categoryId: z.string().min(1, { message: "Choose a category." }),
  note: z.string().trim().max(250).optional(),
});
