"use server";

import { revalidatePath } from "next/cache";
import { CategoryKind, TransactionType } from "@prisma/client";
import { scheduleBudgetAlertEmails } from "@/lib/budget-alert-dispatch";
import { BULK_EDIT_LIMIT, bulkEditExpenses } from "@/lib/bulk-edit-expenses";
import { toCents } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { dateFromYmd } from "@/lib/date-only";
import type { CsvImportSummary } from "@/lib/csv-import";
import { importStatement } from "@/lib/statement-import";
import { emitTransactionsCreated } from "@/lib/webhooks";
import { requireUser } from "@/lib/session";
import { parseExpenseAmountFromForm } from "@/lib/expense-amount";
import { ownPartCents, parseOwedSharesFromForm, saveOwedShares } from "@/lib/owed-shares";
import { assertSplitLinesMatch, parseSplitLinesFromForm, saveSplitLines } from "@/lib/split-lines";
import { ruleSplitLines, usableRuleSplit } from "@/lib/transaction-rules";
import { RULE_SPLITS_INCLUDE } from "@/lib/transaction-rules-server";
import { addTagsToTransaction, replaceTransactionTags, resolveTagIds } from "@/lib/tags-server";
import { ensureFallbackCategoryFor } from "@/lib/fallback-categories";
import { deleteTransactionWithUndo, undoDeletedTransaction, UNDO_REFUSAL_MESSAGES, type UndoRefusal } from "@/lib/transaction-undo";
import {
  markAsTransfer,
  setTransferAccount,
  unmarkTransfer,
  TRANSFER_MARK_REFUSALS,
  unpairTransfer,
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
  assertUserOwnsAccount,
  assertUserOwnsCategory,
  formAction,
  formActionWithResult,
  parseJsonField,
} from "./_helpers";

type DeleteResult = { ok: true; undoId: string };

/**
 * The lines to split a new expense into when the Add form kept a rule's split: the form names
 * the rule, and the lines are worked out here from its shares as they are now and the amount
 * actually saved. New splits are made only this way; there is no form for typing them in.
 */
async function ruleSplitForNewExpense(userId: string, ruleId: string, amountCents: number) {
  if (!ruleId) return null;
  const rule = await prisma.transactionRule.findFirst({ where: { id: ruleId, userId }, include: RULE_SPLITS_INCLUDE });
  if (!rule) throw new Error("The rule that splits this expense was not found. Reload and try again.");
  const categories = await prisma.category.findMany({
    where: { userId, id: { in: rule.splits.map((line) => line.categoryId) } },
    select: { id: true, kind: true },
  });
  const kinds = new Map(categories.map((c) => [c.id, c.kind as "EXPENSE" | "INCOME" | "TRANSFER"]));
  return ruleSplitLines(usableRuleSplit(rule.splits, kinds), amountCents);
}
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
  const splitLines = await ruleSplitForNewExpense(user.id, getFormValue(formData, "splitRuleId"), amounts.amountCents);

  const created = await prisma.$transaction(async (tx) => {
    const created = await tx.transaction.create({
      data: {
        userId: user.id,
        accountId: payload.accountId,
        categoryId: splitLines ? splitLines[0].categoryId : payload.categoryId,
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
    if (splitLines) await saveSplitLines(tx, { userId: user.id, transactionId: created.id, lines: splitLines });
    await addTagsToTransaction(tx, created.id, await resolveTagIds(tx, user.id, tagNames));
    return created;
  });
  emitTransactionsCreated(user.id, [created.id], "manual");
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
        // Saving the edit dialog is looking at the row.
        needsReview: false,
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
      amountIn: getFormValue(formData, "map_amountIn") || undefined,
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
      incomeCategoryId: getFormValue(formData, "defaultIncomeCategoryId") || undefined,
    },
    amountSign: getFormValue(formData, "amountSign") || undefined,
    moneyIn: getFormValue(formData, "moneyIn") || undefined,
    fieldSelections,
  });
  const summary = await importStatement(prisma, user.id, payload);
  revalidatePath("/");
  revalidatePath("/settings", "layout");
  return summary;
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
  const tagNames = getTagNames(formData) ?? [];
  await Promise.all([
    payload.accountId ? assertUserOwnsAccount(user.id, payload.accountId) : Promise.resolve(),
    assertUserOwnsCategory(user.id, payload.categoryId, CategoryKind.INCOME),
  ]);

  const created = await prisma.$transaction(async (tx) => {
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
    return created;
  });
  emitTransactionsCreated(user.id, [created.id], "manual");
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

  const transfer = await prisma.$transaction(async (tx) => {
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
    return created;
  });
  emitTransactionsCreated(user.id, [transfer.id], "manual");
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
        // Saving the edit dialog is looking at the row.
        needsReview: false,
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
  if (refusal) throw new Error(UNDO_REFUSAL_MESSAGES[refusal]);
});

export type BulkEditResult = { ok: true; changed: number; skipped: number; undoIds: string[] };

/**
 * One change to several expenses picked in the Expense Log: a category, an account, a tag, or
 * delete (with Undo). Shared with the phone (`bulkEditExpenses`).
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
  const outcome = await bulkEditExpenses(prisma, user.id, ids as string[], getFormValue(formData, "op"), getFormValue(formData, "value"));
  scheduleBudgetAlertEmails(user.id);
  revalidatePath("/");
  return { ok: true, ...outcome };
});

/**
 * Marks imported, auto-posted or API entries of any kind as looked at: the Income card's and
 * the Transfers list's "Mark reviewed", as the Expense Log's bulk bar does for spending. Rows
 * that are not the user's are ignored. Nothing else about them changes.
 */
export const markTransactionsReviewedAction = formActionWithResult(
  async (formData: FormData): Promise<{ ok: true; changed: number }> => {
    const user = await requireUser();
    const ids = parseJsonField<unknown>(
      getFormValue(formData, "transactionIdsJson"),
      [],
      "The entries to mark could not be read. Reload and try again.",
    );
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
      throw new Error("The entries to mark could not be read. Reload and try again.");
    }
    if (ids.length > BULK_EDIT_LIMIT) throw new Error(`Mark at most ${BULK_EDIT_LIMIT} entries at a time.`);
    const { count } = await prisma.transaction.updateMany({
      where: { id: { in: ids as string[] }, userId: user.id, needsReview: true },
      data: { needsReview: false },
    });
    revalidatePath("/");
    return { ok: true, changed: count };
  },
);

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
