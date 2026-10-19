import { TransactionType } from "@prisma/client";
import { getCountryConfig } from "@/lib/country-config";
import { ymdFromDateUtc } from "@/lib/date-only";
import { isLiabilityType } from "@/lib/net-worth";
import { currentYmdInTimeZone } from "@/lib/period-month";
import { prisma } from "@/lib/prisma";
import { computeGoalProgress, type GoalProgress, type GoalReading } from "@/lib/savings-goals";
import { savingsCentsFor } from "@/lib/savings-transfers";

/** How far back transfers are read for the transfer pace: enough to tell a new habit from an old one. */
const TRANSFER_HISTORY_DAYS = 400;

export type SavingsGoalView = {
  id: string;
  name: string;
  targetCents: number;
  targetYmd: string | null;
  /** The hand-recorded amount; only meaningful when `account` is null. */
  manualSavedCents: number;
  account: { id: string; name: string; archived: boolean } | null;
  currency: string;
  progress: GoalProgress;
};

/** An account a goal can follow: anything that holds money, not a card or a loan. */
export type GoalAccountOption = { id: string; name: string; type: string };

export async function loadSavingsGoals(user: {
  id: string;
  timezone: string | null;
  countryCode: string | null;
}): Promise<{ goals: SavingsGoalView[]; accounts: GoalAccountOption[]; todayYmd: string }> {
  const todayYmd = currentYmdInTimeZone(user.timezone);
  const currency = getCountryConfig(user.countryCode).defaultCurrency;
  const [goals, accounts] = await Promise.all([
    prisma.savingsGoal.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
      include: { account: { select: { id: true, name: true, archived: true, currency: true } } },
    }),
    prisma.account.findMany({
      where: { userId: user.id, archived: false },
      orderBy: { name: "asc" },
      select: { id: true, name: true, type: true },
    }),
  ]);

  const linkedIds = [...new Set(goals.flatMap((g) => (g.accountId ? [g.accountId] : [])))];
  const transferSince = new Date(Date.now() - TRANSFER_HISTORY_DAYS * 24 * 60 * 60 * 1000);
  const [balances, portfolio, transfers] = linkedIds.length
    ? await Promise.all([
        prisma.accountBalanceSnapshot.findMany({
          where: { userId: user.id, accountId: { in: linkedIds } },
          select: { accountId: true, date: true, balanceCents: true },
        }),
        prisma.portfolioSnapshot.findMany({
          where: { userId: user.id, accountId: { in: linkedIds } },
          select: { accountId: true, date: true, totalValueCents: true },
        }),
        prisma.transaction.findMany({
          where: {
            userId: user.id,
            type: TransactionType.TRANSFER,
            date: { gte: transferSince },
            OR: [{ accountId: { in: linkedIds } }, { transferAccountId: { in: linkedIds } }],
          },
          select: {
            date: true,
            amountCents: true,
            accountId: true,
            transferAccountId: true,
            transferPeerId: true,
            transferPeerOf: { select: { id: true } },
            account: { select: { currency: true } },
          },
        }),
      ])
    : [[], [], []];
  const readings = new Map<string, GoalReading[]>();
  const add = (accountId: string, reading: GoalReading) => readings.set(accountId, [...(readings.get(accountId) ?? []), reading]);
  // Same precedence as net worth: on a day with both, the balance wins over a portfolio value.
  const balanceDays = new Set(balances.map((b) => `${b.accountId}:${b.date.getTime()}`));
  for (const b of balances) add(b.accountId, { date: b.date, cents: b.balanceCents });
  for (const p of portfolio) {
    if (!balanceDays.has(`${p.accountId}:${p.date.getTime()}`)) add(p.accountId, { date: p.date, cents: p.totalValueCents });
  }

  // What each linked account received by transfer, counted as savings totals count it: each
  // movement once, whichever legs are in the log.
  const accountCurrency = new Map(goals.flatMap((g) => (g.account ? [[g.account.id, g.account.currency] as const] : [])));
  const transfersIn = new Map<string, GoalReading[]>();
  for (const accountId of linkedIds) {
    const only = new Set([accountId]);
    const rows: GoalReading[] = [];
    for (const t of transfers) {
      // A leg booked in another currency is not this account's amount.
      if (t.account && t.account.currency !== accountCurrency.get(accountId)) continue;
      const cents = savingsCentsFor(
        { ...t, paired: t.transferPeerId !== null || t.transferPeerOf !== null },
        only,
      );
      if (cents !== 0) rows.push({ date: t.date, cents });
    }
    transfersIn.set(accountId, rows);
  }

  return {
    todayYmd,
    accounts: accounts.filter((a) => !isLiabilityType(a.type)).map((a) => ({ id: a.id, name: a.name, type: String(a.type) })),
    // Soonest date first; goals with no date after them, oldest first.
    goals: [...goals]
      .sort((a, b) => (a.targetDate?.getTime() ?? Infinity) - (b.targetDate?.getTime() ?? Infinity))
      .map((goal) => ({
      id: goal.id,
      name: goal.name,
      targetCents: goal.targetCents,
      targetYmd: goal.targetDate ? ymdFromDateUtc(goal.targetDate) : null,
      manualSavedCents: goal.savedCents,
      account: goal.account ? { id: goal.account.id, name: goal.account.name, archived: goal.account.archived } : null,
      currency: goal.account?.currency ?? currency,
      progress: computeGoalProgress(
        goal,
        goal.accountId ? (readings.get(goal.accountId) ?? []) : [],
        todayYmd,
        goal.accountId ? (transfersIn.get(goal.accountId) ?? []) : [],
      ),
    })),
  };
}
