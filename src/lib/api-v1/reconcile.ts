import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { ymdFromDateUtc } from "@/lib/date-only";
import { MAX_AMOUNT_CENTS } from "@/lib/money";
import { currentYmdInTimeZone } from "@/lib/period-month";
import {
  deleteReconciliation,
  lastDayOfMonth,
  loadReconcileInputs,
  nextStatement,
  reconcile,
  ReconciliationError,
  saveReconciliation,
} from "@/lib/reconciliation";

/**
 * Settings → Accounts → Reconcile for the phone, from the website's own `reconciliation.ts`:
 * `GET /api/v1/accounts/:id/reconcile` checks a statement's dates and balances against the log,
 * `POST` marks one that matches as reconciled, and `DELETE …/reconcile/:id` forgets one.
 */

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const CENTS = /^-?\d{1,12}$/;

type User = { id: string; timezone: string };

export type ReconcileResult<T> = ({ ok: true } & T) | { ok: false; status: 400 | 404; error: string };

function refused(err: unknown): { ok: false; status: 400 | 404; error: string } {
  if (err instanceof ReconciliationError) return { ok: false, status: err.notFound ? 404 : 400, error: err.message };
  throw err;
}

function cents(value: string | null): number | null {
  return value && CENTS.test(value) ? Number(value) : null;
}

/**
 * The statement to check: `from` and `to` as given, or where the last reconciled one left off
 * (last month when there is none); `openingCents` likewise from the last closing balance. With a
 * `closingCents` too, the log is run from the opening balance across those days.
 */
export async function loadAppReconcile(db: PrismaClient, user: User, accountId: string, params: URLSearchParams) {
  const account = await db.account.findFirst({
    where: { id: accountId, userId: user.id },
    select: { id: true, name: true, type: true, currency: true },
  });
  if (!account) return { ok: false as const, status: 404 as const, error: "Account not found." };
  const history = await db.accountReconciliation.findMany({ where: { userId: user.id, accountId }, orderBy: { endDate: "desc" } });
  const next = nextStatement(history[0], currentYmdInTimeZone(user.timezone));
  const fromParam = params.get("from") ?? "";
  const toParam = params.get("to") ?? "";
  const from = YMD.test(fromParam) ? fromParam : next.from;
  const to = YMD.test(toParam) ? toParam : lastDayOfMonth(from.slice(0, 7));
  if (from > to) return { ok: false as const, status: 400 as const, error: "The statement has to end after it starts." };
  const openingCents = params.has("openingCents") ? cents(params.get("openingCents")) : next.openingCents;
  const closingCents = cents(params.get("closingCents"));

  const inputs = await loadReconcileInputs(db, user.id, account, from, to);
  const result =
    openingCents !== null && closingCents !== null
      ? reconcile({ accountId, liability: inputs.liability, openingCents, closingCents, transactions: inputs.transactions })
      : null;
  return {
    ok: true as const,
    account: { id: account.id, name: account.name, currency: account.currency, liability: inputs.liability },
    from,
    to,
    openingCents,
    closingCents,
    /** Null until both balances are given. */
    check: result
      ? {
          moneyInCents: result.moneyInCents,
          moneyOutCents: result.moneyOutCents,
          /** Where the log's entries take the opening balance (what is owed, for a card or loan). */
          expectedClosingCents: result.expectedClosingCents,
          /** Statement closing less what the log arrives at: zero when they agree. */
          differenceCents: result.differenceCents,
          /** Whether the statement shows more or less money in the account than the log; null when they agree. */
          statementShows: result.differenceCents === 0 ? null : (result.differenceCents > 0) !== inputs.liability ? ("more" as const) : ("less" as const),
          /** Bank rows for this account and these days still waiting in the review queue. */
          waitingInQueue: inputs.waitingInQueue,
          /** Oldest first, each with the running balance. `inCents` is from the account's side. */
          rows: result.rows.map((r) => ({ id: r.id, date: ymdFromDateUtc(r.date), title: r.title, inCents: r.inCents, balanceCents: r.balanceCents })),
        }
      : null,
    /** Reconciled statements, newest first. */
    history: history.map((r) => ({
      id: r.id,
      from: ymdFromDateUtc(r.startDate),
      to: ymdFromDateUtc(r.endDate),
      openingCents: r.openingCents,
      closingCents: r.closingCents,
    })),
  };
}

const balance = z.number().int().min(-MAX_AMOUNT_CENTS).max(MAX_AMOUNT_CENTS);
const saveSchema = z
  .object({
    from: z.string().regex(YMD, "Choose the statement's dates."),
    to: z.string().regex(YMD, "Choose the statement's dates."),
    openingCents: balance,
    closingCents: balance,
  })
  .strict();

export async function saveReconciliationFromApi(db: PrismaClient, userId: string, accountId: string, body: unknown): Promise<ReconcileResult<{ id: string }>> {
  const parsed = saveSchema.safeParse(body);
  if (!parsed.success) return { ok: false, status: 400, error: parsed.error.issues[0]?.message ?? "Enter both balances from the statement." };
  try {
    const { from, to, openingCents, closingCents } = parsed.data;
    return { ok: true, id: await saveReconciliation(db, userId, { accountId, startYmd: from, endYmd: to, openingCents, closingCents }) };
  } catch (err) {
    return refused(err);
  }
}

export async function deleteReconciliationFromApi(db: PrismaClient, userId: string, accountId: string, reconciliationId: string): Promise<ReconcileResult<object>> {
  try {
    const owned = await db.accountReconciliation.findFirst({ where: { id: reconciliationId, userId, accountId }, select: { id: true } });
    if (!owned) throw new ReconciliationError("Reconciliation not found.", true);
    await deleteReconciliation(db, userId, reconciliationId);
    return { ok: true };
  } catch (err) {
    return refused(err);
  }
}
