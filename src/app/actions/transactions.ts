"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { CategoryKind, Prisma, TransactionType } from "@prisma/client";
import { scheduleBudgetAlertEmails } from "@/lib/budget-alert-dispatch";
import { MAX_AMOUNT, parseStatementAmount, toCents } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { dateFromYmd } from "@/lib/date-only";
import { parseImportedDate } from "@/lib/import-dates";
import { DuplicateMatcher, utcYmd, type CsvImportSummary } from "@/lib/csv-import";
import { requireUser } from "@/lib/session";
import { parseExpenseAmountFromForm } from "@/lib/expense-amount";
import { ownPartCents, parseOwedSharesFromForm, saveOwedShares } from "@/lib/owed-shares";
import { appendRuleNote, resolveRuleOutcome } from "@/lib/transaction-rules";
import { loadRuleContext } from "@/lib/transaction-rules-server";
import { addTagsToTransaction, replaceTransactionTags, resolveTagIds } from "@/lib/tags-server";
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
  getTagNames,
  LONG_TRANSACTION_OPTIONS,
  assertUserOwnsAccount,
  assertUserOwnsCategory,
  formAction,
  formActionWithResult,
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
  const tagNames = getTagNames(formData) ?? [];
  await Promise.all([
    payload.accountId ? assertUserOwnsAccount(user.id, payload.accountId) : Promise.resolve(),
    assertUserOwnsCategory(user.id, payload.categoryId, CategoryKind.EXPENSE),
  ]);

  await prisma.$transaction(async (tx) => {
    const created = await tx.transaction.create({
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
      select: { id: true },
    });
    await addTagsToTransaction(tx, created.id, await resolveTagIds(tx, user.id, tagNames));
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
  const tagNames = getTagNames(formData);
  await Promise.all([
    payload.accountId ? assertUserOwnsAccount(user.id, payload.accountId) : Promise.resolve(),
    assertUserOwnsCategory(user.id, payload.categoryId, CategoryKind.EXPENSE),
  ]);

  const owedRows = parseOwedSharesFromForm(formData);

  await prisma.$transaction(async (tx) => {
    const existing = await tx.transaction.findFirst({
      where: {
        id: payload.transactionId,
        userId: user.id,
        type: TransactionType.EXPENSE,
      },
      select: {
        id: true,
        recurringTransactionId: true,
        _count: { select: { splitParts: true } },
        owedShares: { select: { id: true, amountCents: true } },
      },
    });
    if (!existing) throw new Error("Expense not found.");
    if (existing._count.splitParts > 0) {
      throw new Error("Split expenses cannot be edited here.");
    }

    // The form's amount is what the user paid; what others owe comes out of it. A form that
    // does not carry the owed rows keeps the ones already there.
    const shares = owedRows ?? existing.owedShares;
    if (owedRows && owedRows.length > 0 && existing.owedShares.length === 0 && existing.recurringTransactionId) {
      // A shared subscription credits its members' shares onto this same amount when they
      // pay; a second way of netting on top of that would count them twice.
      const members = await tx.subscriptionMember.count({
        where: { userId: user.id, recurringTransactionId: existing.recurringTransactionId },
      });
      if (members > 0) {
        throw new Error("This bill's subscription already splits it. Track who owes what on the subscription instead.");
      }
    }
    const amountCents = ownPartCents(amounts.amountCents, shares);

    await tx.transaction.update({
      where: { id: existing.id },
      data: {
        account: payload.accountId
          ? { connect: { id: payload.accountId } }
          : { disconnect: true },
        category: { connect: { id: payload.categoryId } },
        amountCents,
        preCreditCents: amounts.preCreditCents,
        creditCents: amounts.creditCents,
        creditBreakdownJson: amounts.creditBreakdownJson,
        date: dateFromYmd(payload.date),
        postedDate: payload.postedDate ? dateFromYmd(payload.postedDate) : null,
        title: payload.title,
        note: payload.note,
      },
    });
    if (owedRows) {
      await saveOwedShares(tx, { userId: user.id, transactionId: existing.id, rows: owedRows });
    }
    if (tagNames) await replaceTransactionTags(tx, existing.id, await resolveTagIds(tx, user.id, tagNames));
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

export const importExpensesCsvAction = formActionWithResult(async (formData: FormData): Promise<CsvImportSummary> => {
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

  const summary: CsvImportSummary = { ok: true, imported: 0, unreadableDates: [], duplicates: [], unreadableAmounts: 0 };

  // A date that cannot be read leaves the row out rather than booking it today, which filed
  // it in the wrong month. Only a file that names no date anywhere (no date column, no
  // manual date) is booked today, as the preview says.
  const datedRows: Array<{
    rowNumber: number;
    row: Record<string, string>;
    amount: number;
    transactionDate: Date;
    postedDate: Date | null;
    statementTitle: string | undefined;
  }> = [];
  const hasDateSource = Boolean(payload.mapping.date || payload.manualValues.date);
  payload.rows.forEach((row, index) => {
    const rowNumber = index + 1;
    const amountRaw = row[payload.mapping.amount]?.trim();
    const amount = amountRaw ? parseStatementAmount(amountRaw) : null;
    if (amount === null || Math.abs(amount) > MAX_AMOUNT) {
      summary.unreadableAmounts += 1;
      return;
    }
    const statementTitle = getOptionalMappedValue(row, payload.mapping.title) ?? payload.manualValues.title;

    const dateRaw = getOptionalMappedValue(row, payload.mapping.date) ?? payload.manualValues.date;
    const transactionDate = hasDateSource ? parseImportedDate(dateRaw) : new Date();
    if (!transactionDate) {
      summary.unreadableDates.push({ row: rowNumber, title: statementTitle ?? null, value: dateRaw ?? "", field: "date" });
      return;
    }
    const postedDateRaw = getOptionalMappedValue(row, payload.mapping.postedDate) ?? payload.manualValues.postedDate;
    const postedDate = parseImportedDate(postedDateRaw);
    if (postedDateRaw && !postedDate) {
      summary.unreadableDates.push({ row: rowNumber, title: statementTitle ?? null, value: postedDateRaw, field: "postedDate" });
      return;
    }
    datedRows.push({ rowNumber, row, amount, transactionDate, postedDate, statementTitle });
  });

  // Expenses already in the log over the file's span, so a statement imported twice (or
  // two overlapping statements) does not book the same spend twice.
  const times = datedRows.map((entry) => entry.transactionDate.getTime());
  const existing =
    times.length > 0
      ? await prisma.transaction.findMany({
          where: {
            userId: user.id,
            type: TransactionType.EXPENSE,
            date: {
              gte: new Date(Date.UTC(...ymdParts(new Date(Math.min(...times))))),
              lt: new Date(Date.UTC(...ymdParts(new Date(Math.max(...times)))) + 86_400_000),
            },
          },
          select: { date: true, amountCents: true, title: true },
        })
      : [];
  const duplicates = new DuplicateMatcher(existing);

  // Rows are resolved first (creating any missing categories as we go) and written with a
  // single createMany: one round trip per row used to push large statements past the
  // transaction timeout and roll the whole import back.
  await prisma.$transaction(async (tx) => {
    const pending: Prisma.TransactionCreateManyInput[] = [];
    // Tags the rules add. A tagged row gets its id here so its tags can name it in the same
    // batch; createMany returns no ids.
    const pendingTags: Prisma.TransactionTagCreateManyInput[] = [];
    for (const { rowNumber, row, amount, transactionDate, postedDate, statementTitle } of datedRows) {
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
      // Compared on the title as it would be saved, so a rule's rename matches its own
      // earlier import.
      if (duplicates.claim(transactionDate, toCents(amount), title)) {
        summary.duplicates.push({
          row: rowNumber,
          title: title ?? null,
          date: utcYmd(transactionDate),
          amountCents: toCents(amount),
        });
        continue;
      }
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

      const id = rule.tagIds.length > 0 ? randomUUID() : undefined;
      if (id) pendingTags.push(...rule.tagIds.map((tagId) => ({ transactionId: id, tagId })));
      pending.push({
        id,
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
    if (pendingTags.length > 0) await tx.transactionTag.createMany({ data: pendingTags });
    summary.imported = pending.length;
  }, LONG_TRANSACTION_OPTIONS);

  scheduleBudgetAlertEmails(user.id);
  revalidatePath("/");
  revalidatePath("/settings");
  return summary;
});

function ymdParts(date: Date): [number, number, number] {
  return [date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()];
}

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
  const tagNames = getTagNames(formData) ?? [];
  await Promise.all([
    payload.accountId ? assertUserOwnsAccount(user.id, payload.accountId) : Promise.resolve(),
    assertUserOwnsCategory(user.id, payload.categoryId, CategoryKind.INCOME),
  ]);

  await prisma.$transaction(async (tx) => {
    const created = await tx.transaction.create({
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
      select: { id: true },
    });
    await addTagsToTransaction(tx, created.id, await resolveTagIds(tx, user.id, tagNames));
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
  const tagNames = getTagNames(formData);
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

  await prisma.$transaction(async (tx) => {
    await tx.transaction.update({
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
    if (tagNames) await replaceTransactionTags(tx, existing.id, await resolveTagIds(tx, user.id, tagNames));
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
  owed: "Someone owes you part of this expense. Remove what they owe before making it a transfer.",
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
