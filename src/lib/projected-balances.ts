import { BILLS_FORECAST_DAY_OPTIONS, forecastRecurringOccurrences } from "./bills-forecast";
import type { RecurringForecastRule } from "./recurring-transactions";
import type { AccountBalanceRow } from "./net-worth";
import { dateFromYmd, ymdFromDateUtc } from "./date-only";

/**
 * Projected balances: where each account, and net worth, stands 30, 60 and 90 days out if the
 * recurring bills and income, and the one-off plans, come in as scheduled.
 *
 * It starts from each account's latest balance (the net-worth reading) and applies the same
 * occurrences the Upcoming bills card lists, each to the account its rule books to. Only
 * occurrences dated after the account's balance was read are applied: anything on or before
 * that day is taken to be in the balance already. The bills forecast starts at the beginning
 * of the current month, so a balance read before then picks up nothing from the gap.
 *
 * On an asset account income adds and a bill subtracts; on a card or loan, whose reading is
 * what is owed, a bill adds to the debt and income (a payment) reduces it. Accounts with no
 * balance, or in another currency than the total's, are left out, and so are their rules.
 *
 * Transfer rules are left out unless `includeTransfers` is set (the user's choice, off by
 * default, as the bills forecast leaves them out). Then each occurrence leaves the rule's
 * account and arrives in its `transferAccountId`, each side treated as a bill and a payment
 * would be: a card payment from chequing lowers both the chequing balance and what is owed.
 * Net worth is unchanged by it. A transfer is applied only when both sides are projected;
 * moving money into or out of an account with no counted balance would change the total.
 */

export const PROJECTION_DAYS = BILLS_FORECAST_DAY_OPTIONS;

export type ProjectableRule = Pick<
  RecurringForecastRule,
  "type" | "amountCents" | "cadence" | "nextExpectedDate" | "anchorDay" | "endDate" | "enabled"
> & {
  accountId: string;
  name?: string;
  transferAccountId?: string | null;
  id?: string;
  /** A one-off plan, given the shape of a rule with one occurrence (`plannedAsForecastRules`). */
  planned?: true;
};

export type ProjectedAccount = {
  accountId: string;
  name: string;
  liability: boolean;
  /** Latest reading, as the net-worth section shows it. */
  currentCents: number;
  asOf: Date;
  /** One per entry of the horizons (`PROJECTION_DAYS` unless `days` is given), in that order. */
  projectedCents: number[];
  /**
   * Set on an asset account whose balance goes below zero within the longest horizon: the first
   * day it does, the rule whose occurrence takes it there, and the lowest it gets.
   */
  belowZero: { date: Date; cause: string | null; lowestCents: number } | null;
};

export type ProjectedBalances = {
  /** Net worth today, then one entry per `PROJECTION_DAYS`. */
  netCents: number[];
  accounts: ProjectedAccount[];
  /** Enabled bill and income rules left out because their account has no counted balance. */
  rulesLeftOut: number;
  /** Whether transfer rules were applied, as asked. */
  includesTransfers: boolean;
  /**
   * With transfers included, the enabled transfer rules left out: one side has no counted
   * balance, or the rule names no account to transfer to.
   */
  transfersLeftOut: number;
};

export function projectBalances(input: {
  accounts: readonly AccountBalanceRow[];
  rules: readonly ProjectableRule[];
  todayYmd: string;
  currentYm: string;
  includeTransfers?: boolean;
  /** Horizons in days; the Reports section's 30/60/90 by default, longer for what-if scenarios. */
  days?: readonly number[];
}): ProjectedBalances {
  const includeTransfers = input.includeTransfers ?? false;
  const horizonDays = input.days ?? PROJECTION_DAYS;
  const horizons = horizonDays.map((days) => {
    const end = dateFromYmd(input.todayYmd);
    end.setUTCDate(end.getUTCDate() + days);
    return ymdFromDateUtc(end);
  });
  const projected = input.accounts.filter((a) => a.counted && a.latest);
  const byId = new Map(projected.map((a) => [a.accountId, a]));

  const transferApplies = (r: ProjectableRule) =>
    byId.has(r.accountId) && !!r.transferAccountId && r.transferAccountId !== r.accountId && byId.has(r.transferAccountId);

  const forecast = forecastRecurringOccurrences(
    input.rules.filter((r) => (r.type === "TRANSFER" ? transferApplies(r) : byId.has(r.accountId))),
    { todayYmd: input.todayYmd, currentYm: input.currentYm, days: Math.max(...horizonDays), includeTransfers },
  );
  const rulesLeftOut = input.rules.filter(
    (r) => r.enabled && !r.planned && (r.type === "EXPENSE" || r.type === "INCOME") && !byId.has(r.accountId),
  ).length;
  const transfersLeftOut = includeTransfers
    ? input.rules.filter((r) => r.enabled && r.type === "TRANSFER" && !transferApplies(r)).length
    : 0;

  const accounts: ProjectedAccount[] = projected.map((a) => {
    const latest = a.latest!;
    const asOfYmd = ymdFromDateUtc(latest.date);
    let running = latest.cents;
    let belowZero: ProjectedAccount["belowZero"] = null;
    const projectedCents = horizons.map(() => latest.cents);
    for (const { rule, date } of forecast.occurrences) {
      // A transfer arrives in its other account; everything else books to the rule's own.
      const arriving = rule.type === "TRANSFER" && rule.transferAccountId === a.accountId;
      if (rule.accountId !== a.accountId && !arriving) continue;
      const ymd = ymdFromDateUtc(date);
      if (ymd <= asOfYmd) continue;
      const inflow = rule.type === "INCOME" || arriving;
      // A card or loan reading is what is owed: a bill raises it, a payment lowers it.
      running += (inflow !== a.liability ? 1 : -1) * rule.amountCents;
      horizons.forEach((end, i) => {
        if (ymd <= end) projectedCents[i] = running;
      });
      if (!a.liability && running < 0) {
        belowZero = belowZero
          ? { date: belowZero.date, cause: belowZero.cause, lowestCents: Math.min(belowZero.lowestCents, running) }
          : { date, cause: rule.name ?? null, lowestCents: running };
      }
    }
    return {
      accountId: a.accountId,
      name: a.name,
      liability: a.liability,
      currentCents: latest.cents,
      asOf: latest.date,
      projectedCents,
      belowZero,
    };
  });

  const net = (pick: (a: ProjectedAccount) => number) =>
    accounts.reduce((sum, a) => sum + (a.liability ? -1 : 1) * pick(a), 0);
  return {
    netCents: [net((a) => a.currentCents), ...horizons.map((_, i) => net((a) => a.projectedCents[i]))],
    accounts,
    rulesLeftOut,
    includesTransfers: includeTransfers,
    transfersLeftOut,
  };
}
