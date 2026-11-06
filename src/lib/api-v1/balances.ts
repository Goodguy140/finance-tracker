import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { BALANCE_SOURCE, upsertBalanceSnapshot } from "@/lib/account-balances";
import { dateFromYmd, ymdFromDateUtc } from "@/lib/date-only";
import { MAX_AMOUNT_CENTS } from "@/lib/money";

/**
 * Balances typed in by hand from the phone, as Settings → Accounts takes them on the website
 * (`setAccountBalanceAction`, `deleteAccountBalanceAction`): one reading a day, replacing any the
 * day already had, and only the person's own entries can be deleted, since a bank's balance comes
 * back on its next sync.
 */

type Db = PrismaClient | Prisma.TransactionClient;

/** How many of an account's hand-entered balances the phone lists, newest first. */
export const MANUAL_BALANCES_LISTED = 24;

const bodySchema = z.object({
  /** What the account holds, or for a card or loan what is owed, as a positive number. */
  balanceCents: z.number().int().min(-MAX_AMOUNT_CENTS).max(MAX_AMOUNT_CENTS),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type BalanceBody = z.infer<typeof bodySchema>;

/** `{ balanceCents, date }`, dated no later than the person's today. */
export function parseBalanceBody(body: unknown, todayYmd: string): { ok: true; value: BalanceBody } | { ok: false; error: string } {
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return { ok: false, error: "Send balanceCents (whole cents) and date (YYYY-MM-DD)." };
  const { date } = parsed.data;
  // Date.UTC rolls Feb 30 over into March, so a day that does not exist comes back different.
  if (ymdFromDateUtc(dateFromYmd(date)) !== date) return { ok: false, error: "That date does not exist." };
  if (date > todayYmd) return { ok: false, error: "A balance can't be dated after today." };
  return { ok: true, value: parsed.data };
}

export type RecordBalanceOutcome = "recorded" | "not_found" | "archived";

/** Stores the balance as the person's own reading for that day. */
export async function recordManualBalance(
  db: Db,
  userId: string,
  accountId: string,
  value: BalanceBody,
): Promise<RecordBalanceOutcome> {
  const account = await db.account.findFirst({ where: { id: accountId, userId }, select: { archived: true } });
  if (!account) return "not_found";
  if (account.archived) return "archived";
  await upsertBalanceSnapshot(db, {
    userId,
    accountId,
    date: dateFromYmd(value.date),
    balanceCents: value.balanceCents,
    source: BALANCE_SOURCE.manual,
  });
  return "recorded";
}

/** Deletes one of the person's own readings on the account; false when there is no such entry. */
export async function deleteManualBalance(db: Db, userId: string, accountId: string, balanceId: string): Promise<boolean> {
  const { count } = await db.accountBalanceSnapshot.deleteMany({
    where: { id: balanceId, userId, accountId, source: BALANCE_SOURCE.manual },
  });
  return count > 0;
}

/** The account's hand-entered balances, newest first, as the website's account drawer lists them. */
export async function loadManualBalances(db: Db, userId: string, accountId: string) {
  const rows = await db.accountBalanceSnapshot.findMany({
    where: { userId, accountId, source: BALANCE_SOURCE.manual },
    orderBy: { date: "desc" },
    take: MANUAL_BALANCES_LISTED,
    select: { id: true, date: true, balanceCents: true },
  });
  return rows.map((row) => ({ id: row.id, date: ymdFromDateUtc(row.date), cents: row.balanceCents }));
}
