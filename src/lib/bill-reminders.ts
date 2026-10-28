import { TransactionType, type PrismaClient, type RecurringCadence } from "@prisma/client";
import { forecastRecurringOccurrences } from "@/lib/bills-forecast";
import { cardsDueWithin, type CardDue, type CardTerms } from "@/lib/credit-cards";
import { dateFromYmd, ymdFromDateUtc } from "@/lib/date-only";
import { DIGEST_SEND_HOUR, localHour } from "@/lib/email-digest";
import { isSmtpConfigured, sendEmail } from "@/lib/email";
import { homeCurrencyOf } from "@/lib/home-currency";
import { formatCurrency } from "@/lib/money";
import { currentYmdInTimeZone } from "@/lib/period-month";
import { prisma } from "@/lib/prisma";
import { anyPushDevices, deliverAlert, type PushMessage, type PushSender } from "@/lib/push-notifications";
import { dueDecisionReminders, type DecisionReminder } from "@/lib/subscription-cancel";

/**
 * Bill reminders: a few days before a recurring bill (or a recurring transfer, such as a card
 * payment) is due, one email (and a push to each phone that has them on) listing what is coming. Each rule remembers the latest
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
  secondAnchorDay: number | null;
  beforeWeekend: boolean;
  endDate: Date | null;
  enabled: boolean;
  reminderSentForDate: Date | null;
  account: { name: string };
  transferAccountId?: string | null;
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

export type CardReminderTerms = CardTerms & { paymentRemindedFor: Date | null };

/**
 * Card payments due from today through `days` days ahead that have not been reminded yet. A card
 * a recurring transfer already pays is left out: that transfer is in the list as a bill.
 */
export function dueCardReminders(
  cards: readonly CardReminderTerms[],
  rules: readonly Pick<ReminderRule, "type" | "enabled" | "transferAccountId">[],
  todayYmd: string,
  days: number,
): CardDue[] {
  const paidByRule = new Set(
    rules.filter((r) => r.enabled && r.type === TransactionType.TRANSFER && r.transferAccountId).map((r) => r.transferAccountId),
  );
  const remindedFor = new Map(cards.map((c) => [c.id, c.paymentRemindedFor]));
  return cardsDueWithin(
    cards.filter((c) => !paidByRule.has(c.id)),
    todayYmd,
    days,
  ).filter((due) => {
    const last = remindedFor.get(due.accountId);
    return !last || due.date > last;
  });
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
  decisions: readonly DecisionReminder[] = [],
  cards: readonly CardDue[] = [],
): { subject: string; text: string } {
  const money = (cents: number) => formatCurrency(cents, options.currency);
  const total = reminders.reduce((sum, r) => sum + r.cents, 0);
  const lines: string[] = [];
  let subject: string;
  if (reminders.length > 0) {
    const first = reminders[0];
    const when = whenLabel(first.date, options.todayYmd);
    subject =
      reminders.length === 1
        ? `${first.name} is due ${when === "Today" || when === "Tomorrow" ? when.toLowerCase() : `on ${when}`}: ${money(first.cents)}`
        : `${reminders.length} bills due soon: ${money(total)}`;
  } else if (cards.length > 0) {
    const first = cards[0];
    const when = whenLabel(first.date, options.todayYmd);
    subject =
      cards.length === 1
        ? `${first.name} payment is due ${when === "Today" || when === "Tomorrow" ? when.toLowerCase() : `on ${when}`}`
        : `${cards.length} card payments due soon`;
  } else {
    const first = decisions[0];
    subject =
      decisions.length === 1
        ? `Decide on ${first.name} by ${whenLabel(first.decideBy, options.todayYmd).toLowerCase() === "today" ? "today" : dayLabel.format(first.decideBy)}`
        : `${decisions.length} subscriptions to decide on soon`;
  }
  if (decisions.length > 0) {
    // First: a trial converting is the one that costs money if it is missed.
    lines.push("Decide soon (a trial ends or a plan renews)", "");
    for (const d of decisions) {
      lines.push(`  ${whenLabel(d.decideBy, options.todayYmd)}  ${d.name}: ${money(d.cents)}${d.cancelUrl ? ` (to cancel: ${d.cancelUrl})` : ""}`);
    }
    if (reminders.length > 0 || cards.length > 0) lines.push("");
  }
  if (reminders.length > 0) {
    lines.push("Coming up", "");
    for (const r of reminders) {
      lines.push(`  ${whenLabel(r.date, options.todayYmd)}  ${r.name}: ${money(r.cents)} (${r.transfer ? "transfer, " : ""}${r.accountName})`);
    }
    if (reminders.length > 1) lines.push("", `Total: ${money(total)}`);
    if (cards.length > 0) lines.push("");
  }
  if (cards.length > 0) {
    lines.push("Card payments", "");
    for (const c of cards) {
      const details = [
        c.owedCents === null ? null : `${money(c.owedCents)} owed`,
        c.minimumCents ? `minimum ${money(c.minimumCents)}` : null,
      ].filter(Boolean);
      lines.push(`  ${whenLabel(c.date, options.todayYmd)}  ${c.name}${details.length ? `: ${details.join(", ")}` : ""}`);
    }
  }
  if (options.baseUrl) lines.push("", `Open the app: ${options.baseUrl}/`);
  lines.push(
    "",
    `You get this ${options.days === 1 ? "the day before" : `${options.days} days before`} a recurring bill is due because bill reminders are on in Settings → Notifications.`,
  );
  return { subject, text: lines.join("\n") };
}

/** The phone notification: the email's subject, and one short line per bill. */
export function billReminderPush(
  reminders: readonly BillReminder[],
  decisions: readonly DecisionReminder[],
  options: { todayYmd: string; currency: string; subject: string },
): PushMessage {
  const money = (cents: number) => formatCurrency(cents, options.currency);
  const lines = [
    ...decisions.map((d) => `Decide by ${whenLabel(d.decideBy, options.todayYmd)}: ${d.name} ${money(d.cents)}`),
    ...reminders.map((r) => `${whenLabel(r.date, options.todayYmd)}: ${r.name} ${money(r.cents)}`),
  ];
  const shown = lines.slice(0, 4);
  if (lines.length > shown.length) shown.push(`and ${lines.length - shown.length} more`);
  return { title: options.subject, body: shown.join("\n"), url: "/", tag: "bill-reminders" };
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
  secondAnchorDay: true,
  beforeWeekend: true,
  endDate: true,
  enabled: true,
  reminderSentForDate: true,
  account: { select: { name: true } },
  transferAccountId: true,
  transferAccount: { select: { name: true } },
} as const;

/** Sends one user's reminder if anything is due; marks each rule only once the email went out. */
export async function sendDueBillReminders(
  user: ReminderUser,
  now: Date,
  deps: { client?: PrismaClient; send?: typeof sendEmail; push?: PushSender; baseUrl?: string } = {},
): Promise<ReminderOutcome> {
  const client = deps.client ?? prisma;
  if (!user.billReminderDays) return "not-due";
  if (localHour(user.timezone, now) < DIGEST_SEND_HOUR) return "not-due";
  const todayYmd = currentYmdInTimeZone(user.timezone, now);
  const rules = await client.recurringTransaction.findMany({
    where: { userId: user.id, enabled: true, type: { in: [TransactionType.EXPENSE, TransactionType.TRANSFER] } },
    select: RULE_SELECT,
  });
  const reminders = dueBillReminders(rules, todayYmd, user.billReminderDays);
  const decisions = dueDecisionReminders(
    await client.recurringTransaction.findMany({
      where: { userId: user.id, enabled: true, type: TransactionType.EXPENSE, decideBy: { not: null } },
      select: {
        id: true,
        name: true,
        amountCents: true,
        cadence: true,
        enabled: true,
        decideBy: true,
        decideRemindedFor: true,
        cancelUrl: true,
      },
    }),
    todayYmd,
    user.billReminderDays,
  );
  const cards = dueCardReminders(await loadCardTerms(client, user.id, homeCurrencyOf(user.countryCode)), rules, todayYmd, user.billReminderDays);
  if (reminders.length === 0 && decisions.length === 0 && cards.length === 0) return "none";

  const currency = homeCurrencyOf(user.countryCode);
  const { subject, text } = renderBillReminder(
    reminders,
    { todayYmd, currency, days: user.billReminderDays, baseUrl: deps.baseUrl },
    decisions,
    cards,
  );
  const outcome = await deliverAlert(
    {
      userId: user.id,
      to: user.email,
      kind: "billReminders",
      subject,
      text,
      push: billReminderPush(reminders, decisions, { todayYmd, currency, subject }),
    },
    { client, send: deps.send, push: deps.push },
  );
  if (outcome === "no-channel") return "none";
  if (outcome === "failed") return "failed";
  const latest = new Map<string, Date>();
  for (const r of reminders) {
    const seen = latest.get(r.ruleId);
    if (!seen || r.date > seen) latest.set(r.ruleId, r.date);
  }
  for (const [id, date] of latest) {
    await client.recurringTransaction.update({ where: { id }, data: { reminderSentForDate: date } });
  }
  for (const d of decisions) {
    await client.recurringTransaction.update({ where: { id: d.ruleId }, data: { decideRemindedFor: d.decideBy } });
  }
  for (const c of cards) {
    await client.account.update({ where: { id: c.accountId }, data: { paymentRemindedFor: c.date } });
  }
  return "sent";
}

/** Home-currency cards with a due day, each with its latest balance reading. */
async function loadCardTerms(client: PrismaClient, userId: string, currency: string): Promise<CardReminderTerms[]> {
  const cards = await client.account.findMany({
    where: { userId, archived: false, currency, type: "CREDIT_CARD", paymentDueDay: { not: null } },
    select: { id: true, name: true, paymentDueDay: true, minimumPaymentCents: true, paymentRemindedFor: true },
  });
  if (cards.length === 0) return [];
  const readings = await client.accountBalanceSnapshot.findMany({
    where: { accountId: { in: cards.map((c) => c.id) } },
    orderBy: { date: "desc" },
    select: { accountId: true, date: true, balanceCents: true },
  });
  const latest = new Map<string, { cents: number; date: Date }>();
  for (const r of readings) if (!latest.has(r.accountId)) latest.set(r.accountId, { cents: r.balanceCents, date: r.date });
  return cards.map((c) => ({ ...c, owed: latest.get(c.id) ?? null }));
}

/** One hourly tick over every user with bill reminders on. */
export async function runBillReminderSweep(
  now = new Date(),
  deps: { client?: PrismaClient; send?: typeof sendEmail; push?: PushSender; smtpConfigured?: () => boolean } = {},
): Promise<{ ok: boolean; message: string; sent: number }> {
  const client = deps.client ?? prisma;
  const smtp = (deps.smtpConfigured ?? isSmtpConfigured)();
  if (!smtp && !(await anyPushDevices("billReminders", client))) {
    return { ok: true, message: "Skipped: SMTP is not configured and no phone has bill reminders on", sent: 0 };
  }
  // Without SMTP the email half is skipped rather than failing every user every hour.
  const send = smtp ? deps.send : async () => ({ sent: false, reason: "SMTP not configured" });
  const users = await client.user.findMany({
    where: { billReminderDays: { not: null }, disabledAt: null },
    select: { id: true, email: true, countryCode: true, timezone: true, billReminderDays: true },
  });
  const baseUrl = process.env.NEXTAUTH_URL?.trim().replace(/\/$/, "");
  let sent = 0;
  let failed = 0;
  for (const user of users) {
    const outcome = await sendDueBillReminders(user, now, { client, send, push: deps.push, baseUrl });
    if (outcome === "sent") sent += 1;
    if (outcome === "failed") failed += 1;
  }
  return { ok: failed === 0, message: `Sent ${sent} bill reminder(s)${failed ? `, ${failed} failed` : ""}`, sent };
}
