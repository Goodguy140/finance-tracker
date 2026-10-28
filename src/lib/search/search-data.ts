import type { Prisma, PrismaClient, RecurringCadence, TransactionRuleTextOperator } from "@prisma/client";
import { TransactionType } from "@prisma/client";
import { homeCurrencyOf, inCurrencyWhere } from "@/lib/home-currency";
import {
  MIN_SEARCH_QUERY_LENGTH,
  parseAmountQuery,
  searchPageHref,
  transactionHref,
  type TransactionSearchFilter,
} from "@/lib/search/search-paths";
import { quoteRuleTitlePatterns } from "@/lib/transaction-rules";

/**
 * What the master search finds in a user's own data. Settings pages and actions are matched
 * in the browser (`commands.ts`); everything here needs the database.
 *
 * Transactions are searched across every month, not the period on screen: that is the point
 * of searching from anywhere. Matching is SQLite `LIKE`, which ignores case for ASCII.
 */

export type SearchHitKind =
  | "transaction"
  | "transfer"
  | "account"
  | "category"
  | "tag"
  | "rule"
  | "recurring"
  | "goal"
  | "saved";

export type SearchHit = {
  kind: SearchHitKind;
  id: string;
  title: string;
  /** One quiet line under the title: date, category, account. */
  detail: string;
  href: string;
  /** Transactions and recurring rules: the signed amount as stored, in its own currency. */
  amountCents?: number;
  currency?: string;
  /** Transactions: EXPENSE, INCOME or TRANSFER, for the sign shown beside the amount. */
  type?: TransactionType;
};

export type SearchHitGroup = { kind: SearchHitKind; label: string; hits: SearchHit[] };

export type SearchResults = {
  groups: SearchHitGroup[];
  /** Every transaction (and transfer) matching, of which `groups` shows the newest few. */
  transactionTotal: number;
};

const GROUP_LABELS: Record<SearchHitKind, string> = {
  transaction: "Transactions",
  transfer: "Transfers",
  account: "Accounts",
  category: "Categories",
  tag: "Tags",
  rule: "Rules",
  recurring: "Recurring",
  goal: "Savings goals",
  saved: "Saved searches",
};

const CADENCE_LABELS: Record<RecurringCadence, string> = {
  WEEKLY: "Weekly",
  BIWEEKLY: "Every 2 weeks",
  SEMI_MONTHLY: "Twice a month",
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  YEARLY: "Yearly",
  BIENNIAL: "Every 2 years",
};

const RULE_OPERATOR_LABELS: Record<TransactionRuleTextOperator, string> = {
  CONTAINS: "contains",
  EQUALS: "is",
  STARTS_WITH: "starts with",
};

/** Per group, in the palette. The full transaction list is on `/search`. */
const PALETTE_LIMIT = 6;

/** The `where` behind both the palette's transaction groups and the `/search` page. */
export function transactionSearchWhere(userId: string, filter: TransactionSearchFilter): Prisma.TransactionWhereInput {
  const and: Prisma.TransactionWhereInput[] = [{ userId }];
  const q = filter.query?.trim();
  if (q) {
    const or: Prisma.TransactionWhereInput[] = [
      { title: { contains: q } },
      { note: { contains: q } },
      { accountDescription: { contains: q } },
    ];
    const cents = parseAmountQuery(q);
    // Stored signed: a refund is a negative expense, money arriving by transfer is negative.
    if (cents !== null) or.push({ amountCents: { in: [cents, -cents] } });
    and.push({ OR: or });
  }
  if (filter.categoryId) and.push({ categoryId: filter.categoryId });
  if (filter.accountId) {
    // A transfer belongs to both accounts it moved money between.
    and.push({ OR: [{ accountId: filter.accountId }, { transferAccountId: filter.accountId }] });
  }
  if (filter.tagId) and.push({ tags: { some: { tagId: filter.tagId } } });
  if (filter.type) and.push({ type: filter.type });
  return { AND: and };
}

export type TransactionSearchTotals = { count: number; spentCents: number; receivedCents: number };

/**
 * How many transactions a search finds and what they add up to: spending and income in the home
 * currency, as every total is (there is no conversion), transfers counted but not summed.
 */
export async function transactionSearchTotals(
  db: PrismaClient,
  userId: string,
  filter: TransactionSearchFilter,
  homeCurrency: string,
): Promise<TransactionSearchTotals> {
  const where = transactionSearchWhere(userId, filter);
  const [count, sums] = await Promise.all([
    db.transaction.count({ where }),
    db.transaction.groupBy({
      by: ["type"],
      where: { AND: [where, inCurrencyWhere(homeCurrency), { type: { not: TransactionType.TRANSFER } }] },
      _sum: { amountCents: true },
    }),
  ]);
  return {
    count,
    spentCents: sums.find((t) => t.type === TransactionType.EXPENSE)?._sum.amountCents ?? 0,
    receivedCents: sums.find((t) => t.type === TransactionType.INCOME)?._sum.amountCents ?? 0,
  };
}

export const TRANSACTION_SEARCH_INCLUDE = {
  category: { select: { name: true } },
  account: { select: { name: true, currency: true } },
  transferAccount: { select: { name: true } },
} satisfies Prisma.TransactionInclude;

type TransactionRow = Prisma.TransactionGetPayload<{ include: typeof TRANSACTION_SEARCH_INCLUDE }>;

export function transactionHit(row: TransactionRow, homeCurrency: string, dateLabel: (d: Date) => string): SearchHit {
  const transfer = row.type === TransactionType.TRANSFER;
  const accountName = row.account?.name ?? null;
  let where: string | null = accountName;
  if (transfer) {
    // Positive left `accountId`, negative arrived in it.
    const other = row.transferAccount?.name ?? "another account";
    const from = row.amountCents < 0 ? other : (accountName ?? "an account");
    const to = row.amountCents < 0 ? (accountName ?? "an account") : other;
    where = `${from} → ${to}`;
  }
  const fallbackTitle = transfer ? "Transfer" : row.type === TransactionType.INCOME ? "Income" : row.category.name;
  return {
    kind: transfer ? "transfer" : "transaction",
    id: row.id,
    title: row.title?.trim() || fallbackTitle,
    detail: [dateLabel(row.date), transfer ? null : row.category.name, where].filter(Boolean).join(" · "),
    href: transactionHref(row.id, row.date),
    amountCents: row.amountCents,
    currency: row.account?.currency ?? homeCurrency,
    type: row.type,
  };
}

export function shortDateUtc(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" });
}

/**
 * Everything of the user's that matches `rawQuery`, grouped for the palette. Empty under
 * {@link MIN_SEARCH_QUERY_LENGTH} characters.
 */
export async function searchUserData(
  db: PrismaClient,
  user: { id: string; countryCode: string },
  rawQuery: string,
): Promise<SearchResults> {
  const q = rawQuery.trim();
  if (q.length < MIN_SEARCH_QUERY_LENGTH) return { groups: [], transactionTotal: 0 };
  const userId = user.id;
  const homeCurrency = homeCurrencyOf(user.countryCode);
  const txnWhere = transactionSearchWhere(userId, { query: q });
  const nameMatch = { contains: q };

  const [spending, transfers, transactionTotal, accounts, categories, tags, rules, recurring, goals] = await Promise.all([
    db.transaction.findMany({
      where: { AND: [txnWhere, { type: { not: TransactionType.TRANSFER } }] },
      include: TRANSACTION_SEARCH_INCLUDE,
      orderBy: [{ date: "desc" }, { id: "asc" }],
      take: PALETTE_LIMIT,
    }),
    db.transaction.findMany({
      where: { AND: [txnWhere, { type: TransactionType.TRANSFER }] },
      include: TRANSACTION_SEARCH_INCLUDE,
      orderBy: [{ date: "desc" }, { id: "asc" }],
      take: PALETTE_LIMIT,
    }),
    db.transaction.count({ where: txnWhere }),
    db.account.findMany({
      where: { userId, name: nameMatch },
      orderBy: [{ archived: "asc" }, { name: "asc" }],
      take: PALETTE_LIMIT,
    }),
    db.category.findMany({ where: { userId, name: nameMatch }, orderBy: { name: "asc" }, take: PALETTE_LIMIT }),
    db.tag.findMany({ where: { userId, name: nameMatch }, orderBy: { name: "asc" }, take: PALETTE_LIMIT }),
    db.transactionRule.findMany({
      where: { userId, OR: [{ titlePattern: nameMatch }, { setTitle: nameMatch }] },
      include: { setCategory: { select: { name: true } } },
      orderBy: { priority: "asc" },
      take: PALETTE_LIMIT,
    }),
    db.recurringTransaction.findMany({
      where: { userId, name: nameMatch },
      include: { account: { select: { name: true, currency: true } } },
      orderBy: [{ enabled: "desc" }, { nextExpectedDate: "asc" }],
      take: PALETTE_LIMIT,
    }),
    db.savingsGoal.findMany({ where: { userId, name: nameMatch }, orderBy: { name: "asc" }, take: PALETTE_LIMIT }),
  ]);

  const groups: SearchHitGroup[] = [];
  const push = (kind: SearchHitKind, hits: SearchHit[]) => {
    if (hits.length > 0) groups.push({ kind, label: GROUP_LABELS[kind], hits });
  };

  push("transaction", spending.map((row) => transactionHit(row, homeCurrency, shortDateUtc)));
  push("transfer", transfers.map((row) => transactionHit(row, homeCurrency, shortDateUtc)));
  push(
    "account",
    accounts.map((a) => ({
      kind: "account",
      id: a.id,
      title: a.name,
      detail: [a.archived ? "Archived" : null, a.currency, "Balance and register"].filter(Boolean).join(" · "),
      href: `/accounts/${a.id}`,
    })),
  );
  push(
    "category",
    categories.map((c) => ({
      kind: "category",
      id: c.id,
      title: c.name,
      detail: `${c.kind === "INCOME" ? "Income" : "Expense"} category · All its transactions`,
      href: searchPageHref({ categoryId: c.id }),
    })),
  );
  push(
    "tag",
    tags.map((t) => ({
      kind: "tag",
      id: t.id,
      title: `#${t.name}`,
      detail: "Tag · All its transactions",
      href: searchPageHref({ tagId: t.id }),
    })),
  );
  push(
    "rule",
    rules.map((r) => ({
      kind: "rule",
      id: r.id,
      title: `Title ${RULE_OPERATOR_LABELS[r.titleOperator]} ${quoteRuleTitlePatterns(r.titlePattern)}`,
      detail: [r.enabled ? "Rule" : "Rule, off", r.setCategory ? `sets ${r.setCategory.name}` : null, r.setTitle ? `renames to ${r.setTitle}` : null]
        .filter(Boolean)
        .join(" · "),
      href: "/settings/rules",
    })),
  );
  push(
    "recurring",
    recurring.map((r) => ({
      kind: "recurring",
      id: r.id,
      title: r.name,
      detail: [
        r.enabled ? `Next ${shortDateUtc(r.nextExpectedDate)}` : "Paused",
        CADENCE_LABELS[r.cadence],
        r.account.name,
      ].join(" · "),
      // The Recurring card lists the rules due in the month on screen, so open that month.
      href: transactionHref(r.id, r.nextExpectedDate),
      amountCents: r.amountCents,
      currency: r.account.currency,
      type: r.type,
    })),
  );
  push(
    "goal",
    goals.map((g) => ({
      kind: "goal",
      id: g.id,
      title: g.name,
      detail: g.targetDate ? `Savings goal · by ${shortDateUtc(g.targetDate)}` : "Savings goal",
      href: "/settings/goals",
      amountCents: g.targetCents,
      currency: homeCurrency,
    })),
  );

  return { groups, transactionTotal };
}
