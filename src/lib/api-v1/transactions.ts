import { emitWebhookEvent } from "@/lib/webhooks";
import { CategoryKind, Prisma, TransactionType, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { dateFromYmd, ymdFromDateUtc } from "@/lib/date-only";
import { ensureFallbackCategoryFor } from "@/lib/fallback-categories";
import { MAX_AMOUNT_CENTS } from "@/lib/money";
import { currentYmdInTimeZone } from "@/lib/period-month";
import { addTagsToTransaction, resolveTagIds } from "@/lib/tags-server";
import { appendRuleNote, resolveRuleOutcome, ruleSplitLines } from "@/lib/transaction-rules";
import { saveSplitLines } from "@/lib/split-lines";
import { loadRuleContext } from "@/lib/transaction-rules-server";

/**
 * The personal API's transactions: `GET /api/v1/transactions` lists them and
 * `POST /api/v1/transactions` logs an expense or income entry (a phone shortcut, a script).
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
    note: tx.note,
    tags: tx.tags.map((t) => t.tag.name),
    splits: tx.splitParts.map((p) => ({ categoryId: p.categoryId, amountCents: p.amountCents })),
    owedToYouCents: tx.owedShares.reduce((sum, s) => sum + s.amountCents, 0),
    verified: tx.verification !== null,
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
    type: z.enum(["expense", "income"]),
    amountCents: amountCents.optional(),
    /** Dollars, as a convenience for shortcuts: 12.5 or "12.50". */
    amount: z.union([z.number(), z.string().trim().regex(/^-?\d+(\.\d{1,2})?$/, "'amount' must be a number like 12.50.")]).optional(),
    date: z.string().regex(YMD, "'date' must be YYYY-MM-DD.").optional(),
    postedDate: z.string().regex(YMD, "'postedDate' must be YYYY-MM-DD.").optional(),
    title: z.string().trim().max(200).optional(),
    note: z.string().trim().max(2000).optional(),
    categoryId: z.string().min(1).optional(),
    category: z.string().trim().min(1).max(100).optional(),
    accountId: z.string().min(1).optional(),
    account: z.string().trim().min(1).max(100).optional(),
    tags: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
  })
  .strict();

export type CreateResult =
  | { ok: true; transaction: ReturnType<typeof serializeTransaction> }
  | { ok: false; status: 400 | 404; error: string };

/**
 * Logs one expense or income entry. Category and account can be given by id or by name;
 * whatever is left out is filled the way the Add card fills it, from the user's rules and
 * the categories their past titles went to, and otherwise the default account and the
 * catch-all category.
 */
export async function createTransactionFromApi(
  db: PrismaClient,
  user: { id: string; timezone: string | null },
  body: unknown,
  /** "search": typed into the master search by the user, so nothing is left to review. */
  source: "api" | "search" = "api",
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
  const type = input.type === "income" ? TransactionType.INCOME : TransactionType.EXPENSE;
  if (type === TransactionType.INCOME && cents < 0) {
    return { ok: false, status: 400, error: "Income must be positive." };
  }
  if (input.categoryId && input.category) return { ok: false, status: 400, error: "Give 'categoryId' or 'category', not both." };
  if (input.accountId && input.account) return { ok: false, status: 400, error: "Give 'accountId' or 'account', not both." };

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
  let accountId: string | undefined;
  if (input.accountId) {
    if (!accounts.some((a) => a.id === input.accountId)) return { ok: false, status: 404, error: "No open account with that id." };
    accountId = input.accountId;
  } else if (input.account) {
    accountId = accounts.find((a) => a.name.trim().toLowerCase() === input.account!.toLowerCase())?.id;
    if (!accountId) return { ok: false, status: 404, error: `No open account named '${input.account}'.` };
  }

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

  const created = await db.$transaction(async (tx) => {
    // A rule's split is its way of setting the category, so a category the request names wins.
    const splitLines = categoryId ? null : ruleSplitLines(rule.split, cents);
    const resolvedCategoryId =
      splitLines?.[0].categoryId ?? categoryId ?? rule.categoryId ?? (await ensureFallbackCategoryFor(tx, user.id, kind));
    const row = await tx.transaction.create({
      data: {
        userId: user.id,
        type,
        amountCents: cents,
        categoryId: resolvedCategoryId,
        accountId: accountId ?? null,
        date: dateFromYmd(input.date ?? currentYmdInTimeZone(user.timezone)),
        postedDate: input.postedDate ? dateFromYmd(input.postedDate) : null,
        title: rule.title ?? input.title ?? null,
        note: appendRuleNote(input.note ?? null, rule.appendNote) ?? null,
        // Posted by a script, not typed in the app.
        needsReview: source === "api",
      },
      select: { id: true },
    });
    if (splitLines) await saveSplitLines(tx, { userId: user.id, transactionId: row.id, lines: splitLines });
    const tagIds = [...new Set([...(await resolveTagIds(tx, user.id, input.tags ?? [])), ...rule.tagIds])];
    await addTagsToTransaction(tx, row.id, tagIds);
    return tx.transaction.findUniqueOrThrow({ where: { id: row.id }, include: transactionInclude });
  });
  emitWebhookEvent(user.id, "transaction.created", {
    id: created.id,
    type: created.type,
    amountCents: created.amountCents,
    date: created.date.toISOString().slice(0, 10),
    title: created.title,
    source: source === "api" ? "api" : "manual",
  });
  return { ok: true, transaction: serializeTransaction(created) };
}
