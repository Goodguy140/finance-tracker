import { PlaidStagedStatus, TransactionType, type PrismaClient } from "@prisma/client";
import { isSmtpConfigured, sendEmail } from "@/lib/email";
import { homeCurrencyOf } from "@/lib/home-currency";
import { formatCurrency, parseCentsInput } from "@/lib/money";
import { prisma } from "@/lib/prisma";

/**
 * Emails about large or unusual charges a bank sync brings in. Every hourly tick looks at the
 * staged bank rows first seen since the last one (`ChargeAlertSetting.checkedThrough`), so a
 * charge is considered once, and only moves the mark on once the email went out. Nothing here
 * writes to the log: the alert only points at the review queue.
 */

/** A charge must be at least this many times the merchant's usual amount to be unusual... */
export const UNUSUAL_MULTIPLE = 3;
/** ...and at least this much above it, so a $2 coffee becoming $6 says nothing. */
export const UNUSUAL_MIN_EXCESS_CENTS = 2500;
/** Earlier charges from the merchant needed before "usual" means anything. */
export const UNUSUAL_MIN_HISTORY = 3;
/** How far back the merchant's earlier charges are read. */
const HISTORY_DAYS = 365;

export function parseChargeAlertThreshold(raw: string): number | null {
  if (raw.trim() === "") return null;
  const cents = parseCentsInput(raw);
  if (cents === null || cents <= 0) throw new Error("Enter an amount above zero, or leave it empty.");
  return cents;
}

export type ChargeRow = {
  id: string;
  name: string;
  merchantName: string | null;
  amountCents: number;
  type: TransactionType;
  currency: string | null;
  date: Date;
  pendingPlaidTransactionId: string | null;
  status: PlaidStagedStatus;
  accountName: string;
};

export type HistoryRow = Pick<ChargeRow, "name" | "merchantName" | "amountCents" | "currency">;

export type ChargeAlert = ChargeRow & { reason: "large" | "unusual"; usualCents?: number };

/** One merchant in one currency: amounts in two currencies are never compared. */
export function merchantKey(row: HistoryRow): string {
  return `${(row.currency ?? "").toUpperCase()}|${(row.merchantName ?? row.name).trim().toLowerCase()}`;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * The newly seen rows worth an email. Only money out the person has not already accounted for:
 * refunds, income and transfers are left out, as are rows auto-linked to an entry they typed
 * themselves, and a posted row replacing a pending one (the pending row was already looked at).
 * The threshold applies in the home currency only; the unusual check compares a merchant with
 * itself, so works in any currency.
 */
export function pickChargeAlerts(
  rows: readonly ChargeRow[],
  history: readonly HistoryRow[],
  options: { thresholdCents: number | null; unusual: boolean; homeCurrency: string },
): ChargeAlert[] {
  const usual = new Map<string, number[]>();
  for (const h of history) {
    if (h.amountCents <= 0) continue;
    const key = merchantKey(h);
    usual.set(key, [...(usual.get(key) ?? []), h.amountCents]);
  }
  const alerts: ChargeAlert[] = [];
  for (const row of rows) {
    if (row.type !== TransactionType.EXPENSE || row.amountCents <= 0) continue;
    if (row.pendingPlaidTransactionId) continue;
    if (row.status !== PlaidStagedStatus.NEEDS_REVIEW && row.status !== PlaidStagedStatus.ADDED) continue;
    const inHomeCurrency = !row.currency || row.currency.toUpperCase() === options.homeCurrency;
    if (options.thresholdCents !== null && inHomeCurrency && row.amountCents >= options.thresholdCents) {
      alerts.push({ ...row, reason: "large" });
      continue;
    }
    if (!options.unusual) continue;
    const past = usual.get(merchantKey(row)) ?? [];
    if (past.length < UNUSUAL_MIN_HISTORY) continue;
    const usualCents = median(past);
    if (row.amountCents >= usualCents * UNUSUAL_MULTIPLE && row.amountCents - usualCents >= UNUSUAL_MIN_EXCESS_CENTS) {
      alerts.push({ ...row, reason: "unusual", usualCents });
    }
  }
  return alerts;
}

const dayLabel = new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", timeZone: "UTC" });

export function renderChargeAlert(
  alerts: readonly ChargeAlert[],
  options: { homeCurrency: string; thresholdCents: number | null; baseUrl?: string },
): { subject: string; text: string } {
  const money = (cents: number, currency: string | null) => formatCurrency(cents, currency ?? options.homeCurrency);
  const label = (a: ChargeAlert) => a.merchantName ?? a.name;
  const first = alerts[0];
  const subject =
    alerts.length === 1
      ? `${first.reason === "large" ? "Large" : "Unusual"} charge: ${money(first.amountCents, first.currency)} at ${label(first)}`
      : `${alerts.length} charges to look at`;
  const lines = ["New from your bank", ""];
  for (const a of alerts) {
    const why =
      a.reason === "large" && options.thresholdCents !== null
        ? `at or over your ${money(options.thresholdCents, options.homeCurrency)} alert`
        : `usually about ${money(a.usualCents ?? 0, a.currency)}`;
    lines.push(`  ${dayLabel.format(a.date)}  ${label(a)}: ${money(a.amountCents, a.currency)} (${a.accountName}), ${why}`);
  }
  lines.push("", "If you don't recognise one, check with your bank. They wait in the review queue on the dashboard.");
  if (options.baseUrl) lines.push(`Open the app: ${options.baseUrl}/`);
  lines.push("", "You get this because charge alerts are on in Settings → Notifications.");
  return { subject, text: lines.join("\n") };
}

type AlertSetting = {
  userId: string;
  thresholdCents: number | null;
  unusual: boolean;
  checkedThrough: Date;
  user: { email: string; countryCode: string };
};

export type ChargeAlertOutcome = "sent" | "none" | "failed";

/** One user's tick: email what is new and worth it, then move the mark past every row looked at. */
export async function sendChargeAlerts(
  setting: AlertSetting,
  now: Date,
  deps: { client?: PrismaClient; send?: typeof sendEmail; baseUrl?: string } = {},
): Promise<ChargeAlertOutcome> {
  const client = deps.client ?? prisma;
  const send = deps.send ?? sendEmail;
  const rows = await client.plaidStagedTransaction.findMany({
    where: { userId: setting.userId, firstSeenAt: { gt: setting.checkedThrough, lte: now } },
    orderBy: [{ firstSeenAt: "asc" }, { date: "asc" }],
    select: {
      id: true,
      name: true,
      merchantName: true,
      amountCents: true,
      type: true,
      currency: true,
      date: true,
      pendingPlaidTransactionId: true,
      status: true,
      firstSeenAt: true,
      plaidAccount: { select: { name: true } },
    },
  });
  if (rows.length === 0) return "none";
  const checkedThrough = rows[rows.length - 1].firstSeenAt;

  const history = setting.unusual
    ? await client.plaidStagedTransaction.findMany({
        where: {
          userId: setting.userId,
          type: TransactionType.EXPENSE,
          isPending: false,
          amountCents: { gt: 0 },
          firstSeenAt: { lte: setting.checkedThrough },
          date: { gte: new Date(now.getTime() - HISTORY_DAYS * 86_400_000) },
          status: { notIn: [PlaidStagedStatus.SUPERSEDED, PlaidStagedStatus.REMOVED_BY_PLAID] },
        },
        select: { name: true, merchantName: true, amountCents: true, currency: true },
      })
    : [];
  const homeCurrency = homeCurrencyOf(setting.user.countryCode);
  const alerts = pickChargeAlerts(
    rows.map(({ plaidAccount, firstSeenAt: _seen, ...row }) => ({ ...row, accountName: plaidAccount.name })),
    history,
    { thresholdCents: setting.thresholdCents, unusual: setting.unusual, homeCurrency },
  );

  if (alerts.length > 0) {
    const { subject, text } = renderChargeAlert(alerts, {
      homeCurrency,
      thresholdCents: setting.thresholdCents,
      baseUrl: deps.baseUrl,
    });
    try {
      if (!(await send({ to: setting.user.email, subject, text })).sent) return "failed";
    } catch (err) {
      console.error("[charge alerts] sending failed", err);
      return "failed";
    }
  }
  await client.chargeAlertSetting.update({ where: { userId: setting.userId }, data: { checkedThrough } });
  return alerts.length > 0 ? "sent" : "none";
}

/** One hourly tick over every user with charge alerts on. */
export async function runChargeAlertSweep(
  now = new Date(),
  deps: { client?: PrismaClient; send?: typeof sendEmail; smtpConfigured?: () => boolean } = {},
): Promise<{ ok: boolean; message: string; sent: number }> {
  if (!(deps.smtpConfigured ?? isSmtpConfigured)()) return { ok: true, message: "Skipped: SMTP is not configured", sent: 0 };
  const client = deps.client ?? prisma;
  const settings = await client.chargeAlertSetting.findMany({
    where: { user: { disabledAt: null }, OR: [{ thresholdCents: { not: null } }, { unusual: true }] },
    select: {
      userId: true,
      thresholdCents: true,
      unusual: true,
      checkedThrough: true,
      user: { select: { email: true, countryCode: true } },
    },
  });
  const baseUrl = process.env.NEXTAUTH_URL?.trim().replace(/\/$/, "");
  let sent = 0;
  let failed = 0;
  for (const setting of settings) {
    const outcome = await sendChargeAlerts(setting, now, { client, send: deps.send, baseUrl });
    if (outcome === "sent") sent += 1;
    if (outcome === "failed") failed += 1;
  }
  return { ok: failed === 0, message: `Sent ${sent} charge alert(s)${failed ? `, ${failed} failed` : ""}`, sent };
}
