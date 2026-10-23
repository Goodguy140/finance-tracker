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
import { assertSplitLinesMatch, parseSplitLinesFromForm, saveSplitLines } from "@/lib/split-lines";
import { appendRuleNote, resolveRuleOutcome } from "@/lib/transaction-rules";
import { loadRuleContext } from "@/lib/transaction-rules-server";
import { addTagsToTransaction, replaceTransactionTags, resolveTagIds } from "@/lib/tags-server";
import { ensureFallbackCategoryFor } from "@/lib/fallback-categories";
import { parseTagNames } from "@/lib/tags";
import { deleteTransactionWithUndo, undoDeletedTransaction, type UndoRefusal } from "@/lib/transaction-undo";
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
  transferSchema,
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

type DeleteResult = { ok: true; undoId: string };
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
  const splitLines = parseSplitLinesFromForm(formData);
  if (splitLines) {
    await Promise.all(
      [...new Set(splitLines.map((line) => line.categoryId))].map((id) =>
        assertUserOwnsCategory(user.id, id, CategoryKind.EXPENSE),
      ),
    );
  }

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
    const isSplit = existing._count.splitParts > 0;
    // Only an expense that is already split has lines to edit: new splits are not created.
    if (splitLines && !isSplit) throw new Error("This expense is not split. Reload and try again.");
    if (isSplit && !splitLines) throw new Error("The split lines are missing. Reload and try again.");
    if (isSplit && owedRows && owedRows.length > 0) {
      // Shares come out of `amountCents`, which the lines must add up to; both at once would
      // leave the category figures counting what others owe.
      throw new Error("A split expense cannot have amounts owed back. Remove the split first.");
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
    if (splitLines) assertSplitLinesMatch(splitLines, amountCents);

    await tx.transaction.update({
      where: { id: existing.id },
      data: {
        account: payload.accountId
          ? { connect: { id: payload.accountId } }
          : { disconnect: true },
        // A split's own category is only a label; its first line's keeps it meaningful, and
        // is where the expense lands when one line is all that is left.
        category: { connect: { id: splitLines ? splitLines[0].categoryId : payload.categoryId } },
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
    if (splitLines) await saveSplitLines(tx, { userId: user.id, transactionId: existing.id, lines: splitLines });
    if (tagNames) await replaceTransactionTags(tx, existing.id, await resolveTagIds(tx, user.id, tagNames));
  });
  scheduleBudgetAlertEmails(user.id);
  revalidatePath("/");
});

/** Deletes an expense at once; the result's `undoId` lets "Undo" put it back for a few minutes. */
export const deleteExpenseTransactionAction = formActionWithResult(async (formData: FormData): Promise<DeleteResult> => {
  const user = await requireUser();
  const transactionId = getFormValue(formData, "transactionId");
  if (!transactionId) throw new Error("Transaction id is required.");

  const undoId = await deleteTransactionWithUndo(prisma, user.id, transactionId, TransactionType.EXPENSE);
  if (!undoId) throw new Error("Expense not found.");
  scheduleBudgetAlertEmails(user.id);
  revalidatePath("/");
  return { ok: true, undoId };
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
  // two overlapping statements) does not book the same spend twice. Transfers too: a rule may
  // have booked a statement line as one, and the transfer sign is the expense sign.
  const times = datedRows.map((entry) => entry.transactionDate.getTime());
  const existing =
    times.length > 0
      ? await prisma.transaction.findMany({
          where: {
            userId: user.id,
            type: { in: [TransactionType.EXPENSE, TransactionType.TRANSFER] },
            date: {
              gte: new Date(Date.UTC(...ymdParts(new Date(Math.min(...times))))),
              lt: new Date(Date.UTC(...ymdParts(new Date(Math.max(...times)))) + 86_400_000),
            },
          },
          select: { accountId: true, date: true, amountCents: true, title: true },
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
    let transferCategoryId: string | null = null;
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
      const ruleAccountId = rule.accountId && activeAccountIds.has(rule.accountId) ? rule.accountId : undefined;
      const resolvedAccountId = accountName
        ? accountByName.get(accountName.toLowerCase()) ?? ruleAccountId ?? payload.defaults.accountId
        : ruleAccountId ?? payload.defaults.accountId;
      // Compared on the title and account as they would be saved, so a rule's rename matches
      // its own earlier import, and the same purchase on another card is not taken for a copy.
      if (duplicates.claim(resolvedAccountId, transactionDate, toCents(amount), title)) {
        summary.duplicates.push({
          row: rowNumber,
          title: title ?? null,
          date: utcYmd(transactionDate),
          amountCents: toCents(amount),
        });
        continue;
      }
      const note = appendRuleNote(statementNote, rule.appendNote) ?? undefined;

      // A rule that marks transfers books the line as one, whatever category the file names:
      // the user said lines like this are not spending.
      if (rule.markAsTransfer) {
        const id = rule.tagIds.length > 0 ? randomUUID() : undefined;
        if (id) pendingTags.push(...rule.tagIds.map((tagId) => ({ transactionId: id, tagId })));
        transferCategoryId ??= await ensureFallbackCategoryFor(tx, user.id, CategoryKind.TRANSFER);
        pending.push({
          id,
          userId: user.id,
          accountId: resolvedAccountId,
          categoryId: transferCategoryId,
          type: TransactionType.TRANSFER,
          amountCents: toCents(amount),
          transferAccountId:
            rule.transferAccountId && rule.transferAccountId !== resolvedAccountId ? rule.transferAccountId : null,
          date: transactionDate,
          postedDate,
          title,
          note,
        });
        continue;
      }

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
  revalidatePath("/settings", "layout");
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

/**
 * Records a transfer by hand: one entry on the account the money left, naming the account it
 * went to, kept out of every total like any transfer. It is one entry, not two legs, so the
 * money is not counted on both sides.
 */
export const createTransferAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const payload = transferSchema.parse({
    fromAccountId: getFormValue(formData, "fromAccountId"),
    toAccountId: getFormValue(formData, "toAccountId"),
    amount: getFormValue(formData, "amount"),
    date: getFormValue(formData, "date"),
    title: getFormValue(formData, "title") || undefined,
    note: getFormValue(formData, "note") || undefined,
  });
  const tagNames = getTagNames(formData) ?? [];
  await Promise.all([
    assertUserOwnsAccount(user.id, payload.fromAccountId),
    assertUserOwnsAccount(user.id, payload.toAccountId),
  ]);

  await prisma.$transaction(async (tx) => {
    const created = await tx.transaction.create({
      data: {
        userId: user.id,
        accountId: payload.fromAccountId,
        transferAccountId: payload.toAccountId,
        categoryId: await ensureFallbackCategoryFor(tx, user.id, CategoryKind.TRANSFER),
        type: TransactionType.TRANSFER,
        // Transfers carry the expense sign: positive is money leaving `accountId`.
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

/** Deletes an income entry at once; the result's `undoId` lets "Undo" put it back for a few minutes. */
export const deleteIncomeTransactionAction = formActionWithResult(async (formData: FormData): Promise<DeleteResult> => {
  const user = await requireUser();
  const transactionId = getFormValue(formData, "transactionId");
  if (!transactionId) throw new Error("Transaction id is required.");

  const undoId = await deleteTransactionWithUndo(prisma, user.id, transactionId, TransactionType.INCOME);
  if (!undoId) throw new Error("Income entry not found.");
  revalidatePath("/");
  return { ok: true, undoId };
});

const UNDO_REFUSALS: Record<UndoRefusal, string> = {
  expired: "Too late to undo: deleted entries can be put back for 15 minutes.",
  "category-gone": "Its category has been deleted since, so it can't be put back.",
  conflict: "It's already back in your log.",
};

/** Puts back expense or income entries deleted in the last few minutes (one `undoId` each). */
export const undoDeleteTransactionAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const undoIds = formData.getAll("undoId").map(String).filter(Boolean);
  if (undoIds.length === 0) throw new Error("Nothing to undo.");
  let refusal: UndoRefusal | null = null;
  let restoredExpense = false;
  for (const undoId of undoIds) {
    const result = await undoDeletedTransaction(prisma, user.id, undoId);
    if (!result.ok) refusal ??= result.reason;
    else if (result.type === TransactionType.EXPENSE) restoredExpense = true;
  }
  if (restoredExpense) scheduleBudgetAlertEmails(user.id);
  revalidatePath("/");
  // Whatever could come back has; say why the rest could not.
  if (refusal) throw new Error(UNDO_REFUSALS[refusal]);
});

export type BulkEditResult = { ok: true; changed: number; skipped: number; undoIds: string[] };

const BULK_EDIT_LIMIT = 500;

/**
 * One change to several expenses picked in the Expense Log: a category, an account, a tag, or
 * delete (with Undo). Rows that are not the user's expenses are ignored. A split expense keeps
 * its categories, which live on its lines, and is counted as skipped.
 */
export const bulkEditExpensesAction = formActionWithResult(async (formData: FormData): Promise<BulkEditResult> => {
  const user = await requireUser();
  const ids = parseJsonField<unknown>(
    getFormValue(formData, "transactionIdsJson"),
    [],
    "The selected expenses could not be read. Reload and try again.",
  );
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
    throw new Error("The selected expenses could not be read. Reload and try again.");
  }
  if (ids.length > BULK_EDIT_LIMIT) throw new Error(`Pick at most ${BULK_EDIT_LIMIT} expenses at a time.`);
  const op = getFormValue(formData, "op");
  const value = getFormValue(formData, "value").trim();

  const rows = await prisma.transaction.findMany({
    where: { id: { in: ids as string[] }, userId: user.id, type: TransactionType.EXPENSE },
    select: { id: true, _count: { select: { splitParts: true } } },
  });
  const rowIds = rows.map((row) => row.id);
  let changed = 0;
  let skipped = 0;
  const undoIds: string[] = [];

  if (op === "category") {
    if (!value) throw new Error("Choose a category.");
    await assertUserOwnsCategory(user.id, value, CategoryKind.EXPENSE);
    const plain = rows.filter((row) => row._count.splitParts === 0).map((row) => row.id);
    skipped = rows.length - plain.length;
    changed = (await prisma.transaction.updateMany({ where: { id: { in: plain }, userId: user.id }, data: { categoryId: value } })).count;
  } else if (op === "account") {
    if (!value) throw new Error("Choose an account.");
    await assertUserOwnsAccount(user.id, value);
    changed = (await prisma.transaction.updateMany({ where: { id: { in: rowIds }, userId: user.id }, data: { accountId: value } })).count;
  } else if (op === "tag") {
    const names = parseTagNames([value]);
    if (names.length === 0) throw new Error("Type a tag to add.");
    await prisma.$transaction(async (tx) => {
      const tagIds = await resolveTagIds(tx, user.id, names);
      for (const id of rowIds) await addTagsToTransaction(tx, id, tagIds);
    }, LONG_TRANSACTION_OPTIONS);
    changed = rowIds.length;
  } else if (op === "delete") {
    for (const id of rowIds) {
      const undoId = await deleteTransactionWithUndo(prisma, user.id, id, TransactionType.EXPENSE);
      if (undoId) undoIds.push(undoId);
    }
    changed = undoIds.length;
  } else {
    throw new Error("Choose what to change.");
  }

  scheduleBudgetAlertEmails(user.id);
  revalidatePath("/");
  return { ok: true, changed, skipped, undoIds };
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
