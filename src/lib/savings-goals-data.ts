import { getCountryConfig } from "@/lib/country-config";
import { ymdFromDateUtc } from "@/lib/date-only";
import { isLiabilityType } from "@/lib/net-worth";
import { currentYmdInTimeZone } from "@/lib/period-month";
import { prisma } from "@/lib/prisma";
import { computeGoalProgress, type GoalProgress, type GoalReading } from "@/lib/savings-goals";

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
  const [balances, portfolio] = linkedIds.length
    ? await Promise.all([
        prisma.accountBalanceSnapshot.findMany({
          where: { userId: user.id, accountId: { in: linkedIds } },
          select: { accountId: true, date: true, balanceCents: true },
        }),
        prisma.portfolioSnapshot.findMany({
          where: { userId: user.id, accountId: { in: linkedIds } },
          select: { accountId: true, date: true, totalValueCents: true },
        }),
      ])
    : [[], []];
  const readings = new Map<string, GoalReading[]>();
  const add = (accountId: string, reading: GoalReading) => readings.set(accountId, [...(readings.get(accountId) ?? []), reading]);
  // Same precedence as net worth: on a day with both, the balance wins over a portfolio value.
  const balanceDays = new Set(balances.map((b) => `${b.accountId}:${b.date.getTime()}`));
  for (const b of balances) add(b.accountId, { date: b.date, cents: b.balanceCents });
  for (const p of portfolio) {
    if (!balanceDays.has(`${p.accountId}:${p.date.getTime()}`)) add(p.accountId, { date: p.date, cents: p.totalValueCents });
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
      progress: computeGoalProgress(goal, goal.accountId ? (readings.get(goal.accountId) ?? []) : [], todayYmd),
    })),
  };
}
