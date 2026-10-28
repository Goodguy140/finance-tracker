import crypto from "crypto";
import type { PrismaClient, RecurringTransaction } from "@prisma/client";
import { forecastRecurringOccurrences } from "./bills-forecast";
import { dateFromYmd, ymdFromDateUtc } from "./date-only";
import { formatCurrency } from "./money";
import { currentYmdInTimeZone, currentYmInTimeZone } from "./period-month";
import { prisma } from "./prisma";

/**
 * A private calendar link (Settings → Notifications) that Google, Apple and Outlook calendars
 * subscribe to: each recurring bill, pay and transfer for the next year, and each
 * subscription's decide-by date, as all-day events with the amount in the title.
 *
 * Calendar apps fetch it from their own servers with no session, so the secret in the URL
 * is the whole of its security: 256 random bits, stored only as a SHA-256 hash (as personal
 * access tokens are), shown once, and replaced or turned off from Settings.
 */

const RAW_PREFIX = "cal_";
/** How far ahead the feed lists occurrences. */
export const CALENDAR_FEED_DAYS = 365;

export function hashCalendarFeedToken(raw: string): string {
  return crypto.createHash("sha256").update(raw, "utf8").digest("hex");
}

export function generateCalendarFeedToken(): { raw: string; hash: string } {
  const raw = RAW_PREFIX + crypto.randomBytes(32).toString("base64url");
  return { raw, hash: hashCalendarFeedToken(raw) };
}

/** The path a calendar app subscribes to; the page adds its own origin. */
export function calendarFeedPath(raw: string): string {
  return `/api/calendar/${raw}.ics`;
}

export type CalendarEvent = {
  /** Stable across fetches, so a calendar updates an event rather than adding a copy. */
  uid: string;
  /** `YYYY-MM-DD`: every event is all day. */
  dateYmd: string;
  summary: string;
  description?: string;
};

/** RFC 5545 TEXT: backslash, semicolon, comma and newlines are escaped. */
export function escapeIcsText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Lines longer than 75 octets continue on the next line after a CRLF and a space. */
export function foldIcsLine(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let currentBytes = 0;
  for (const char of line) {
    const size = Buffer.byteLength(char, "utf8");
    // The first line holds 75 octets; each continuation holds 74 after its leading space.
    const limit = parts.length === 0 ? 75 : 74;
    if (currentBytes + size > limit) {
      parts.push(current);
      current = "";
      currentBytes = 0;
    }
    current += char;
    currentBytes += size;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

function icsDate(ymd: string): string {
  return ymd.replace(/-/g, "");
}

function icsTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** A whole VCALENDAR. All-day events end the day after they start, as the spec has it. */
export function buildCalendarIcs(events: readonly CalendarEvent[], now: Date, name = "Finance Tracker"): string {
  const stamp = icsTimestamp(now);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Finance Tracker//Bills and pay//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(name)}`,
    // How often to check back; Google ignores it and picks its own interval.
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
    "X-PUBLISHED-TTL:PT6H",
  ];
  for (const event of events) {
    const end = dateFromYmd(event.dateYmd);
    end.setUTCDate(end.getUTCDate() + 1);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${event.uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(event.dateYmd)}`,
      `DTEND;VALUE=DATE:${icsDate(ymdFromDateUtc(end))}`,
      `SUMMARY:${escapeIcsText(event.summary)}`,
      ...(event.description ? [`DESCRIPTION:${escapeIcsText(event.description)}`] : []),
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}

export type CalendarFeedRule = Pick<
  RecurringTransaction,
  | "id"
  | "type"
  | "name"
  | "amountCents"
  | "cadence"
  | "nextExpectedDate"
  | "anchorDay"
  | "secondAnchorDay"
  | "beforeWeekend"
  | "endDate"
  | "enabled"
  | "decideBy"
  | "cancelUrl"
  | "note"
> & {
  account: { name: string; currency: string };
  transferAccount: { name: string } | null;
};

/**
 * The feed's events: every enabled rule's occurrences from today through `days` ahead (an
 * unposted one from earlier this month is left out: a calendar is for what is coming), and
 * each enabled bill's decide-by date from today on.
 */
export function calendarFeedEvents(
  rules: readonly CalendarFeedRule[],
  options: { todayYmd: string; currentYm: string; days?: number },
): CalendarEvent[] {
  const forecast = forecastRecurringOccurrences(rules, {
    todayYmd: options.todayYmd,
    currentYm: options.currentYm,
    days: options.days ?? CALENDAR_FEED_DAYS,
    includeTransfers: true,
  });
  const events: CalendarEvent[] = [];
  for (const { rule, date, overdue } of forecast.occurrences) {
    if (overdue) continue;
    const dateYmd = ymdFromDateUtc(date);
    const amount = formatCurrency(rule.amountCents, rule.account.currency);
    const summary =
      rule.type === "INCOME"
        ? `${rule.name} +${amount}`
        : rule.type === "TRANSFER"
          ? `${rule.name} ${amount} to ${rule.transferAccount?.name ?? "another account"}`
          : `${rule.name} ${amount}`;
    const what = rule.type === "INCOME" ? "Income into" : rule.type === "TRANSFER" ? "Transfer from" : "Bill from";
    events.push({
      uid: `${rule.id}-${dateYmd}@finance-tracker`,
      dateYmd,
      summary,
      description: [`${what} ${rule.account.name}.`, rule.note].filter(Boolean).join("\n"),
    });
  }
  for (const rule of rules) {
    if (!rule.enabled || rule.type !== "EXPENSE" || !rule.decideBy) continue;
    const dateYmd = ymdFromDateUtc(rule.decideBy);
    if (dateYmd < options.todayYmd) continue;
    const amount = formatCurrency(rule.amountCents, rule.account.currency);
    events.push({
      uid: `${rule.id}-decide-${dateYmd}@finance-tracker`,
      dateYmd,
      summary: `Decide: keep ${rule.name}? (${amount})`,
      description: [
        "A free trial turning paid or a plan renewing. Cancel it before today if you don't want it.",
        rule.cancelUrl ? `Where to cancel: ${rule.cancelUrl}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
    });
  }
  return events.sort((a, b) => a.dateYmd.localeCompare(b.dateYmd) || a.summary.localeCompare(b.summary));
}

/**
 * The calendar for the link `raw`, or null when no feed has that secret (never made, replaced
 * or turned off). Notes when it was fetched, so Settings can show the link is in use.
 */
export async function calendarFeedForToken(raw: string, now = new Date(), client: PrismaClient = prisma): Promise<string | null> {
  if (!raw.startsWith(RAW_PREFIX)) return null;
  const feed = await client.calendarFeed.findUnique({
    where: { tokenHash: hashCalendarFeedToken(raw) },
    include: { user: { select: { id: true, timezone: true, disabledAt: true } } },
  });
  // A suspended account's link stops along with its sign-in and API tokens.
  if (!feed || feed.user.disabledAt) return null;
  const rules = await client.recurringTransaction.findMany({
    where: { userId: feed.user.id, enabled: true },
    include: { account: { select: { name: true, currency: true } }, transferAccount: { select: { name: true } } },
  });
  const events = calendarFeedEvents(rules, {
    todayYmd: currentYmdInTimeZone(feed.user.timezone, now),
    currentYm: currentYmInTimeZone(feed.user.timezone, now),
  });
  await client.calendarFeed.update({ where: { userId: feed.userId }, data: { lastFetchedAt: now } });
  return buildCalendarIcs(events, now);
}
