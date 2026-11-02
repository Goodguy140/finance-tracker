import { emitTransactionsCreated } from "@/lib/webhooks";
import { CategoryKind, Prisma, TransactionType, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { dateFromYmd, ymdFromDateUtc } from "@/lib/date-only";
import { ensureFallbackCategoryFor } from "@/lib/fallback-categories";
import { MAX_AMOUNT_CENTS } from "@/lib/money";
import { currentYmdInTimeZone } from "@/lib/period-month";
import { addTagsToTransaction, resolveTagIds } from "@/lib/tags-server";
import { appendRuleNote, resolveRuleOutcome, ruleSplitLines } from "@/lib/transaction-rules";
import { saveSplitLines } from "@/lib/split-lines";
import { TRANSACTION_NOTE_MAX, TRANSACTION_TITLE_MAX } from "@/lib/text-limits";
import { loadRuleContext } from "@/lib/transaction-rules-server";
import { transactionSearchWhere } from "@/lib/search/search-data";
import { replaceTransactionTags } from "@/lib/tags-server";
import { deleteTransactionWithUndo, undoDeletedTransaction, UNDO_REFUSAL_MESSAGES } from "@/lib/transaction-undo";

/**
 * The personal API's transactions: `GET /api/v1/transactions` lists them and
 * `POST /api/v1/transactions` logs an expense, income or transfer (the phone app, a shortcut, a
 * script). An expense or income that a "Mark as transfer" rule matches is booked as a transfer
 * instead, as a statement import books it, unless the request names a category.
 * Amounts are integer cents in the entry's own sign convention: an expense's positive amount
 * is money out, a negative one a refund; income is positive; a transfer's positive amount
 * left `accountId`.
 */

const YMD = /^\d{4}-\d{2}-\d{2}$/;
export const API_LIST_DEFAULT_LIMIT = 100;
export const API_LIST_MAX_LIMIT = 500;

const listQuerySchema = z.object({
  from: z.string().regex(YMD, "'from' must be YYYY-MM-DD.").optional(),
  to: z.string().regex(YMD, "'to' must be YYYY-MM-DD.").optional(),
  type: z.enum(["expense", "income", "transfer"]).optional(),
  accountId: z.string().min(1).optional(),
  categoryId: z.string().min(1).optional(),
  /** Words or an amount, matched as the website's search matches them (title, note, bank text, amount). */
  q: z.string().trim().min(1).max(100, "'q' is too long.").optional(),
  tagId: z.string().min(1).optional(),
  /** Only entries that came in without being typed and have not been looked at. */
  needsReview: z.enum(["true", "false"], "'needsReview' must be true or false.").optional(),
  limit: z.coerce.number().int().min(1).max(API_LIST_MAX_LIMIT).default(API_LIST_DEFAULT_LIMIT),
  cursor: z.string().min(1).optional(),
});

export type ListQuery = z.infer<typeof listQuerySchema>;

export function parseListQuery(params: URLSearchParams): { ok: true; query: ListQuery } | { ok: false; error: string } {
  const raw = Object.fromEntries([...params.entries()].filter(([, v]) => v !== ""));
  const parsed = listQuerySchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid query." };
  return { ok: true, query: parsed.data };
}

const transactionInclude = {
  category: { select: { name: true } },
  account: { select: { name: true, currency: true } },
  transferAccount: { select: { name: true } },
  _count: { select: { attachments: true } },
  tags: { include: { tag: { select: { name: true } } } },
  splitParts: { select: { categoryId: true, amountCents: true } },
  owedShares: { select: { amountCents: true } },
  verification: { select: { id: true } },
} satisfies Prisma.TransactionInclude;

type Row = Prisma.TransactionGetPayload<{ include: typeof transactionInclude }>;

export function serializeTransaction(tx: Row) {
  return {
    id: tx.id,
    type: tx.type.toLowerCase(),
    date: ymdFromDateUtc(tx.date),
    postedDate: tx.postedDate ? ymdFromDateUtc(tx.postedDate) : null,
    title: tx.title,
    amountCents: tx.amountCents,
    currency: tx.account?.currency ?? null,
    categoryId: tx.categoryId,
    categoryName: tx.category.name,
    accountId: tx.accountId,
    accountName: tx.account?.name ?? null,
    transferAccountId: tx.transferAccountId,
    transferAccountName: tx.transferAccount?.name ?? null,
    note: tx.note,
    tags: tx.tags.map((t) => t.tag.name),
    splits: tx.splitParts.map((p) => ({ categoryId: p.categoryId, amountCents: p.amountCents })),
    owedToYouCents: tx.owedShares.reduce((sum, s) => sum + s.amountCents, 0),
    verified: tx.verification !== null,
    needsReview: tx.needsReview,
    /** Credits and rewards taken off the purchase total; null when there were none. */
    creditCents: tx.creditCents,
    attachmentCount: tx._count.attachments,
  };
}

/** Newest first. `nextCursor` is set while more rows remain; pass it back as `cursor`. */
export async function listTransactionsForApi(db: PrismaClient, userId: string, query: ListQuery) {
  const toExclusive = query.to ? new Date(dateFromYmd(query.to).getTime() + 86_400_000) : undefined;
  const where: Prisma.TransactionWhereInput = {
    userId,
    ...(query.type ? { type: query.type.toUpperCase() as TransactionType } : {}),
    ...(query.accountId ? { accountId: query.accountId } : {}),
    ...(query.categoryId ? { categoryId: query.categoryId } : {}),
    ...(query.from || toExclusive
      ? { date: { ...(query.from ? { gte: dateFromYmd(query.from) } : {}), ...(toExclusive ? { lt: toExclusive } : {}) } }
      : {}),
    ...(query.tagId ? { tags: { some: { tagId: query.tagId } } } : {}),
    ...(query.needsReview ? { needsReview: query.needsReview === "true" } : {}),
    ...(query.q ? { AND: [transactionSearchWhere(userId, { query: query.q })] } : {}),
  };
  // A cursor from someone else's data, or a deleted row, starts nothing: it is checked here
  // rather than handed to Prisma, which would throw on an id it cannot find.
  const cursorOk = query.cursor ? (await db.transaction.count({ where: { id: query.cursor, userId } })) > 0 : false;
  if (query.cursor && !cursorOk) return { ok: false as const, error: "Unknown 'cursor'." };
  const rows = await db.transaction.findMany({
    where,
    include: transactionInclude,
    orderBy: [{ date: "desc" }, { id: "desc" }],
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });
  const page = rows.slice(0, query.limit);
  return {
    ok: true as const,
    transactions: page.map(serializeTransaction),
    nextCursor: rows.length > query.limit ? page[page.length - 1].id : null,
  };
}

const amountCents = z.number().int().refine((n) => n !== 0 && Math.abs(n) <= MAX_AMOUNT_CENTS, "'amountCents' is out of range.");

const createSchema = z
  .object({
    type: z.enum(["expense", "income", "transfer"]),
    amountCents: amountCents.optional(),
    /** Dollars, as a convenience for shortcuts: 12.5 or "12.50". */
    amount: z.union([z.number(), z.string().trim().regex(/^-?\d+(\.\d{1,2})?$/, "'amount' must be a number like 12.50.")]).optional(),
    date: z.string().regex(YMD, "'date' must be YYYY-MM-DD.").optional(),
    postedDate: z.string().regex(YMD, "'postedDate' must be YYYY-MM-DD.").optional(),
    title: z.string().trim().max(TRANSACTION_TITLE_MAX).optional(),
    note: z.string().trim().max(TRANSACTION_NOTE_MAX).optional(),
    categoryId: z.string().min(1).optional(),
    category: z.string().trim().min(1).max(100).optional(),
    accountId: z.string().min(1).optional(),
    account: z.string().trim().min(1).max(100).optional(),
    /** A transfer's other side, where the money went; `accountId` is where it left. */
    transferAccountId: z.string().min(1).optional(),
    transferAccount: z.string().trim().min(1).max(100).optional(),
    tags: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
  })
  .strict();

/**
 * Who is adding: "api" a script or shortcut with a personal access token, so the entry waits in
 * Needs review; "app" the person on the phone app and "search" the person in the master search,
 * who typed it themselves, so nothing is left to review.
 */
export type CreateSource = "api" | "app" | "search";

export type CreateResult =
  | { ok: true; transaction: ReturnType<typeof serializeTransaction> }
  | { ok: false; status: 400 | 404; error: string };

/**
 * Logs one expense, income or transfer. Category and accounts can be given by id or by name;
 * for an expense or income, whatever is left out is filled the way the Add card fills it, from
 * the user's rules and the categories their past titles went to, and otherwise the default
 * account and the catch-all category. A transfer is booked as the Add card's Transfer tab books
 * it: both accounts named, no rules, the transfer category.
 *
 * `idempotencyKeyId` is a claimed `ApiIdempotencyKey`: it is pointed at the new entry inside the
 * same database transaction, so a retry can never find the entry saved and its key still open.
 */
export async function createTransactionFromApi(
  db: PrismaClient,
  user: { id: string; timezone: string | null },
  body: unknown,
  source: CreateSource = "api",
  { idempotencyKeyId }: { idempotencyKeyId?: string } = {},
): Promise<CreateResult> {
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const message = issue?.code === "unrecognized_keys" ? `Unknown field ${issue.keys.map((k) => `'${k}'`).join(", ")}.` : issue?.message;
    return { ok: false, status: 400, error: message ?? "Invalid body." };
  }
  const input = parsed.data;
  if ((input.amountCents === undefined) === (input.amount === undefined)) {
    return { ok: false, status: 400, error: "Give exactly one of 'amountCents' or 'amount'." };
  }
  const cents = input.amountCents ?? Math.round(Number(input.amount) * 100);
  if (!Number.isFinite(cents) || cents === 0 || Math.abs(cents) > MAX_AMOUNT_CENTS) {
    return { ok: false, status: 400, error: "The amount is out of range." };
  }
  if (input.accountId && input.account) return { ok: false, status: 400, error: "Give 'accountId' or 'account', not both." };
  if (input.type === "transfer") return createTransferFromApi(db, user, input, cents, source, idempotencyKeyId);
  if (input.transferAccountId || input.transferAccount) {
    return { ok: false, status: 400, error: "Only a transfer has 'transferAccountId' or 'transferAccount'." };
  }
  const type = input.type === "income" ? TransactionType.INCOME : TransactionType.EXPENSE;
  if (type === TransactionType.INCOME && cents < 0) {
    return { ok: false, status: 400, error: "Income must be positive." };
  }
  if (input.categoryId && input.category) return { ok: false, status: 400, error: "Give 'categoryId' or 'category', not both." };

  const kind = type === TransactionType.INCOME ? CategoryKind.INCOME : CategoryKind.EXPENSE;
  const [categories, accounts, owner] = await Promise.all([
    db.category.findMany({ where: { userId: user.id, kind }, select: { id: true, name: true } }),
    db.account.findMany({ where: { userId: user.id, archived: false }, select: { id: true, name: true } }),
    db.user.findUniqueOrThrow({ where: { id: user.id }, select: { defaultExpenseAccountId: true } }),
  ]);

  let categoryId: string | undefined;
  if (input.categoryId) {
    if (!categories.some((c) => c.id === input.categoryId)) {
      return { ok: false, status: 404, error: `No ${input.type} category with that id.` };
    }
    categoryId = input.categoryId;
  } else if (input.category) {
    categoryId = categories.find((c) => c.name.trim().toLowerCase() === input.category!.toLowerCase())?.id;
    if (!categoryId) return { ok: false, status: 404, error: `No ${input.type} category named '${input.category}'.` };
  }
  const namedAccount = findOpenAccount(accounts, input.accountId, input.account);
  if (namedAccount && !namedAccount.ok) return namedAccount;
  let accountId = namedAccount?.id;

  const ruleContext = await loadRuleContext(user.id);
  const rule = resolveRuleOutcome(
    ruleContext.rules,
    { texts: [input.title], amountCents: cents, accountId: accountId ?? null, type },
    new Map(categories.map((c) => [c.id, type])),
    type === TransactionType.EXPENSE ? { learned: ruleContext.learned, hiddenTitleKeys: ruleContext.hiddenTitleKeys } : undefined,
  );
  const openAccountIds = new Set(accounts.map((a) => a.id));
  accountId ??=
    (rule.accountId && openAccountIds.has(rule.accountId) ? rule.accountId : undefined) ??
    (type === TransactionType.EXPENSE && owner.defaultExpenseAccountId && openAccountIds.has(owner.defaultExpenseAccountId)
      ? owner.defaultExpenseAccountId
      : undefined);

  // The user said entries like this are not spending (or income). A category the request names
  // is the caller saying what this one is, so it wins, the same way it wins over a rule's split.
  const asTransfer = rule.markAsTransfer === true && !categoryId;
  const transferAccountId =
    asTransfer && rule.transferAccountId && rule.transferAccountId !== accountId && openAccountIds.has(rule.transferAccountId)
      ? rule.transferAccountId
      : null;

  const created = await db.$transaction(async (tx) => {
    // A rule's split is its way of setting the category, so a category the request names wins.
    const splitLines = categoryId || asTransfer ? null : ruleSplitLines(rule.split, cents);
    const resolvedCategoryId = asTransfer
      ? await ensureFallbackCategoryFor(tx, user.id, CategoryKind.TRANSFER)
      : (splitLines?.[0].categoryId ?? categoryId ?? rule.categoryId ?? (await ensureFallbackCategoryFor(tx, user.id, kind)));
    const row = await tx.transaction.create({
      data: {
        userId: user.id,
        type: asTransfer ? TransactionType.TRANSFER : type,
        // A transfer's positive amount left `accountId`: money out for an expense, in for income.
        amountCents: asTransfer && type === TransactionType.INCOME ? -cents : cents,
        transferAccountId,
        categoryId: resolvedCategoryId,
        accountId: accountId ?? null,
        date: dateFromYmd(input.date ?? currentYmdInTimeZone(user.timezone)),
        postedDate: input.postedDate ? dateFromYmd(input.postedDate) : null,
        title: rule.title ?? input.title ?? null,
        note: appendRuleNote(input.note ?? null, rule.appendNote) ?? null,
        // Posted by a script, not typed by the person.
        needsReview: source === "api",
      },
      select: { id: true },
    });
    if (splitLines) await saveSplitLines(tx, { userId: user.id, transactionId: row.id, lines: splitLines });
    const tagIds = [...new Set([...(await resolveTagIds(tx, user.id, input.tags ?? [])), ...rule.tagIds])];
    await addTagsToTransaction(tx, row.id, tagIds);
    if (idempotencyKeyId) await tx.apiIdempotencyKey.update({ where: { id: idempotencyKeyId }, data: { transactionId: row.id } });
    return tx.transaction.findUniqueOrThrow({ where: { id: row.id }, include: transactionInclude });
  });
  emitTransactionsCreated(user.id, [created.id], source === "api" ? "api" : "manual", { client: db });
  return { ok: true, transaction: serializeTransaction(created) };
}

type OpenAccount = { id: string; name: string };

/** The open account a request names by id or by name, the refusal when there is none, or undefined when it names none. */
function findOpenAccount(
  accounts: readonly OpenAccount[],
  id: string | undefined,
  name: string | undefined,
  field = "account",
): { ok: true; id: string } | { ok: false; status: 404; error: string } | undefined {
  if (id) {
    return accounts.some((a) => a.id === id) ? { ok: true, id } : { ok: false, status: 404, error: `No open ${field} with that id.` };
  }
  if (name) {
    const found = accounts.find((a) => a.name.trim().toLowerCase() === name.toLowerCase());
    return found ? { ok: true, id: found.id } : { ok: false, status: 404, error: `No open ${field} named '${name}'.` };
  }
  return undefined;
}

/**
 * A transfer as the Add card's Transfer tab books it: one entry, its positive amount leaving
 * `accountId` for `transferAccountId`, filed under the transfer category. Rules are not applied,
 * since the person has already said what it is.
 */
async function createTransferFromApi(
  db: PrismaClient,
  user: { id: string; timezone: string | null },
  input: z.infer<typeof createSchema>,
  cents: number,
  source: CreateSource,
  idempotencyKeyId: string | undefined,
): Promise<CreateResult> {
  if (cents < 0) return { ok: false, status: 400, error: "A transfer's amount must be positive: it is what left the first account." };
  if (input.categoryId || input.category) return { ok: false, status: 400, error: "A transfer has no category to give." };
  if (input.transferAccountId && input.transferAccount) {
    return { ok: false, status: 400, error: "Give 'transferAccountId' or 'transferAccount', not both." };
  }
  const accounts = await db.account.findMany({ where: { userId: user.id, archived: false }, select: { id: true, name: true } });
  const from = findOpenAccount(accounts, input.accountId, input.account);
  const to = findOpenAccount(accounts, input.transferAccountId, input.transferAccount, "transfer account");
  if (!from || !to) return { ok: false, status: 400, error: "A transfer needs both accounts: where the money left and where it went." };
  if (!from.ok) return from;
  if (!to.ok) return to;
  if (from.id === to.id) return { ok: false, status: 400, error: "A transfer needs two different accounts." };

  const created = await db.$transaction(async (tx) => {
    const row = await tx.transaction.create({
      data: {
        userId: user.id,
        type: TransactionType.TRANSFER,
        amountCents: cents,
        accountId: from.id,
        transferAccountId: to.id,
        categoryId: await ensureFallbackCategoryFor(tx, user.id, CategoryKind.TRANSFER),
        date: dateFromYmd(input.date ?? currentYmdInTimeZone(user.timezone)),
        postedDate: input.postedDate ? dateFromYmd(input.postedDate) : null,
        title: input.title || null,
        note: input.note || null,
        needsReview: source === "api",
      },
      select: { id: true },
    });
    await addTagsToTransaction(tx, row.id, await resolveTagIds(tx, user.id, input.tags ?? []));
    if (idempotencyKeyId) await tx.apiIdempotencyKey.update({ where: { id: idempotencyKeyId }, data: { transactionId: row.id } });
    return tx.transaction.findUniqueOrThrow({ where: { id: row.id }, include: transactionInclude });
  });
  emitTransactionsCreated(user.id, [created.id], source === "api" ? "api" : "manual", { client: db });
  return { ok: true, transaction: serializeTransaction(created) };
}

/** One of the user's entries as the list shows it, with its receipts listed (not their bytes), or null. */
export async function getTransactionForApi(db: PrismaClient, userId: string, id: string) {
  const row = await db.transaction.findFirst({
    where: { id, userId },
    include: {
      ...transactionInclude,
      attachments: { select: { id: true, fileName: true, contentType: true, sizeBytes: true }, orderBy: { createdAt: "asc" } },
    },
  });
  return row ? { ...serializeTransaction(row), attachments: row.attachments } : null;
}

const updateSchema = z
  .object({
    title: z.string().trim().max(TRANSACTION_TITLE_MAX).nullable().optional(),
    note: z.string().trim().max(TRANSACTION_NOTE_MAX).nullable().optional(),
    date: z.string().regex(YMD, "'date' must be YYYY-MM-DD.").optional(),
    postedDate: z.string().regex(YMD, "'postedDate' must be YYYY-MM-DD.").nullable().optional(),
    amountCents: amountCents.optional(),
    categoryId: z.string().min(1).optional(),
    accountId: z.string().min(1).nullable().optional(),
    /** The entry's whole tag list: tags left out are taken off. */
    tags: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
    /** Only marks the entry looked at; any other change does that too. */
    reviewed: z.literal(true).optional(),
  })
  .strict();

export type UpdateResult =
  | { ok: true; transaction: ReturnType<typeof serializeTransaction> }
  | { ok: false; status: 400 | 404; error: string };

/**
 * Edits one entry from the phone: title, note, dates, amount, category, account and tags, or
 * just marks it reviewed. Saving any change counts as looking at the entry, as the website's
 * edit dialog does. What the phone does not edit is refused rather than half-applied, and
 * stays on the website: a split's lines, amounts owed back, credits, and the accounts and
 * amount of a transfer.
 */
export async function updateTransactionFromApi(
  db: PrismaClient,
  userId: string,
  id: string,
  body: unknown,
): Promise<UpdateResult> {
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const message = issue?.code === "unrecognized_keys" ? `Unknown field ${issue.keys.map((k) => `'${k}'`).join(", ")}.` : issue?.message;
    return { ok: false, status: 400, error: message ?? "Invalid body." };
  }
  const input = parsed.data;
  const existing = await db.transaction.findFirst({
    where: { id, userId },
    select: {
      id: true,
      type: true,
      accountId: true,
      categoryId: true,
      creditCents: true,
      _count: { select: { splitParts: true, owedShares: true } },
    },
  });
  if (!existing) return { ok: false, status: 404, error: "No transaction with that id." };

  const refuse = (error: string): UpdateResult => ({ ok: false, status: 400, error });
  const isTransfer = existing.type === TransactionType.TRANSFER;
  const isSplit = existing._count.splitParts > 0;
  const changesAccount = input.accountId !== undefined && input.accountId !== existing.accountId;
  const changesCategory = input.categoryId !== undefined && input.categoryId !== existing.categoryId;
  if (isTransfer && (input.amountCents !== undefined || changesAccount || changesCategory)) {
    return refuse("A transfer's amount and accounts are changed on the website.");
  }
  if (input.amountCents !== undefined && (isSplit || existing._count.owedShares > 0 || existing.creditCents)) {
    return refuse("This entry is split, has amounts owed back or credits; change its amount on the website.");
  }
  if (changesCategory && isSplit) return refuse("A split entry's categories are changed on the website.");
  if (existing.type === TransactionType.INCOME && input.amountCents !== undefined && input.amountCents < 0) {
    return refuse("Income must be positive.");
  }
  if (changesCategory) {
    const kind = existing.type === TransactionType.INCOME ? CategoryKind.INCOME : CategoryKind.EXPENSE;
    const ok = await db.category.count({ where: { id: input.categoryId, userId, kind } });
    if (!ok) return { ok: false, status: 404, error: `No ${kind.toLowerCase()} category with that id.` };
  }
  if (changesAccount && input.accountId) {
    const ok = await db.account.count({ where: { id: input.accountId, userId, archived: false } });
    if (!ok) return { ok: false, status: 404, error: "No open account with that id." };
  }

  const row = await db.$transaction(async (tx) => {
    await tx.transaction.update({
      where: { id: existing.id },
      data: {
        needsReview: false,
        ...(input.title !== undefined ? { title: input.title || null } : {}),
        ...(input.note !== undefined ? { note: input.note || null } : {}),
        ...(input.date !== undefined ? { date: dateFromYmd(input.date) } : {}),
        ...(input.postedDate !== undefined ? { postedDate: input.postedDate ? dateFromYmd(input.postedDate) : null } : {}),
        ...(input.amountCents !== undefined ? { amountCents: input.amountCents } : {}),
        ...(changesCategory ? { categoryId: input.categoryId } : {}),
        ...(changesAccount ? { accountId: input.accountId } : {}),
      },
    });
    if (input.tags) await replaceTransactionTags(tx, existing.id, await resolveTagIds(tx, userId, input.tags));
    return tx.transaction.findUniqueOrThrow({ where: { id: existing.id }, include: transactionInclude });
  });
  return { ok: true, transaction: serializeTransaction(row) };
}

/**
 * Deletes one entry, kept for the website's 15-minute Undo (`POST /api/v1/undo/:undoId`).
 * Null when the user has no such entry.
 */
export async function deleteTransactionFromApi(db: PrismaClient, userId: string, id: string) {
  const row = await db.transaction.findFirst({ where: { id, userId }, select: { type: true } });
  if (!row) return null;
  const undoId = await deleteTransactionWithUndo(db, userId, id, row.type);
  return undoId ? { undoId, type: row.type.toLowerCase() } : null;
}

/** Puts back an entry deleted in the last 15 minutes. */
export async function undoDeleteFromApi(db: PrismaClient, userId: string, undoId: string) {
  const result = await undoDeletedTransaction(db, userId, undoId);
  if (!result.ok) return { ok: false as const, error: UNDO_REFUSAL_MESSAGES[result.reason] };
  const transaction = await getTransactionForApi(db, userId, result.transactionId);
  return { ok: true as const, type: result.type, transaction };
}
