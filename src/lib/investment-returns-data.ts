import { TransactionType } from "@prisma/client";
import { homeCurrencyOf } from "@/lib/home-currency";
import { returnWindows, type AccountHistory, type CashFlow, type ReturnWindows, type ValueReading } from "@/lib/investment-returns";
import { loadBalanceInputs } from "@/lib/net-worth-data";
import { currentYmdInTimeZone } from "@/lib/period-month";
import { prisma } from "@/lib/prisma";
import { moneyIntoAccount } from "@/lib/reconciliation";

/** Account types that hold investments, whether or not a snapshot has been recorded yet. */
const INVESTMENT_TYPES = ["TFSA", "RRSP", "FHSA", "NON_REGISTERED"] as const;

export type AccountReturns = {
  accountId: string;
  name: string;
  currency: string;
  windows: ReturnWindows;
};

export type InvestmentReturns = {
  accounts: AccountReturns[];
  /** Every home-currency account together; null when none has two readings. */
  total: ReturnWindows | null;
  currency: string;
};

/**
 * Returns for each active investment account (an investment type, or any account with a
 * portfolio snapshot) that has at least two value readings, and for them all together.
 */
export async function loadInvestmentReturns(user: {
  id: string;
  timezone: string | null;
  countryCode: string | null;
}): Promise<InvestmentReturns> {
  const currency = homeCurrencyOf(user.countryCode);
  const todayYmd = currentYmdInTimeZone(user.timezone);
  const { accounts, readings } = await loadBalanceInputs(user.id);
  const withSnapshots = new Set(readings.filter((r) => r.source === "PORTFOLIO").map((r) => r.accountId));
  const investing = accounts.filter(
    (a) => !a.archived && ((INVESTMENT_TYPES as readonly string[]).includes(String(a.type)) || withSnapshots.has(a.id)),
  );
  if (investing.length === 0) return { accounts: [], total: null, currency };
  const ids = investing.map((a) => a.id);

  const [flows, transfers] = await Promise.all([
    prisma.investmentFlow.findMany({
      where: { userId: user.id, accountId: { in: ids } },
      select: { accountId: true, date: true, direction: true, amountCents: true, transactionId: true, transaction: { select: { transferPeerId: true } } },
    }),
    prisma.transaction.findMany({
      where: { userId: user.id, type: TransactionType.TRANSFER, OR: [{ accountId: { in: ids } }, { transferAccountId: { in: ids } }] },
      select: {
        id: true,
        type: true,
        amountCents: true,
        date: true,
        title: true,
        accountId: true,
        transferAccountId: true,
        transferPeerId: true,
        owedShares: { select: { amountCents: true } },
      },
    }),
  ]);

  // A transfer counted toward room is the same money as its contribution, on either leg.
  const counted = new Set<string>();
  for (const f of flows) {
    if (f.transactionId) counted.add(f.transactionId);
    if (f.transaction?.transferPeerId) counted.add(f.transaction.transferPeerId);
  }

  const histories = new Map<string, AccountHistory & { values: ValueReading[]; flows: CashFlow[] }>();
  for (const id of ids) histories.set(id, { values: [], flows: [] });
  // One value a day: a balance over a portfolio snapshot, as net worth reads them.
  const byDay = new Map<string, { date: Date; cents: number; portfolio: boolean }>();
  for (const r of readings) {
    if (!histories.has(r.accountId)) continue;
    const key = `${r.accountId}:${r.date.getTime()}`;
    const prev = byDay.get(key);
    if (!prev || (prev.portfolio && r.source !== "PORTFOLIO")) {
      byDay.set(key, { date: r.date, cents: r.cents, portfolio: r.source === "PORTFOLIO" });
    }
  }
  for (const [key, v] of byDay) histories.get(key.split(":")[0])!.values.push({ date: v.date, cents: v.cents });
  for (const f of flows) {
    histories.get(f.accountId)!.flows.push({ date: f.date, cents: f.direction === "CONTRIBUTION" ? f.amountCents : -f.amountCents });
  }
  for (const tx of transfers) {
    if (counted.has(tx.id) || (tx.transferPeerId && counted.has(tx.transferPeerId))) continue;
    for (const id of [tx.accountId, tx.transferAccountId]) {
      if (!id || !histories.has(id)) continue;
      const into = moneyIntoAccount({ ...tx, categoryName: "" }, id);
      if (into !== null && into !== 0) histories.get(id)!.flows.push({ date: tx.date, cents: into });
    }
  }

  const rows: AccountReturns[] = [];
  const home: AccountHistory[] = [];
  for (const account of investing) {
    const history = histories.get(account.id)!;
    const windows = returnWindows([history], todayYmd);
    if (!windows.sinceStart) continue;
    rows.push({ accountId: account.id, name: account.name, currency: account.currency, windows });
    if (account.currency.toUpperCase() === currency.toUpperCase()) home.push(history);
  }
  rows.sort((a, b) => (b.windows.sinceStart?.endCents ?? 0) - (a.windows.sinceStart?.endCents ?? 0) || a.name.localeCompare(b.name));
  return { accounts: rows, total: home.length > 0 ? returnWindows(home, todayYmd) : null, currency };
}
