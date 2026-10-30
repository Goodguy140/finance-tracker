import { AccountType } from "@prisma/client";
import { endExclusiveOfMonthYm, formatYmShortLabel } from "@/lib/dashboard-period";
import { dateFromYmd } from "@/lib/date-only";

/**
 * Net worth: what the user's accounts hold less what they owe, at the end of each month.
 *
 * Built from three kinds of reading, all "this account stood at X on day D": balances Plaid
 * returned with a sync, balances entered by hand, and the hand-entered investment
 * `PortfolioSnapshot` rows. An account's value at a point is its latest reading on or
 * before it, carried forward until the next one; an account with no reading yet is left out
 * rather than counted as zero.
 *
 * Credit cards, loans and mortgages are liabilities: their readings are what is owed and are
 * subtracted. Archived accounts are left out entirely, and so are accounts in another
 * currency than the total's, since there is no exchange rate to convert them with.
 */

const LIABILITY_TYPES: ReadonlySet<string> = new Set<AccountType>([AccountType.CREDIT_CARD, AccountType.LOAN, AccountType.MORTGAGE]);

export function isLiabilityType(type: AccountType | string): boolean {
  return LIABILITY_TYPES.has(type);
}

export type NetWorthAccount = {
  id: string;
  name: string;
  type: AccountType | string;
  currency: string;
  archived: boolean;
  /** A credit card's limit, carried onto its row for utilization. */
  creditLimitCents?: number | null;
};

export type BalanceReadingSource = "PLAID" | "MANUAL" | "PORTFOLIO";

export type BalanceReading = {
  accountId: string;
  /** Date-only, midnight UTC. */
  date: Date;
  cents: number;
  source: BalanceReadingSource;
};

export type NetWorthPoint = {
  ym: string;
  label: string;
  assetsCents: number;
  liabilitiesCents: number;
  netCents: number;
};

export type AccountBalanceRow = {
  accountId: string;
  name: string;
  type: string;
  currency: string;
  liability: boolean;
  /** Latest reading on or before today; null when there is none yet. */
  latest: { cents: number; date: Date; source: BalanceReadingSource } | null;
  /** False when the account's currency differs from the total's. */
  counted: boolean;
  /** A credit card's limit, when one is set. */
  creditLimitCents?: number | null;
};

export type NetWorth = {
  currency: string;
  /** Oldest first. Months before any reading are left out. */
  points: NetWorthPoint[];
  assetsCents: number;
  liabilitiesCents: number;
  netCents: number;
  /** Assets first, then liabilities, each largest first; accounts with no reading last. */
  accounts: AccountBalanceRow[];
};

/** The latest reading per account strictly before `before`. */
function latestBefore(readings: readonly BalanceReading[], before: Date): Map<string, BalanceReading> {
  const out = new Map<string, BalanceReading>();
  for (const r of readings) {
    if (r.date.getTime() >= before.getTime()) continue;
    const prev = out.get(r.accountId);
    // A tie on date goes to a balance over a portfolio snapshot: it is the more direct reading.
    if (!prev || r.date > prev.date || (r.date.getTime() === prev.date.getTime() && prev.source === "PORTFOLIO")) {
      out.set(r.accountId, r);
    }
  }
  return out;
}

function totals(accounts: readonly NetWorthAccount[], latest: ReadonlyMap<string, BalanceReading>) {
  let assets = 0;
  let liabilities = 0;
  let any = false;
  for (const account of accounts) {
    const reading = latest.get(account.id);
    if (!reading) continue;
    any = true;
    if (isLiabilityType(account.type)) liabilities += reading.cents;
    else assets += reading.cents;
  }
  return { assets, liabilities, any };
}

/**
 * Net worth at the end of each of `months` (`YYYY-MM`, oldest first), with the month that
 * contains `todayYmd` measured as of today, plus each account's latest balance.
 */
export function computeNetWorth(input: {
  accounts: readonly NetWorthAccount[];
  readings: readonly BalanceReading[];
  months: readonly string[];
  todayYmd: string;
  currency: string;
}): NetWorth {
  const active = input.accounts.filter((a) => !a.archived);
  const counted = active.filter((a) => a.currency.toUpperCase() === input.currency.toUpperCase());
  const tomorrow = new Date(dateFromYmd(input.todayYmd).getTime() + 24 * 60 * 60 * 1000);
  const crossesYears = new Set(input.months.map((ym) => ym.slice(0, 4))).size > 1;

  const points: NetWorthPoint[] = [];
  for (const ym of input.months) {
    const end = endExclusiveOfMonthYm(ym);
    const asOf = end < tomorrow ? end : tomorrow;
    const { assets, liabilities, any } = totals(counted, latestBefore(input.readings, asOf));
    if (!any) continue;
    points.push({
      ym,
      label: formatYmShortLabel(ym, crossesYears),
      assetsCents: assets,
      liabilitiesCents: liabilities,
      netCents: assets - liabilities,
    });
  }

  const now = latestBefore(input.readings, tomorrow);
  const current = totals(counted, now);
  const rows: AccountBalanceRow[] = active.map((a) => {
    const r = now.get(a.id);
    return {
      accountId: a.id,
      name: a.name,
      type: String(a.type),
      currency: a.currency,
      liability: isLiabilityType(a.type),
      latest: r ? { cents: r.cents, date: r.date, source: r.source } : null,
      counted: counted.includes(a),
      creditLimitCents: a.creditLimitCents ?? null,
    };
  });
  rows.sort(
    (x, y) =>
      Number(x.latest === null) - Number(y.latest === null) ||
      Number(x.liability) - Number(y.liability) ||
      (y.latest?.cents ?? 0) - (x.latest?.cents ?? 0) ||
      x.name.localeCompare(y.name),
  );

  return {
    currency: input.currency,
    points,
    assetsCents: current.assets,
    liabilitiesCents: current.liabilities,
    netCents: current.assets - current.liabilities,
    accounts: rows,
  };
}
