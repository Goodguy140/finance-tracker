"use server";

import { revalidatePath } from "next/cache";
import { CategoryKind, Prisma, TransactionType } from "@prisma/client";
import { scheduleBudgetAlertEmails } from "@/lib/budget-alert-dispatch";
import { MAX_AMOUNT, parseStatementAmount, toCents } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { dateFromYmd } from "@/lib/date-only";
import { parseImportedDate } from "@/lib/import-dates";
import { requireUser } from "@/lib/session";
import { parseExpenseAmountFromForm } from "@/lib/expense-amount";
import { appendRuleNote, resolveRuleOutcome } from "@/lib/transaction-rules";
import { loadRuleContext } from "@/lib/transaction-rules-server";
import {
  markAsTransfer,
  setTransferAccount,
  unmarkTransfer,
  unpairTransfer,
  type TransferMarkRefusal,
} from "@/lib/transfer-marking";
import {
  expenseCsvImportSchema,
  expenseBaseSchema,
  incomeSchema,
  updateIncomeBaseSchema,
  updateExpenseBaseSchema,
  positiveAmount,
} from "@/lib/validation";
import {
  getFormValue,
  LONG_TRANSACTION_OPTIONS,
  assertUserOwnsAccount,
  assertUserOwnsCategory,
  formAction,
  getOptionalMappedValue,
  parseJsonField,
} from "./_helpers";
export const createExpenseAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const payload = expenseBaseSchema.parse({
    accountId: getFormValue(formData, "accountId"),
    categoryId: getFormValue(formData, "categoryId"),
    date: getFormValue(formData, "date"),
    postedDate: getFormValue(formData, "postedDate") || undefined,
    title: getFormValue(formData, "title") || undefined,
    note: getFormValue(formData, "note"),
  });
  const amounts = parseExpenseAmountFromForm(formData);
  await Promise.all([
    payload.accountId ? assertUserOwnsAccount(user.id, payload.accountId) : Promise.resolve(),
    assertUserOwnsCategory(user.id, payload.categoryId, CategoryKind.EXPENSE),
  ]);

  await prisma.transaction.create({
    data: {
      userId: user.id,
      accountId: payload.accountId,
      categoryId: payload.categoryId,
      type: TransactionType.EXPENSE,
      amountCents: amounts.amountCents,
      preCreditCents: amounts.preCreditCents,
      creditCents: amounts.creditCents,
      creditBreakdownJson: amounts.creditBreakdownJson,
      date: dateFromYmd(payload.date),
      postedDate: payload.postedDate ? dateFromYmd(payload.postedDate) : null,
      title: payload.title,
      note: payload.note,
    },
  });
  scheduleBudgetAlertEmails(user.id);
  revalidatePath("/");
});

export const updateExpenseAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const payload = updateExpenseBaseSchema.parse({
    transactionId: getFormValue(formData, "transactionId"),
    accountId: getFormValue(formData, "accountId"),
    categoryId: getFormValue(formData, "categoryId"),
    date: getFormValue(formData, "date"),
    postedDate: getFormValue(formData, "postedDate") || undefined,
    title: getFormValue(formData, "title") || undefined,
    note: getFormValue(formData, "note"),
  });
  const amounts = parseExpenseAmountFromForm(formData);
  await Promise.all([
    payload.accountId ? assertUserOwnsAccount(user.id, payload.accountId) : Promise.resolve(),
    assertUserOwnsCategory(user.id, payload.categoryId, CategoryKind.EXPENSE),
  ]);

  const existing = await prisma.transaction.findFirst({
    where: {
      id: payload.transactionId,
      userId: user.id,
      type: TransactionType.EXPENSE,
    },
    include: { splitParts: true },
  });
  if (!existing) throw new Error("Expense not found.");
  if (existing.splitParts.length > 0) {
    throw new Error("Split expenses cannot be edited here.");
  }

  await prisma.transaction.update({
    where: { id: existing.id },
    data: {
      account: payload.accountId
        ? { connect: { id: payload.accountId } }
        : { disconnect: true },
      category: { connect: { id: payload.categoryId } },
      amountCents: amounts.amountCents,
      preCreditCents: amounts.preCreditCents,
      creditCents: amounts.creditCents,
      creditBreakdownJson: amounts.creditBreakdownJson,
      date: dateFromYmd(payload.date),
      postedDate: payload.postedDate ? dateFromYmd(payload.postedDate) : null,
      title: payload.title,
      note: payload.note,
    },
  });
  scheduleBudgetAlertEmails(user.id);
  revalidatePath("/");
});

export const deleteExpenseTransactionAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const transactionId = getFormValue(formData, "transactionId");
  if (!transactionId) throw new Error("Transaction id is required.");

  const existing = await prisma.transaction.findFirst({
    where: {
      id: transactionId,
      userId: user.id,
      type: TransactionType.EXPENSE,
    },
  });
  if (!existing) throw new Error("Expense not found.");

  await prisma.transaction.delete({ where: { id: existing.id } });
  scheduleBudgetAlertEmails(user.id);
  revalidatePath("/");
});

export const importExpensesCsvAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const rowsJson = getFormValue(formData, "rowsJson");
  const fieldSelectionsJson = getFormValue(formData, "fieldSelections");
  const parsedRows = parseJsonField<unknown>(rowsJson, [], "The CSV rows could not be read. Re-upload the file and try again.");
  const fieldSelections = parseJsonField<unknown>(fieldSelectionsJson, [], "The column mapping could not be read. Try again.");
  const payload = expenseCsvImportSchema.parse({
    rows: parsedRows,
    mapping: {
      amount: getFormValue(formData, "map_amount"),
      date: getFormValue(formData, "map_date") || undefined,
      postedDate: getFormValue(formData, "map_postedDate") || undefined,
      title: getFormValue(formData, "map_title") || undefined,
      note: getFormValue(formData, "map_note") || undefined,
      accountName: getFormValue(formData, "map_accountName") || undefined,
      categoryName: getFormValue(formData, "map_categoryName") || undefined,
    },
    manualValues: {
      date: getFormValue(formData, "manual_date") || undefined,
      postedDate: getFormValue(formData, "manual_postedDate") || undefined,
      title: getFormValue(formData, "manual_title") || undefined,
      note: getFormValue(formData, "manual_note") || undefined,
      accountName: getFormValue(formData, "manual_accountName") || undefined,
      categoryName: getFormValue(formData, "manual_categoryName") || undefined,
    },
    defaults: {
      accountId: getFormValue(formData, "defaultAccountId"),
      categoryId: getFormValue(formData, "defaultCategoryId"),
    },
    fieldSelections,
  });
  await Promise.all([
    payload.defaults.accountId
      ? assertUserOwnsAccount(user.id, payload.defaults.accountId)
      : Promise.resolve(),
    payload.defaults.categoryId
      ? assertUserOwnsCategory(user.id, payload.defaults.categoryId, CategoryKind.EXPENSE)
      : Promise.resolve(),
  ]);

  const usedFields = payload.fieldSelections.filter((field) => field);
  const uniqueFields = new Set(usedFields);
  if (uniqueFields.size !== usedFields.length) {
    throw new Error("Each CSV column can only be mapped to one field.");
  }

  const accounts = await prisma.account.findMany({
    where: { userId: user.id, archived: false },
    select: { id: true, name: true },
  });
  const accountByName = new Map(accounts.map((account) => [account.name.trim().toLowerCase(), account.id]));
  const categories = await prisma.category.findMany({
    where: { userId: user.id, kind: CategoryKind.EXPENSE },
    select: { id: true, name: true },
  });
  const categoryByName = new Map(categories.map((category) => [category.name.trim().toLowerCase(), category.id]));
  const ruleContext = await loadRuleContext(user.id);
  const expenseCategoryKinds = new Map(categories.map((category) => [category.id, "EXPENSE" as const]));
  const activeAccountIds = new Set(accounts.map((account) => account.id));

  // Rows are resolved first (creating any missing categories as we go) and written with a
  // single createMany: one round trip per row used to push large statements past the
  // transaction timeout and roll the whole import back.
  await prisma.$transaction(async (tx) => {
    const pending: Prisma.TransactionCreateManyInput[] = [];
    for (const row of payload.rows) {
      const amountRaw = row[payload.mapping.amount]?.trim();
      if (!amountRaw) continue;

      const amount = parseStatementAmount(amountRaw);
      if (amount === null || Math.abs(amount) > MAX_AMOUNT) continue;

      const dateRaw = getOptionalMappedValue(row, payload.mapping.date) ?? payload.manualValues.date;
      const transactionDate = parseImportedDate(dateRaw) ?? new Date();

      const postedDateRaw = getOptionalMappedValue(row, payload.mapping.postedDate) ?? payload.manualValues.postedDate;
      const postedDate = parseImportedDate(postedDateRaw);
      const statementTitle = getOptionalMappedValue(row, payload.mapping.title) ?? payload.manualValues.title;
      const statementNote = getOptionalMappedValue(row, payload.mapping.note) ?? payload.manualValues.note;
      const accountName = getOptionalMappedValue(row, payload.mapping.accountName) ?? payload.manualValues.accountName;
      const categoryName = getOptionalMappedValue(row, payload.mapping.categoryName) ?? payload.manualValues.categoryName;

      // Rules fill what the statement leaves open: a category or account the row names
      // itself always wins, and the amount is the statement's, never a rule's.
      const rule = resolveRuleOutcome(
        ruleContext.rules,
        {
          texts: [statementTitle],
          amountCents: toCents(amount),
          accountId: accountName ? accountByName.get(accountName.toLowerCase()) ?? null : null,
          type: "EXPENSE",
        },
        expenseCategoryKinds,
        { learned: ruleContext.learned, hiddenTitleKeys: ruleContext.hiddenTitleKeys },
      );
      const title = rule.title ?? statementTitle;
      const note = appendRuleNote(statementNote, rule.appendNote) ?? undefined;
      const ruleAccountId = rule.accountId && activeAccountIds.has(rule.accountId) ? rule.accountId : undefined;
      const resolvedAccountId = accountName
        ? accountByName.get(accountName.toLowerCase()) ?? ruleAccountId ?? payload.defaults.accountId
        : ruleAccountId ?? payload.defaults.accountId;

      let resolvedCategoryId = rule.categoryId ?? payload.defaults.categoryId;
      if (categoryName) {
        const normalizedCategoryName = categoryName.toLowerCase();
        const existingCategoryId = categoryByName.get(normalizedCategoryName);
        if (existingCategoryId) {
          resolvedCategoryId = existingCategoryId;
        } else {
          const createdCategory = await tx.category.create({
            data: {
              userId: user.id,
              kind: CategoryKind.EXPENSE,
              name: categoryName,
            },
            select: { id: true },
          });
          resolvedCategoryId = createdCategory.id;
          categoryByName.set(normalizedCategoryName, createdCategory.id);
        }
      }

      pending.push({
        userId: user.id,
        accountId: resolvedAccountId,
        categoryId: resolvedCategoryId,
        type: TransactionType.EXPENSE,
        amountCents: toCents(amount),
        date: transactionDate,
        postedDate,
        title,
        note,
      });
    }
    if (pending.length > 0) await tx.transaction.createMany({ data: pending });
  }, LONG_TRANSACTION_OPTIONS);

  scheduleBudgetAlertEmails(user.id);
  revalidatePath("/");
  revalidatePath("/settings");
});

export const createIncomeAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const payload = incomeSchema.parse({
    accountId: getFormValue(formData, "accountId"),
    categoryId: getFormValue(formData, "categoryId"),
    amount: getFormValue(formData, "amount"),
    date: getFormValue(formData, "date"),
    postedDate: getFormValue(formData, "postedDate") || undefined,
    title: getFormValue(formData, "title") || undefined,
    note: getFormValue(formData, "note"),
  });
  await Promise.all([
    payload.accountId ? assertUserOwnsAccount(user.id, payload.accountId) : Promise.resolve(),
    assertUserOwnsCategory(user.id, payload.categoryId, CategoryKind.INCOME),
  ]);

  await prisma.transaction.create({
    data: {
      userId: user.id,
      accountId: payload.accountId,
      categoryId: payload.categoryId,
      type: TransactionType.INCOME,
      amountCents: toCents(payload.amount),
      date: dateFromYmd(payload.date),
      title: payload.title,
      note: payload.note,
    },
  });
  revalidatePath("/");
});

export const updateIncomeAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const payload = updateIncomeBaseSchema.parse({
    transactionId: getFormValue(formData, "transactionId"),
    accountId: getFormValue(formData, "accountId"),
    categoryId: getFormValue(formData, "categoryId"),
    date: getFormValue(formData, "date"),
    title: getFormValue(formData, "title") || undefined,
    note: getFormValue(formData, "note"),
  });
  const parsedAmount = positiveAmount.safeParse(getFormValue(formData, "amount"));
  if (!parsedAmount.success) {
    throw new Error(parsedAmount.error.issues[0]?.message ?? "Amount must be a positive number.");
  }
  const amount = parsedAmount.data;
  await Promise.all([
    payload.accountId ? assertUserOwnsAccount(user.id, payload.accountId) : Promise.resolve(),
    assertUserOwnsCategory(user.id, payload.categoryId, CategoryKind.INCOME),
  ]);

  const existing = await prisma.transaction.findFirst({
    where: {
      id: payload.transactionId,
      userId: user.id,
      type: TransactionType.INCOME,
    },
  });
  if (!existing) throw new Error("Income entry not found.");

  await prisma.transaction.update({
    where: { id: existing.id },
    data: {
      account: payload.accountId
        ? { connect: { id: payload.accountId } }
        : { disconnect: true },
      category: { connect: { id: payload.categoryId } },
      amountCents: toCents(amount),
      preCreditCents: null,
      creditCents: null,
      creditBreakdownJson: null,
      date: dateFromYmd(payload.date),
      title: payload.title,
      note: payload.note,
    },
  });
  revalidatePath("/");
});

export const deleteIncomeTransactionAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const transactionId = getFormValue(formData, "transactionId");
  if (!transactionId) throw new Error("Transaction id is required.");

  const existing = await prisma.transaction.findFirst({
    where: {
      id: transactionId,
      userId: user.id,
      type: TransactionType.INCOME,
    },
  });
  if (!existing) throw new Error("Income entry not found.");

  await prisma.transaction.delete({ where: { id: existing.id } });
  revalidatePath("/");
});

const TRANSFER_MARK_REFUSALS: Record<TransferMarkRefusal, string> = {
  "not-found": "Transaction not found.",
  split: "A split expense cannot be a transfer. Remove the split first.",
  "same-account": "A transfer cannot go to the account it came from.",
};

/** Books a logged expense or income entry as a transfer between the user's own accounts. */
export const markAsTransferAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const transactionId = getFormValue(formData, "transactionId");
  if (!transactionId) throw new Error("Transaction id is required.");

  const outcome = await prisma.$transaction((tx) => markAsTransfer(tx, { userId: user.id, transactionId }));
  if (!outcome.ok) throw new Error(TRANSFER_MARK_REFUSALS[outcome.reason]);
  revalidatePath("/");
});

/** Counts a transfer again: as an expense if the money left the account, income if it arrived. */
export const unmarkTransferAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const transactionId = getFormValue(formData, "transactionId");
  if (!transactionId) throw new Error("Transaction id is required.");

  const outcome = await prisma.$transaction((tx) => unmarkTransfer(tx, { userId: user.id, transactionId }));
  if (!outcome.ok) throw new Error(TRANSFER_MARK_REFUSALS[outcome.reason]);
  // It now counts toward a budget again, which may push one over.
  scheduleBudgetAlertEmails(user.id);
  revalidatePath("/");
});

/** Separates the two legs of a paired transfer; both stay transfers. */
export const unpairTransferAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const transactionId = getFormValue(formData, "transactionId");
  if (!transactionId) throw new Error("Transaction id is required.");

  const outcome = await prisma.$transaction((tx) => unpairTransfer(tx, { userId: user.id, transactionId }));
  if (!outcome.ok) throw new Error(TRANSFER_MARK_REFUSALS[outcome.reason]);
  revalidatePath("/");
});

/** Names the account on the other side of a transfer; an empty value clears it. */
export const setTransferAccountAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const transactionId = getFormValue(formData, "transactionId");
  if (!transactionId) throw new Error("Transaction id is required.");
  const transferAccountId = getFormValue(formData, "transferAccountId") || null;

  const outcome = await prisma.$transaction((tx) =>
    setTransferAccount(tx, { userId: user.id, transactionId, transferAccountId }),
  );
  if (!outcome.ok) throw new Error(TRANSFER_MARK_REFUSALS[outcome.reason]);
  revalidatePath("/");
});
