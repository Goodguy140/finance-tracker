import type { TransactionType } from "@prisma/client";
import {
  forecastRecurringOccurrences,
  groupForecastByDay,
  type BillsForecastOccurrence,
} from "@/lib/bills-forecast";
import { cardPaymentsDue, type CardTerms } from "@/lib/credit-cards";
import { ymdFromDateUtc } from "@/lib/date-only";
import type { RecurringForecastRule } from "@/lib/recurring-transactions";

/**
 * The Upcoming bills card's list, day by day: the recurring rules' and open plans' occurrences
 * from today on (this month's overdue ones first), and each card's next payment by its due day.
 * Transfers and card payments are listed but kept out of the totals and the running net: no
 * money comes in or goes out. Shared by the dashboard card and the phone.
 */

type ListedRule = Pick<
  RecurringForecastRule,
  "type" | "amountCents" | "cadence" | "nextExpectedDate" | "anchorDay" | "secondAnchorDay" | "beforeWeekend" | "endDate" | "enabled"
> & {
  id: string;
  name: string;
  category: { name: string };
  account: { name: string };
  transferAccount?: { name: string } | null;
  transferAccountId?: string | null;
  decideBy?: Date | null;
  planned?: true;
};

export type BillsForecastEntry = {
  key: string;
  /** The recurring rule, or the one-off plan when `planned`. */
  sourceId: string;
  name: string;
  type: TransactionType;
  /** Null for a card payment with neither a balance nor a minimum on record. */
  amountCents: number | null;
  date: Date;
  overdue: boolean;
  /** Set when a rule is carried past a missed occurrence from an earlier month. */
  missedSince: Date | null;
  planned: boolean;
  /** The category, or for a transfer "Chequing to Savings". Empty for a card payment. */
  label: string;
  /** A credit card's payment, from its due day: what is owed (latest reading) and the minimum. */
  card: { accountId: string; owedCents: number | null; minimumCents: number | null } | null;
  /** A subscription's "Decide by" date, on its first listed charge while still ahead. */
  decideBy: Date | null;
};

export type BillsForecastList = {
  incomeCents: number;
  expenseCents: number;
  netCents: number;
  days: Array<{ dateYmd: string; runningNetCents: number; entries: BillsForecastEntry[] }>;
  /** Card payments listed, for the card's count of what it forecasts from. */
  cardPaymentCount: number;
};

export function buildBillsForecastList(input: {
  /** The rules to forecast from, with plans as `plannedAsForecastRules` gives them. */
  rules: readonly ListedRule[];
  /** The recurring rules alone: a card a recurring transfer pays is left to that transfer. */
  cardRules: ReadonlyArray<{ type: string; enabled: boolean; transferAccountId?: string | null }>;
  cardTerms: readonly CardTerms[];
  todayYmd: string;
  currentYm: string;
  days: number;
  includeTransfers: boolean;
}): BillsForecastList {
  const { todayYmd, days, includeTransfers } = input;
  const forecast = forecastRecurringOccurrences(input.rules, { todayYmd, currentYm: input.currentYm, days, includeTransfers });
  const cardPayments = includeTransfers ? cardPaymentsDue(input.cardTerms, input.cardRules, todayYmd, days) : [];

  type Row = BillsForecastOccurrence<{ type: TransactionType; amountCents: number; entry: BillsForecastEntry }>;
  const decideByShown = new Set<string>();
  const ruleRows: Row[] = forecast.occurrences.map(({ rule, date, overdue, missedSince }) => {
    const decideBy =
      rule.decideBy && ymdFromDateUtc(rule.decideBy) >= todayYmd && !decideByShown.has(rule.id) ? rule.decideBy : null;
    if (decideBy) decideByShown.add(rule.id);
    const entry: BillsForecastEntry = {
      key: `${rule.id}:${ymdFromDateUtc(date)}`,
      sourceId: rule.id,
      name: rule.name,
      type: rule.type,
      amountCents: rule.amountCents,
      date,
      overdue,
      missedSince,
      planned: rule.planned === true,
      label: rule.type === "TRANSFER" ? `${rule.account.name} to ${rule.transferAccount?.name ?? "another account"}` : rule.category.name,
      card: null,
      decideBy,
    };
    return { rule: { type: rule.type, amountCents: rule.amountCents, entry }, date, overdue, missedSince };
  });
  const cardRows: Row[] = cardPayments.map((due) => {
    // The latest balance reading when there is one, else the minimum on record.
    const amountCents = due.owedCents ?? due.minimumCents;
    const entry: BillsForecastEntry = {
      key: `card:${due.accountId}:${ymdFromDateUtc(due.date)}`,
      sourceId: due.accountId,
      name: `${due.name} payment`,
      type: "TRANSFER",
      amountCents,
      date: due.date,
      overdue: false,
      missedSince: null,
      planned: false,
      label: "",
      card: { accountId: due.accountId, owedCents: due.owedCents, minimumCents: due.minimumCents },
      decideBy: null,
    };
    return { rule: { type: "TRANSFER", amountCents: amountCents ?? 0, entry }, date: due.date, overdue: false, missedSince: null };
  });
  const rows = [...ruleRows, ...cardRows].sort((a, b) => a.date.getTime() - b.date.getTime());
  return {
    incomeCents: forecast.incomeCents,
    expenseCents: forecast.expenseCents,
    netCents: forecast.netCents,
    days: groupForecastByDay(rows).map((day) => ({
      dateYmd: day.dateYmd,
      runningNetCents: day.runningNetCents,
      entries: day.occurrences.map((o) => o.rule.entry),
    })),
    cardPaymentCount: cardPayments.length,
  };
}
