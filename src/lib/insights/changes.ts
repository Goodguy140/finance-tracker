import type { RecurringCadence } from "@prisma/client";
import { advanceRecurringDate } from "@/lib/recurring-transactions";
import { factsOf } from "./facts";
import { CADENCE_WORDS, classifyCadence, merchantGroups, MIN_REGULAR_SHARE, seriesAnchor, seriesOf } from "./recurring-detection";
import type { Insight, InsightRecurringRule, InsightTx } from "./types";
import { daysBetween, median, wholeDaysSince, type MoneyFormatter } from "./util";

/**
 * Something regular that changed: pay that did not come or came in short, a recurring entry
 * whose charges stopped, a new subscription, a bill far above its usual.
 *
 * Each key carries the date it is about, so dismissing one does not hide the next time.
 */
export type ChangesInput = {
  txs: InsightTx[];
  rules: InsightRecurringRule[];
  now: Date;
  fmt: MoneyFormatter;
};

export function detectChanges(input: ChangesInput): Insight[] {
  const groups = merchantGroups(input.txs);
  return [...payChanges(groups, input), ...stoppedRules(input), ...newSubscriptions(input), ...unusualCharges(groups, input)];
}

const shortDate = new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", timeZone: "UTC" });
const ymd = (d: Date) => d.toISOString().slice(0, 10);

// --- Missed or smaller pay -------------------------------------------------------------------

/** Days past the expected date before pay counts as late: weekends and bank holidays. */
const PAY_GRACE_DAYS: Partial<Record<RecurringCadence, number>> = { WEEKLY: 3, BIWEEKLY: 4, SEMI_MONTHLY: 4, MONTHLY: 5 };
/** Pay this far below its usual is worth a word, if the gap is at least the minimum too. */
const PAY_SHORT_PCT = 0.15;
const PAY_SHORT_MIN_CENTS = 5_000;

function payChanges(groups: Map<string, InsightTx[]>, { now, fmt }: ChangesInput): Insight[] {
  const out: Insight[] = [];
  for (const list of groups.values()) {
    if (list[0].type !== "INCOME") continue;
    const series = seriesOf(list);
    if (!series) continue;
    const grace = PAY_GRACE_DAYS[series.band.cadence];
    if (grace === undefined) continue;
    const { band, txs } = series;
    const last = txs[txs.length - 1];
    const { merchantKey, merchantLabel } = factsOf(last);
    const every = CADENCE_WORDS[band.cadence];
    const expected = advanceRecurringDate(last.date, band.cadence, seriesAnchor(series, last.date));
    const late = wholeDaysSince(expected, now);
    // Late, but not so long ago that the job, or the account it is paid into, plainly changed.
    if (late > grace && late <= band.typicalDays) {
      out.push({
        key: `pay:missed:${merchantKey}:${ymd(expected)}`,
        section: "ahead",
        severity: "high",
        title: `No pay from ${merchantLabel} since ${shortDate.format(last.date)}`,
        body:
          `It usually comes ${every}, about ${fmt(series.medianAmountCents)}, so the next was due around ` +
          `${shortDate.format(expected)}. If it now goes to an account you don't log here, dismiss this.`,
        evidenceTxIds: [last.id],
      });
      continue;
    }
    // The last pay against the ones before it, while it is still the latest news.
    const usual = median(txs.slice(0, -1).map((tx) => tx.amountCents));
    const short = usual - last.amountCents;
    if (daysBetween(last.date, now) <= band.typicalDays && short >= PAY_SHORT_MIN_CENTS && short >= usual * PAY_SHORT_PCT) {
      out.push({
        key: `pay:short:${merchantKey}:${ymd(last.date)}`,
        section: "ahead",
        severity: "medium",
        title: `Pay from ${merchantLabel} came in ${fmt(short)} short`,
        body: `${fmt(last.amountCents)} on ${shortDate.format(last.date)}, against about ${fmt(usual)} ${every} before it. Worth checking the pay stub.`,
        monthlyCents: short,
        evidenceTxIds: [last.id],
      });
    }
  }
  return out;
}

// --- A recurring entry whose charges stopped -------------------------------------------------

/** Typical days per cycle, for the cadences a year of history can show stopping. */
const CYCLE_DAYS: Partial<Record<RecurringCadence, number>> = { WEEKLY: 7, BIWEEKLY: 14, SEMI_MONTHLY: 15.2, MONTHLY: 30.4, QUARTERLY: 91 };
/** Missed half a cycle past the next due date: the same test as a series being over. */
const STOPPED_AFTER_CYCLES = 1.5;
/** Only charges that kept coming before: one posting is not a pattern that stopped. */
const STOPPED_MIN_LINKED = 2;

function stoppedRules({ txs, rules, now }: ChangesInput): Insight[] {
  const linked = new Map<string, InsightTx[]>();
  for (const tx of txs) {
    if (!tx.recurringTransactionId) continue;
    linked.set(tx.recurringTransactionId, [...(linked.get(tx.recurringTransactionId) ?? []), tx]);
  }
  return rules.flatMap((rule): Insight[] => {
    const cycle = CYCLE_DAYS[rule.cadence];
    const charges = linked.get(rule.id);
    if (!rule.enabled || rule.type !== "EXPENSE" || !cycle || !charges || charges.length < STOPPED_MIN_LINKED) return [];
    const last = charges.reduce((a, b) => (b.date > a.date ? b : a));
    if (daysBetween(last.date, now) <= cycle * STOPPED_AFTER_CYCLES) return [];
    return [
      {
        key: `rule:stopped:${rule.id}:${ymd(last.date)}`,
        section: "recurring",
        severity: "medium",
        title: `${rule.name} may have stopped`,
        body:
          `Its last charge was on ${shortDate.format(last.date)}, and it usually comes ${CADENCE_WORDS[rule.cadence]}. ` +
          `If you cancelled it, turn the recurring entry off so upcoming bills and your score stay accurate.`,
        evidenceTxIds: [last.id],
      },
    ];
  });
}

// --- A new subscription ----------------------------------------------------------------------

/** How recent a first charge has to be to count as new. */
const NEW_SUBSCRIPTION_DAYS = 35;
/** A first charge this small next to the latest was a trial or intro price. */
const TRIAL_SHARE = 0.25;

function newSubscriptions({ txs, now, fmt }: ChangesInput): Insight[] {
  const byService = new Map<string, InsightTx[]>();
  for (const tx of txs) {
    const service = factsOf(tx).streamingService;
    if (tx.type !== "EXPENSE" || !service || tx.amountCents <= 0) continue;
    byService.set(service, [...(byService.get(service) ?? []), tx]);
  }
  const out: Insight[] = [];
  for (const [service, charges] of byService) {
    const sorted = [...charges].sort((a, b) => a.date.getTime() - b.date.getTime());
    const first = sorted[0];
    const latest = sorted[sorted.length - 1];
    if (daysBetween(first.date, now) > NEW_SUBSCRIPTION_DAYS) continue;
    const trial = sorted.length > 1 && first.amountCents <= latest.amountCents * TRIAL_SHARE;
    out.push({
      key: `subscription:new:${service}:${ymd(first.date)}`,
      section: "recurring",
      severity: "low",
      title: trial ? `${service} went from ${fmt(first.amountCents)} to ${fmt(latest.amountCents)}` : `New: ${service}`,
      body: trial
        ? `The trial or intro price ended on ${shortDate.format(latest.date)}. If you meant to try it only, cancel before the next charge.`
        : `First charged ${fmt(first.amountCents)} on ${shortDate.format(first.date)}. If it was a free trial ending, it will keep charging until cancelled.`,
      annualCents: latest.amountCents * 12,
      evidenceTxIds: sorted.map((tx) => tx.id).reverse(),
    });
  }
  return out;
}

// --- An unusually large charge at a regular merchant -----------------------------------------

// A bill that comes on a schedule, whatever its amount does (hydro varies with the season): a
// big shop at a store visited now and then is not news.

/** Charges before it, to know what usual is. */
const UNUSUAL_MIN_HISTORY = 4;
const UNUSUAL_RECENT_DAYS = 35;
const UNUSUAL_FACTOR = 1.8;
const UNUSUAL_MIN_EXTRA_CENTS = 5_000;

function unusualCharges(groups: Map<string, InsightTx[]>, { now, fmt }: ChangesInput): Insight[] {
  const out: Insight[] = [];
  for (const list of groups.values()) {
    if (list[0].type !== "EXPENSE" || list.length <= UNUSUAL_MIN_HISTORY) continue;
    const sorted = [...list].sort((a, b) => a.date.getTime() - b.date.getTime());
    const latest = sorted[sorted.length - 1];
    if (daysBetween(latest.date, now) > UNUSUAL_RECENT_DAYS) continue;
    const gaps = sorted.slice(1).map((tx, i) => daysBetween(sorted[i].date, tx.date));
    const cadence = classifyCadence(gaps);
    if (!cadence || cadence.regularShare < MIN_REGULAR_SHARE) continue;
    const before = sorted.slice(0, -1).map((tx) => tx.amountCents);
    const usual = median(before);
    const extra = latest.amountCents - usual;
    // Above anything before it, too: a merchant that sometimes bills big is not news.
    if (latest.amountCents < usual * UNUSUAL_FACTOR || extra < UNUSUAL_MIN_EXTRA_CENTS || latest.amountCents <= Math.max(...before)) continue;
    const { merchantKey, merchantLabel } = factsOf(latest);
    out.push({
      key: `unusual:${merchantKey}:${latest.id}`,
      section: "saving",
      severity: "medium",
      title: `${merchantLabel} ${fmt(latest.amountCents)}, usually about ${fmt(usual)}`,
      body: `On ${shortDate.format(latest.date)}, the largest of its ${sorted.length} charges. Worth checking it is right.`,
      evidenceTxIds: [latest.id],
    });
  }
  return out;
}
