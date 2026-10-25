import { TransactionType } from "@prisma/client";
import { computeRoomYear, roomFlowsFromData } from "@/lib/contribution-room";
import { loadContributionRoomData } from "@/lib/contribution-room-data";
import { endExclusiveOfMonthYm, shiftYm, startOfMonthYm } from "@/lib/dashboard-period";
import { homeCurrencyOf, inCurrencyWhere } from "@/lib/home-currency";
import { loadNetWorth } from "@/lib/net-worth-data";
import { currentYmdInTimeZone } from "@/lib/period-month";
import { prisma } from "@/lib/prisma";
import type { Buckets } from "@/lib/retirement";

export type RetirementDefaults = {
  year: number;
  /** Income and spending over the last 12 full months, in the home currency. */
  incomeCents: number;
  spendingCents: number;
  balances: Buckets;
  room: { TFSA: number | null; RRSP: number | null; FHSA: number | null };
  hasFhsaAccount: boolean;
  fhsaContributedCents: number;
};

/** Starting points for the retirement projection, from the user's own records. */
export async function loadRetirementDefaults(user: {
  id: string;
  timezone: string | null;
  countryCode: string | null;
}): Promise<RetirementDefaults> {
  const currency = homeCurrencyOf(user.countryCode);
  const todayYmd = currentYmdInTimeZone(user.timezone);
  const thisYm = todayYmd.slice(0, 7);
  const year = Number(todayYmd.slice(0, 4));
  const range = { gte: startOfMonthYm(shiftYm(thisYm, -12)), lt: endExclusiveOfMonthYm(shiftYm(thisYm, -1)) };
  const [income, spending, netWorth, roomData] = await Promise.all([
    prisma.transaction.aggregate({
      where: { userId: user.id, type: TransactionType.INCOME, date: range, ...inCurrencyWhere(currency) },
      _sum: { amountCents: true },
    }),
    prisma.transaction.aggregate({
      where: { userId: user.id, type: TransactionType.EXPENSE, date: range, ...inCurrencyWhere(currency) },
      _sum: { amountCents: true },
    }),
    loadNetWorth(user),
    loadContributionRoomData(user.id),
  ]);

  const balances: Buckets = { TFSA: 0, RRSP: 0, FHSA: 0, NON_REGISTERED: 0 };
  for (const row of netWorth.accounts) {
    if (!row.counted || !row.latest) continue;
    if (row.type === "TFSA" || row.type === "RRSP" || row.type === "FHSA" || row.type === "NON_REGISTERED") {
      balances[row.type] += row.latest.cents;
    }
  }
  const flows = roomFlowsFromData(roomData);
  const room = (type: "TFSA" | "RRSP" | "FHSA") => {
    const r = computeRoomYear(type, year, roomData.entries, flows);
    return r.remainingCents === null ? null : Math.max(0, r.remainingCents);
  };
  return {
    year,
    incomeCents: income._sum.amountCents ?? 0,
    spendingCents: spending._sum.amountCents ?? 0,
    balances,
    room: { TFSA: room("TFSA"), RRSP: room("RRSP"), FHSA: room("FHSA") },
    hasFhsaAccount: netWorth.accounts.some((a) => a.type === "FHSA"),
    fhsaContributedCents: flows
      .filter((f) => f.accountType === "FHSA" && f.direction === "CONTRIBUTION")
      .reduce((sum, f) => sum + f.amountCents, 0),
  };
}
