import { loadSafeToSpend } from "@/lib/safe-to-spend-data";
import { DigestFrequency, PlaidStagedStatus, TransactionType, type PrismaClient } from "@prisma/client";
import { forecastRecurringOccurrences } from "@/lib/bills-forecast";
import { buildMonthlyBudgetProgress } from "@/lib/budget-progress";
import { formatYmLongLabel, shiftYm } from "@/lib/dashboard-period";
import { dateFromYmd, ymdFromDateUtc } from "@/lib/date-only";
import { isSmtpConfigured, sendEmail } from "@/lib/email";
import { homeCurrencyOf } from "@/lib/home-currency";
import { categoryAmounts } from "@/lib/insights/facts";
import { formatCurrency } from "@/lib/money";
import { currentYmdInTimeZone } from "@/lib/period-month";
import { prisma } from "@/lib/prisma";
import { loadReportTxs } from "@/lib/reports/load";

/**
 * The emailed spending digest: what went out and came in over the last week (sent Mondays) or
 * month (sent on the 1st), where it went, budgets in trouble, bills coming up and bank rows
 * waiting for review. Read-only: it never changes anything but the user's own "last sent" key.
 */

/** Local hour from which a due digest goes out, so it lands in the morning, not at midnight. */
export const DIGEST_SEND_HOUR = 7;

export type DigestPeriod = {
  frequency: Exclude<DigestFrequency, "OFF">;
  /** Stored on the user once sent, so each period goes out once. */
  key: string;
  label: string;
  start: Date;
  /** First day not included. */
  end: Date;
  /** The period before, for the comparison line. */
  previousStart: Date;
};

function addDays(ymd: string, days: number): string {
  const d = dateFromYmd(ymd);
  d.setUTCDate(d.getUTCDate() + days);
  return ymdFromDateUtc(d);
}

const shortDate = new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", timeZone: "UTC" });

/** The last complete week (Monday to Sunday) or calendar month before `todayYmd`. */
export function latestDigestPeriod(frequency: Exclude<DigestFrequency, "OFF">, todayYmd: string): DigestPeriod {
  if (frequency === "WEEKLY") {
    const weekday = (dateFromYmd(todayYmd).getUTCDay() + 6) % 7; // Monday is 0
    const endYmd = addDays(todayYmd, -weekday);
    const startYmd = addDays(endYmd, -7);
    const lastDay = dateFromYmd(addDays(endYmd, -1));
    return {
      frequency,
      key: `W:${startYmd}`,
      label: `${shortDate.format(dateFromYmd(startYmd))} to ${shortDate.format(lastDay)}`,
      start: dateFromYmd(startYmd),
      end: dateFromYmd(endYmd),
      previousStart: dateFromYmd(addDays(startYmd, -7)),
    };
  }
  const ym = shiftYm(todayYmd.slice(0, 7), -1);
  return {
    frequency,
    key: `M:${ym}`,
    label: formatYmLongLabel(ym),
    start: dateFromYmd(`${ym}-01`),
    end: dateFromYmd(`${todayYmd.slice(0, 7)}-01`),
    previousStart: dateFromYmd(`${shiftYm(ym, -1)}-01`),
  };
}

export function localHour(timeZone: string, now: Date): number {
  try {
    const hour = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).format(now);
    return Number.parseInt(hour, 10);
  } catch {
    return now.getHours();
  }
}

/** The period a user's digest is due for now, or null. */
export function dueDigestPeriod(
  user: { digestFrequency: DigestFrequency; digestLastPeriodKey: string | null; timezone: string },
  now: Date,
): DigestPeriod | null {
  if (user.digestFrequency === "OFF") return null;
  if (localHour(user.timezone, now) < DIGEST_SEND_HOUR) return null;
  const period = latestDigestPeriod(user.digestFrequency, currentYmdInTimeZone(user.timezone, now));
  return period.key === user.digestLastPeriodKey ? null : period;
}

export type DigestData = {
  period: DigestPeriod;
  currency: string;
  spentCents: number;
  receivedCents: number;
  previousSpentCents: number;
  topCategories: Array<{ name: string; cents: number }>;
  biggest: Array<{ date: Date; title: string; cents: number }>;
  budgets: Array<{ name: string; spentCents: number; limitCents: number }>;
  budgetsMonthLabel: string;
  upcoming: Array<{ date: Date; name: string; cents: number }>;
  upcomingDays: number;
  reviewCount: number;
  /** Safe to spend for the month now running (`safe-to-spend.ts`); null when it could not be worked out. */
  safeToSpendCents: number | null;
};

export async function loadDigestData(
  user: { id: string; countryCode: string; timezone: string },
  period: DigestPeriod,
  now: Date,
  client: PrismaClient = prisma,
): Promise<DigestData> {
  const currency = homeCurrencyOf(user.countryCode);
  const todayYmd = currentYmdInTimeZone(user.timezone, now);
  // A monthly digest judges the month it covers; a weekly one, the month now running.
  const budgetYm = period.frequency === "MONTHLY" ? ymdFromDateUtc(period.start).slice(0, 7) : todayYmd.slice(0, 7);
  const upcomingDays = period.frequency === "MONTHLY" ? 30 : 7;
  const [txs, progress, rules, reviewCount] = await Promise.all([
    loadReportTxs(user.id, period.previousStart, currency),
    buildMonthlyBudgetProgress(user.id, budgetYm, client),
    client.recurringTransaction.findMany({
      where: { userId: user.id, enabled: true, type: TransactionType.EXPENSE },
      select: {
        name: true,
        type: true,
        amountCents: true,
        cadence: true,
        nextExpectedDate: true,
        anchorDay: true,
        endDate: true,
        enabled: true,
      },
    }),
    client.plaidStagedTransaction.count({ where: { userId: user.id, status: PlaidStagedStatus.NEEDS_REVIEW } }),
  ]);
  const safeToSpendCents = await loadSafeToSpend(user, now, client)
    .then((s) => s.safeCents)
    .catch((err) => {
      console.error("[digest] safe to spend failed", err);
      return null;
    });

  const inPeriod = txs.filter((tx) => tx.date >= period.start && tx.date < period.end);
  const before = txs.filter((tx) => tx.date >= period.previousStart && tx.date < period.start);
  const spend = (rows: typeof txs) =>
    rows.filter((tx) => tx.type === TransactionType.EXPENSE).reduce((sum, tx) => sum + tx.amountCents, 0);

  const byCategory = new Map<string, { name: string; cents: number }>();
  for (const tx of inPeriod) {
    if (tx.type !== TransactionType.EXPENSE) continue;
    for (const part of categoryAmounts(tx)) {
      const entry = byCategory.get(part.categoryId) ?? { name: part.categoryName, cents: 0 };
      entry.cents += part.amountCents;
      byCategory.set(part.categoryId, entry);
    }
  }

  const forecast = forecastRecurringOccurrences(rules, {
    todayYmd,
    currentYm: todayYmd.slice(0, 7),
    days: upcomingDays,
  });

  return {
    period,
    currency,
    spentCents: spend(inPeriod),
    receivedCents: inPeriod.filter((tx) => tx.type === TransactionType.INCOME).reduce((sum, tx) => sum + tx.amountCents, 0),
    previousSpentCents: spend(before),
    topCategories: [...byCategory.values()].filter((c) => c.cents > 0).sort((a, b) => b.cents - a.cents).slice(0, 5),
    biggest: inPeriod
      .filter((tx) => tx.type === TransactionType.EXPENSE && tx.amountCents > 0)
      .sort((a, b) => b.amountCents - a.amountCents)
      .slice(0, 3)
      .map((tx) => ({ date: tx.date, title: tx.merchantName || tx.title || tx.categoryName, cents: tx.amountCents })),
    // Over 80% of the limit: the same line the dashboard's warnings draw.
    budgets: progress.budgets
      .filter((row) => row.limitCents > 0 && row.spentCents >= row.limitCents * 0.8)
      .map((row) => ({ name: row.categoryName, spentCents: row.spentCents, limitCents: row.limitCents })),
    budgetsMonthLabel: formatYmLongLabel(budgetYm),
    upcoming: forecast.occurrences
      .filter((o) => !o.overdue)
      .map((o) => ({ date: o.date, name: o.rule.name, cents: o.rule.amountCents })),
    upcomingDays,
    reviewCount,
    safeToSpendCents,
  };
}

/** Nothing spent, received, due or waiting: no email is better than an empty one. */
export function digestIsEmpty(data: DigestData): boolean {
  return (
    data.spentCents === 0 &&
    data.receivedCents === 0 &&
    data.budgets.length === 0 &&
    data.upcoming.length === 0 &&
    data.reviewCount === 0
  );
}

function changeLine(current: number, previous: number, noun: string): string | null {
  if (previous <= 0) return null;
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return `about the same as the ${noun} before`;
  return `${pct > 0 ? "up" : "down"} ${Math.abs(pct)}% on the ${noun} before`;
}

export function renderDigest(data: DigestData, baseUrl?: string): { subject: string; text: string } {
  const money = (cents: number) => formatCurrency(cents, data.currency);
  const noun = data.period.frequency === "WEEKLY" ? "week" : "month";
  const title = data.period.frequency === "WEEKLY" ? `Your week, ${data.period.label}` : `Your ${data.period.label}`;
  const lines: string[] = [title, ""];

  const change = changeLine(data.spentCents, data.previousSpentCents, noun);
  lines.push(`Spent: ${money(data.spentCents)}${change ? ` (${change})` : ""}`);
  lines.push(`Received: ${money(data.receivedCents)}`);
  const net = data.receivedCents - data.spentCents;
  lines.push(net >= 0 ? `Left over: ${money(net)}` : `Spent more than came in by ${money(-net)}`);
  if (data.safeToSpendCents !== null) lines.push(`Safe to spend for the rest of this month: ${money(data.safeToSpendCents)}`);

  if (data.topCategories.length) {
    lines.push("", "Where it went");
    for (const c of data.topCategories) lines.push(`  ${c.name}: ${money(c.cents)}`);
  }
  if (data.biggest.length) {
    lines.push("", "Biggest purchases");
    for (const b of data.biggest) lines.push(`  ${shortDate.format(b.date)}  ${b.title}: ${money(b.cents)}`);
  }
  if (data.budgets.length) {
    lines.push("", `Budgets to watch, ${data.budgetsMonthLabel}`);
    for (const b of data.budgets) {
      const state =
        b.spentCents > b.limitCents
          ? `over by ${money(b.spentCents - b.limitCents)}`
          : `${money(b.limitCents - b.spentCents)} left`;
      lines.push(`  ${b.name}: ${money(b.spentCents)} of ${money(b.limitCents)}, ${state}`);
    }
  }
  if (data.upcoming.length) {
    lines.push("", `Bills in the next ${data.upcomingDays} days`);
    for (const u of data.upcoming) lines.push(`  ${shortDate.format(u.date)}  ${u.name}: ${money(u.cents)}`);
  }
  if (data.reviewCount > 0) {
    lines.push(
      "",
      data.reviewCount === 1
        ? "1 bank transaction is waiting for you to review."
        : `${data.reviewCount} bank transactions are waiting for you to review.`,
    );
  }
  if (baseUrl) lines.push("", `Open the app: ${baseUrl}/`);
  if (baseUrl && data.period.frequency === "MONTHLY") {
    lines.push(`Review and close the month: ${baseUrl}/reports/month?month=${ymdFromDateUtc(data.period.start).slice(0, 7)}`);
  }
  lines.push("", `You get this ${noun === "week" ? "every Monday" : "on the 1st of each month"} because it is turned on in Settings → Notifications.`);

  return { subject: `${title}: spent ${money(data.spentCents)}`, text: lines.join("\n") };
}

type DigestUser = {
  id: string;
  email: string;
  countryCode: string;
  timezone: string;
  digestFrequency: DigestFrequency;
  digestLastPeriodKey: string | null;
};

const DIGEST_USER_SELECT = {
  id: true,
  email: true,
  countryCode: true,
  timezone: true,
  digestFrequency: true,
  digestLastPeriodKey: true,
} as const;

export type DigestOutcome = "sent" | "empty" | "not-due" | "taken" | "failed";

/**
 * Sends one user's digest if it is due. The period is claimed first (a conditional update on
 * the old key), so two sweeps never send it twice; a failed send gives the claim back for the
 * next hourly tick to retry.
 */
export async function sendDueDigest(
  user: DigestUser,
  now: Date,
  deps: { client?: PrismaClient; send?: typeof sendEmail; baseUrl?: string } = {},
): Promise<DigestOutcome> {
  const client = deps.client ?? prisma;
  const send = deps.send ?? sendEmail;
  const period = dueDigestPeriod(user, now);
  if (!period) return "not-due";
  const claimed = await client.user.updateMany({
    where: { id: user.id, digestLastPeriodKey: user.digestLastPeriodKey },
    data: { digestLastPeriodKey: period.key },
  });
  if (claimed.count === 0) return "taken";

  try {
    const data = await loadDigestData(user, period, now, client);
    if (digestIsEmpty(data)) return "empty";
    const { subject, text } = renderDigest(data, deps.baseUrl);
    if ((await send({ to: user.email, subject, text })).sent) return "sent";
  } catch (err) {
    console.error("[digest] sending failed", err);
  }
  await client.user.updateMany({
    where: { id: user.id, digestLastPeriodKey: period.key },
    data: { digestLastPeriodKey: user.digestLastPeriodKey },
  });
  return "failed";
}

/** One hourly tick over every user who wants a digest. */
export async function runEmailDigestSweep(
  now = new Date(),
  deps: { client?: PrismaClient; send?: typeof sendEmail; smtpConfigured?: () => boolean } = {},
): Promise<{ ok: boolean; message: string; sent: number }> {
  if (!(deps.smtpConfigured ?? isSmtpConfigured)()) return { ok: true, message: "Skipped: SMTP is not configured", sent: 0 };
  const client = deps.client ?? prisma;
  const users = await client.user.findMany({
    where: { digestFrequency: { not: DigestFrequency.OFF }, disabledAt: null },
    select: DIGEST_USER_SELECT,
  });
  const baseUrl = process.env.NEXTAUTH_URL?.trim().replace(/\/$/, "");
  let sent = 0;
  let failed = 0;
  for (const user of users) {
    const outcome = await sendDueDigest(user, now, { client, send: deps.send, baseUrl });
    if (outcome === "sent") sent += 1;
    if (outcome === "failed") failed += 1;
  }
  return { ok: failed === 0, message: `Sent ${sent} digest(s)${failed ? `, ${failed} failed` : ""}`, sent };
}

/** The "Send one now" button: the latest period, whether or not it went out, without marking it. */
export async function sendDigestPreview(userId: string, now = new Date()): Promise<"sent" | "smtp"> {
  if (!isSmtpConfigured()) return "smtp";
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: DIGEST_USER_SELECT });
  const frequency = user.digestFrequency === "OFF" ? "WEEKLY" : user.digestFrequency;
  const period = latestDigestPeriod(frequency, currentYmdInTimeZone(user.timezone, now));
  const data = await loadDigestData(user, period, now);
  const { subject, text } = renderDigest(data, process.env.NEXTAUTH_URL?.trim().replace(/\/$/, ""));
  const result = await sendEmail({ to: user.email, subject, text });
  return result.sent ? "sent" : "smtp";
}
