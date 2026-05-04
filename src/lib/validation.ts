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

const nonZeroExpenseAmount = z.coerce
  .number()
  .refine((n) => Number.isFinite(n) && n !== 0, {
    message: "Enter a non-zero amount. Use a negative value for credits (e.g. refunds) shown on statements.",
  });

export const expenseSchema = z.object({
  accountId: z.string().min(1),
  categoryId: z.string().min(1),
  amount: nonZeroExpenseAmount,
  date: z.string().min(1),
  postedDate: z.string().optional(),
  title: z.string().trim().max(120).optional(),
  note: z.string().max(250).optional(),
});

export const updateExpenseSchema = expenseSchema.extend({
  transactionId: z.string().min(1),
});

export const incomeSchema = z.object({
  accountId: z.string().min(1),
  categoryId: z.string().min(1),
  amount: z.coerce.number().positive(),
  date: z.string().min(1),
  postedDate: z.string().optional(),
  title: z.string().trim().max(120).optional(),
  note: z.string().max(250).optional(),
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

export const subscriptionSchema = z.object({
  accountId: z.string().min(1),
  categoryId: z.string().min(1),
  name: z.string().trim().min(2).max(80),
  amount: z.coerce.number().positive(),
  billingCycle: z.enum(["WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY", "BIENNIAL"]),
  nextChargeDate: z.string().min(1),
});

export const updateSubscriptionSchema = subscriptionSchema.extend({
  subscriptionId: z.string().min(1),
});

export const deleteSubscriptionSchema = z.object({
  subscriptionId: z.string().min(1),
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

export const setAccountArchivedSchema = z.object({
  accountId: z.string().min(1),
  archived: z.enum(["true", "false"]),
});
