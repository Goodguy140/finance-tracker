import { randomUUID } from "node:crypto";
import { CategoryKind, Prisma, TransactionType, type PrismaClient } from "@prisma/client";
import type { z } from "zod";
import { scheduleBudgetAlertEmails } from "@/lib/budget-alert-dispatch";
import { DuplicateMatcher, statementOutflow, utcYmd, type CsvImportSummary } from "@/lib/csv-import";
import { ensureFallbackCategoryFor } from "@/lib/fallback-categories";
import { parseImportedDate } from "@/lib/import-dates";
import { MAX_AMOUNT, parseStatementAmount, toCents } from "@/lib/money";
import { LONG_TRANSACTION_OPTIONS } from "@/lib/prisma";
import { CATEGORY_NAME_MAX, clipText, TRANSACTION_NOTE_MAX, TRANSACTION_TITLE_MAX } from "@/lib/text-limits";
import { appendRuleNote, resolveRuleOutcome, ruleSplitLines } from "@/lib/transaction-rules";
import { loadRuleContext } from "@/lib/transaction-rules-server";
import type { expenseCsvImportSchema } from "@/lib/validation";
import { emitWebhookEvent } from "@/lib/webhooks";

/**
 * Books a statement's rows into the log, shared by the website's file import
 * (`importExpensesCsvAction`) and the phone's (`POST /api/v1/imports`). The rows are the file's,
 * read on the website in the browser and on the phone's behalf by the server, with the columns
 * mapped to fields. Rules fill what the statement leaves open, rows already in the log are
 * skipped, and everything booked waits in Needs review. Throws StatementImportError, said for the
 * person, when a choice does not hold.
 */

export type StatementImportInput = z.infer<typeof expenseCsvImportSchema>;

/** A choice in the import that does not hold, said for the person. */
export class StatementImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StatementImportError";
  }
}

function mapped(row: Record<string, string>, key?: string) {
  if (!key) return undefined;
  return row[key]?.trim() || undefined;
}

async function assertOwns(
  table: { findFirst: (args: { where: Record<string, unknown>; select: { id: true } }) => Promise<{ id: string } | null> },
  userId: string,
  id: string,
  kind: CategoryKind | undefined,
  message: string,
) {
  const row = await table.findFirst({ where: { id, userId, ...(kind ? { kind } : {}) }, select: { id: true } });
  if (!row) throw new StatementImportError(message);
}

function ymdParts(date: Date): [number, number, number] {
  return [date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()];
}

export async function importStatement(db: PrismaClient, userId: string, payload: StatementImportInput): Promise<CsvImportSummary> {
  const incomeCategoryId = payload.moneyIn === "income" ? payload.defaults.incomeCategoryId : undefined;
  if (payload.moneyIn === "income" && !incomeCategoryId) throw new StatementImportError("Choose a category for money coming in.");
  await Promise.all([
    payload.defaults.accountId
      ? assertOwns(db.account, userId, payload.defaults.accountId, undefined, "Selected account was not found.")
      : Promise.resolve(),
    payload.defaults.categoryId
      ? assertOwns(db.category, userId, payload.defaults.categoryId, CategoryKind.EXPENSE, "Selected category was not found.")
      : Promise.resolve(),
    incomeCategoryId ? assertOwns(db.category, userId, incomeCategoryId, CategoryKind.INCOME, "Selected category was not found.") : Promise.resolve(),
  ]);

  const usedFields = payload.fieldSelections.filter((field) => field);
  const uniqueFields = new Set(usedFields);
  if (uniqueFields.size !== usedFields.length) {
    throw new Error("Each CSV column can only be mapped to one field.");
  }

  const accounts = await db.account.findMany({
    where: { userId: userId, archived: false },
    select: { id: true, name: true },
  });
  const accountByName = new Map(accounts.map((account) => [account.name.trim().toLowerCase(), account.id]));
  const categories = await db.category.findMany({
    where: { userId: userId, kind: CategoryKind.EXPENSE },
    select: { id: true, name: true },
  });
  const categoryByName = new Map(categories.map((category) => [category.name.trim().toLowerCase(), category.id]));
  const ruleContext = await loadRuleContext(userId);
  const expenseCategoryKinds = new Map(categories.map((category) => [category.id, "EXPENSE" as const]));
  const incomeCategoryKinds = new Map(
    (
      await db.category.findMany({ where: { userId: userId, kind: CategoryKind.INCOME }, select: { id: true } })
    ).map((category) => [category.id, "INCOME" as const]),
  );
  const activeAccountIds = new Set(accounts.map((account) => account.id));

  const summary: CsvImportSummary = {
    ok: true,
    imported: 0,
    income: 0,
    unreadableDates: [],
    duplicates: [],
    unreadableAmounts: 0,
  };

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
    // Money out of the account; negative is money in.
    const amount = statementOutflow(row, payload.mapping, payload.amountSign, parseStatementAmount);
    if (amount === null || Math.abs(amount) > MAX_AMOUNT) {
      summary.unreadableAmounts += 1;
      return;
    }
    // A statement can carry any length; the log keeps to the limits a backup restore checks.
    const statementTitle = clipText(
      mapped(row, payload.mapping.title) ?? payload.manualValues.title,
      TRANSACTION_TITLE_MAX,
    );

    const dateRaw = mapped(row, payload.mapping.date) ?? payload.manualValues.date;
    const transactionDate = hasDateSource ? parseImportedDate(dateRaw) : new Date();
    if (!transactionDate) {
      summary.unreadableDates.push({ row: rowNumber, title: statementTitle ?? null, value: dateRaw ?? "", field: "date" });
      return;
    }
    const postedDateRaw = mapped(row, payload.mapping.postedDate) ?? payload.manualValues.postedDate;
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
      ? await db.transaction.findMany({
          where: {
            userId: userId,
            type: { in: [TransactionType.EXPENSE, TransactionType.TRANSFER, TransactionType.INCOME] },
            date: {
              gte: new Date(Date.UTC(...ymdParts(new Date(Math.min(...times))))),
              lt: new Date(Date.UTC(...ymdParts(new Date(Math.max(...times)))) + 86_400_000),
            },
          },
          select: { type: true, accountId: true, date: true, amountCents: true, title: true },
        })
      : [];
  const duplicates = new DuplicateMatcher(existing.filter((row) => row.type !== TransactionType.INCOME));
  // Income is kept positive, so it is compared with income only.
  const incomeDuplicates = new DuplicateMatcher(existing.filter((row) => row.type === TransactionType.INCOME));

  // Rows are resolved first (creating any missing categories as we go) and written with a
  // single createMany: one round trip per row used to push large statements past the
  // transaction timeout and roll the whole import back.
  await db.$transaction(async (tx) => {
    const pending: Prisma.TransactionCreateManyInput[] = [];
    // Tags the rules add. A tagged row gets its id here so its tags can name it in the same
    // batch; createMany returns no ids.
    const pendingTags: Prisma.TransactionTagCreateManyInput[] = [];
    // The parts of the lines a rule splits, named the same way.
    const pendingSplits: Prisma.SplitTransactionPartCreateManyInput[] = [];
    let transferCategoryId: string | null = null;
    for (const { rowNumber, row, amount, transactionDate, postedDate, statementTitle } of datedRows) {
      const statementNote = clipText(
        mapped(row, payload.mapping.note) ?? payload.manualValues.note,
        TRANSACTION_NOTE_MAX,
      );
      const accountName = mapped(row, payload.mapping.accountName) ?? payload.manualValues.accountName;
      const categoryName = clipText(
        mapped(row, payload.mapping.categoryName) ?? payload.manualValues.categoryName,
        CATEGORY_NAME_MAX,
      );

      // Money in is income only when the user said so; otherwise it is a refund, booked as a
      // negative expense in its category (see AGENTS.md on the sign convention).
      const asIncome = amount < 0 && incomeCategoryId !== undefined;
      // Rules fill what the statement leaves open: a category or account the row names
      // itself always wins, and the amount is the statement's, never a rule's.
      const rule = resolveRuleOutcome(
        ruleContext.rules,
        {
          texts: [statementTitle],
          amountCents: asIncome ? toCents(-amount) : toCents(amount),
          accountId: accountName ? accountByName.get(accountName.toLowerCase()) ?? null : null,
          type: asIncome ? "INCOME" : "EXPENSE",
        },
        asIncome ? incomeCategoryKinds : expenseCategoryKinds,
        { learned: ruleContext.learned, hiddenTitleKeys: ruleContext.hiddenTitleKeys },
      );
      const title = rule.title ?? statementTitle;
      const ruleAccountId = rule.accountId && activeAccountIds.has(rule.accountId) ? rule.accountId : undefined;
      const resolvedAccountId = accountName
        ? accountByName.get(accountName.toLowerCase()) ?? ruleAccountId ?? payload.defaults.accountId
        : ruleAccountId ?? payload.defaults.accountId;
      // Compared on the title and account as they would be saved, so a rule's rename matches
      // its own earlier import, and the same purchase on another card is not taken for a copy.
      const bookedCents = asIncome && !rule.markAsTransfer ? toCents(-amount) : toCents(amount);
      const matcher = asIncome && !rule.markAsTransfer ? incomeDuplicates : duplicates;
      if (matcher.claim(resolvedAccountId, transactionDate, bookedCents, title)) {
        summary.duplicates.push({
          row: rowNumber,
          title: title ?? null,
          date: utcYmd(transactionDate),
          amountCents: bookedCents,
        });
        continue;
      }
      const note = appendRuleNote(statementNote, rule.appendNote) ?? undefined;

      // A rule that marks transfers books the line as one, whatever category the file names:
      // the user said lines like this are not spending.
      if (rule.markAsTransfer) {
        const id = rule.tagIds.length > 0 ? randomUUID() : undefined;
        if (id) pendingTags.push(...rule.tagIds.map((tagId) => ({ transactionId: id, tagId })));
        transferCategoryId ??= await ensureFallbackCategoryFor(tx, userId, CategoryKind.TRANSFER);
        pending.push({
          id,
          userId: userId,
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

      if (asIncome) {
        const id = rule.tagIds.length > 0 ? randomUUID() : undefined;
        if (id) pendingTags.push(...rule.tagIds.map((tagId) => ({ transactionId: id, tagId })));
        pending.push({
          id,
          userId: userId,
          accountId: resolvedAccountId,
          // A category column names expense categories, so income takes the rule's or the default.
          categoryId: rule.categoryId ?? incomeCategoryId,
          type: TransactionType.INCOME,
          amountCents: bookedCents,
          date: transactionDate,
          postedDate,
          title,
          note,
        });
        summary.income += 1;
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
              userId: userId,
              kind: CategoryKind.EXPENSE,
              name: categoryName,
            },
            select: { id: true },
          });
          resolvedCategoryId = createdCategory.id;
          categoryByName.set(normalizedCategoryName, createdCategory.id);
        }
      }

      // A rule's split is its way of setting the category, so a category the file names wins.
      const splitLines = categoryName ? null : ruleSplitLines(rule.split, toCents(amount));
      if (splitLines) resolvedCategoryId = splitLines[0].categoryId;
      const id = rule.tagIds.length > 0 || splitLines ? randomUUID() : undefined;
      if (id) pendingTags.push(...rule.tagIds.map((tagId) => ({ transactionId: id, tagId })));
      if (id && splitLines) pendingSplits.push(...splitLines.map((line) => ({ ...line, userId: userId, transactionId: id })));
      pending.push({
        id,
        userId: userId,
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
    // Nobody typed these in: they wait in the log's "Needs review" filter until looked at.
    if (pending.length > 0) await tx.transaction.createMany({ data: pending.map((row) => ({ ...row, needsReview: true })) });
    if (pendingTags.length > 0) await tx.transactionTag.createMany({ data: pendingTags });
    if (pendingSplits.length > 0) await tx.splitTransactionPart.createMany({ data: pendingSplits });
    summary.imported = pending.length;
  }, LONG_TRANSACTION_OPTIONS);

  if (summary.imported > 0) {
    emitWebhookEvent(userId, "transactions.imported", {
      imported: summary.imported,
      income: summary.income,
      duplicatesSkipped: summary.duplicates.length,
    });
  }
  scheduleBudgetAlertEmails(userId);
  return summary;
}
