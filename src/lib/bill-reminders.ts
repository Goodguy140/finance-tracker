import { TransactionType, type PrismaClient, type RecurringCadence } from "@prisma/client";
import { forecastRecurringOccurrences } from "@/lib/bills-forecast";
import { dateFromYmd, ymdFromDateUtc } from "@/lib/date-only";
import { DIGEST_SEND_HOUR, localHour } from "@/lib/email-digest";
import { isSmtpConfigured, sendEmail } from "@/lib/email";
import { homeCurrencyOf } from "@/lib/home-currency";
import { formatCurrency } from "@/lib/money";
import { currentYmdInTimeZone } from "@/lib/period-month";
import { prisma } from "@/lib/prisma";

/**
 * Bill reminder emails: a few days before a recurring bill (or a recurring transfer, such as a
 * card payment) is due, one email listing what is coming. Each rule remembers the latest
 * occurrence it was reminded for (`RecurringTransaction.reminderSentForDate`), so an occurrence
 * is reminded once however many hourly ticks see it, and a rule added or moved inside the
 * window is still caught on the next tick.
 */

export const BILL_REMINDER_DAY_OPTIONS = [1, 3, 7] as const;

export function parseBillReminderDays(raw: string): number | null {
  if (raw === "" || raw === "OFF") return null;
  const days = Number.parseInt(raw, 10);
  if (!(BILL_REMINDER_DAY_OPTIONS as readonly number[]).includes(days)) {
    throw new Error("Choose when to be reminded.");
  }
  return days;
}

export type ReminderRule = {
  id: string;
  name: string;
  type: TransactionType;
  amountCents: number;
  cadence: RecurringCadence;
  nextExpectedDate: Date;
  anchorDay: number | null;
  endDate: Date | null;
  enabled: boolean;
  reminderSentForDate: Date | null;
  account: { name: string };
  transferAccount: { name: string } | null;
};

export type BillReminder = { ruleId: string; date: Date; name: string; cents: number; accountName: string; transfer: boolean };

/**
 * Bills and transfers due from today through `days` days ahead that have not been reminded yet.
 * Overdue occurrences are left out: the reminder is for what is coming, and the Recurring card
 * already shows what was missed.
 */
export function dueBillReminders(rules: readonly ReminderRule[], todayYmd: string, days: number): BillReminder[] {
  const { occurrences } = forecastRecurringOccurrences(
    rules.filter((rule) => rule.type === TransactionType.EXPENSE || rule.type === TransactionType.TRANSFER),
    { todayYmd, currentYm: todayYmd.slice(0, 7), days, includeTransfers: true },
  );
  return occurrences
    .filter((o) => !o.overdue && (!o.rule.reminderSentForDate || o.date > o.rule.reminderSentForDate))
    .map((o) => ({
      ruleId: o.rule.id,
      date: o.date,
      name: o.rule.name,
      cents: o.rule.amountCents,
      accountName:
        o.rule.type === TransactionType.TRANSFER && o.rule.transferAccount
          ? `${o.rule.account.name} to ${o.rule.transferAccount.name}`
          : o.rule.account.name,
      transfer: o.rule.type === TransactionType.TRANSFER,
    }));
}

const dayLabel = new Intl.DateTimeFormat("en-CA", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

function whenLabel(date: Date, todayYmd: string): string {
  const ymd = ymdFromDateUtc(date);
  if (ymd === todayYmd) return "Today";
  const tomorrow = dateFromYmd(todayYmd);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  if (ymd === ymdFromDateUtc(tomorrow)) return "Tomorrow";
  return dayLabel.format(date);
}

export function renderBillReminder(
  reminders: readonly BillReminder[],
  options: { todayYmd: string; currency: string; days: number; baseUrl?: string },
): { subject: string; text: string } {
  const money = (cents: number) => formatCurrency(cents, options.currency);
  const total = reminders.reduce((sum, r) => sum + r.cents, 0);
  const first = reminders[0];
  const when = whenLabel(first.date, options.todayYmd);
  const subject =
    reminders.length === 1
      ? `${first.name} is due ${when === "Today" || when === "Tomorrow" ? when.toLowerCase() : `on ${when}`}: ${money(first.cents)}`
      : `${reminders.length} bills due soon: ${money(total)}`;
  const lines = ["Coming up", ""];
  for (const r of reminders) {
    lines.push(`  ${whenLabel(r.date, options.todayYmd)}  ${r.name}: ${money(r.cents)} (${r.transfer ? "transfer, " : ""}${r.accountName})`);
  }
  if (reminders.length > 1) lines.push("", `Total: ${money(total)}`);
  if (options.baseUrl) lines.push("", `Open the app: ${options.baseUrl}/`);
  lines.push(
    "",
    `You get this ${options.days === 1 ? "the day before" : `${options.days} days before`} a recurring bill is due because bill reminders are on in Settings → Notifications.`,
  );
  return { subject, text: lines.join("\n") };
}

type ReminderUser = { id: string; email: string; countryCode: string; timezone: string; billReminderDays: number | null };

export type ReminderOutcome = "sent" | "none" | "not-due" | "failed";

const RULE_SELECT = {
  id: true,
  name: true,
  type: true,
  amountCents: true,
  cadence: true,
  nextExpectedDate: true,
  anchorDay: true,
  endDate: true,
  enabled: true,
  reminderSentForDate: true,
  account: { select: { name: true } },
  transferAccount: { select: { name: true } },
} as const;

/** Sends one user's reminder if anything is due; marks each rule only once the email went out. */
export async function sendDueBillReminders(
  user: ReminderUser,
  now: Date,
  deps: { client?: PrismaClient; send?: typeof sendEmail; baseUrl?: string } = {},
): Promise<ReminderOutcome> {
  const client = deps.client ?? prisma;
  const send = deps.send ?? sendEmail;
  if (!user.billReminderDays) return "not-due";
  if (localHour(user.timezone, now) < DIGEST_SEND_HOUR) return "not-due";
  const todayYmd = currentYmdInTimeZone(user.timezone, now);
  const rules = await client.recurringTransaction.findMany({
    where: { userId: user.id, enabled: true, type: { in: [TransactionType.EXPENSE, TransactionType.TRANSFER] } },
    select: RULE_SELECT,
  });
  const reminders = dueBillReminders(rules, todayYmd, user.billReminderDays);
  if (reminders.length === 0) return "none";

  const { subject, text } = renderBillReminder(reminders, {
    todayYmd,
    currency: homeCurrencyOf(user.countryCode),
    days: user.billReminderDays,
    baseUrl: deps.baseUrl,
  });
  try {
    if (!(await send({ to: user.email, subject, text })).sent) return "failed";
  } catch (err) {
    console.error("[bill reminders] sending failed", err);
    return "failed";
  }
  const latest = new Map<string, Date>();
  for (const r of reminders) {
    const seen = latest.get(r.ruleId);
    if (!seen || r.date > seen) latest.set(r.ruleId, r.date);
  }
  for (const [id, date] of latest) {
    await client.recurringTransaction.update({ where: { id }, data: { reminderSentForDate: date } });
  }
  return "sent";
}

/** One hourly tick over every user with bill reminders on. */
export async function runBillReminderSweep(
  now = new Date(),
  deps: { client?: PrismaClient; send?: typeof sendEmail; smtpConfigured?: () => boolean } = {},
): Promise<{ ok: boolean; message: string; sent: number }> {
  if (!(deps.smtpConfigured ?? isSmtpConfigured)()) return { ok: true, message: "Skipped: SMTP is not configured", sent: 0 };
  const client = deps.client ?? prisma;
  const users = await client.user.findMany({
    where: { billReminderDays: { not: null }, disabledAt: null },
    select: { id: true, email: true, countryCode: true, timezone: true, billReminderDays: true },
  });
  const baseUrl = process.env.NEXTAUTH_URL?.trim().replace(/\/$/, "");
  let sent = 0;
  let failed = 0;
  for (const user of users) {
    const outcome = await sendDueBillReminders(user, now, { client, send: deps.send, baseUrl });
    if (outcome === "sent") sent += 1;
    if (outcome === "failed") failed += 1;
  }
  return { ok: failed === 0, message: `Sent ${sent} bill reminder(s)${failed ? `, ${failed} failed` : ""}`, sent };
}
