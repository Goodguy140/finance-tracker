import type { RecurringCadence } from "@prisma/client";
import { dateFromYmd, ymdFromDateUtc } from "@/lib/date-only";
import type { Insight } from "@/lib/insights/types";
import type { MoneyFormatter } from "@/lib/insights/util";

/**
 * The subscription cancel helper. A recurring expense can carry where to cancel it
 * (`cancelUrl`: a link or a note such as "call 1-800…") and a "decide by" date (`decideBy`):
 * when a free trial turns paid or an annual plan renews. The bill-reminder email warns before
 * that date, once per date (`decideRemindedFor`). "Cancel subscription" on the Recurring card
 * turns the rule off and records `cancelledAt`; for 90 days Insights shows what it saves a year
 * under Going well. The app cannot cancel anything itself: it only stops the "forgot to cancel".
 */

export const MAX_CANCEL_URL_LENGTH = 500;
export const CANCELLED_INSIGHT_DAYS = 90;

const PER_YEAR: Record<RecurringCadence, number> = {
  WEEKLY: 52,
  BIWEEKLY: 26,
  SEMI_MONTHLY: 24,
  MONTHLY: 12,
  QUARTERLY: 4,
  YEARLY: 1,
  BIENNIAL: 0.5,
};

export function annualCostCents(amountCents: number, cadence: RecurringCadence): number {
  return Math.round(amountCents * PER_YEAR[cadence]);
}

/** A cancel note that is a web address is shown as a link; anything else as text. */
export function cancelLinkHref(cancelUrl: string | null): string | null {
  if (!cancelUrl) return null;
  return /^https?:\/\/\S+$/i.test(cancelUrl.trim()) ? cancelUrl.trim() : null;
}

/** Reads the two optional form fields; throws a readable message for a bad value. */
export function parseCancelFields(raw: { cancelUrl: string; decideBy: string }): {
  cancelUrl: string | null;
  decideBy: Date | null;
} {
  const cancelUrl = raw.cancelUrl.trim();
  if (cancelUrl.length > MAX_CANCEL_URL_LENGTH) {
    throw new Error(`Keep the cancel link or note under ${MAX_CANCEL_URL_LENGTH} characters.`);
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(cancelUrl) && !/^https?:/i.test(cancelUrl) && !/^tel:/i.test(cancelUrl)) {
    throw new Error("A cancel link must start with http:// or https://.");
  }
  const decideBy = raw.decideBy.trim();
  if (decideBy && !/^\d{4}-\d{2}-\d{2}$/.test(decideBy)) throw new Error("Choose a valid decide-by date.");
  return { cancelUrl: cancelUrl || null, decideBy: decideBy ? dateFromYmd(decideBy) : null };
}

export type DecisionRule = {
  id: string;
  name: string;
  amountCents: number;
  cadence: RecurringCadence;
  enabled: boolean;
  decideBy: Date | null;
  decideRemindedFor: Date | null;
  cancelUrl: string | null;
};

export type DecisionReminder = { ruleId: string; name: string; decideBy: Date; cents: number; cancelUrl: string | null };

/** Enabled rules whose decide-by date is today or within `days`, not yet reminded for that date. */
export function dueDecisionReminders(rules: readonly DecisionRule[], todayYmd: string, days: number): DecisionReminder[] {
  const end = dateFromYmd(todayYmd);
  end.setUTCDate(end.getUTCDate() + days);
  const endYmd = ymdFromDateUtc(end);
  return rules
    .filter((r) => {
      if (!r.enabled || !r.decideBy) return false;
      const ymd = ymdFromDateUtc(r.decideBy);
      if (ymd < todayYmd || ymd > endYmd) return false;
      return !r.decideRemindedFor || r.decideRemindedFor.getTime() !== r.decideBy.getTime();
    })
    .sort((a, b) => a.decideBy!.getTime() - b.decideBy!.getTime())
    .map((r) => ({ ruleId: r.id, name: r.name, decideBy: r.decideBy!, cents: r.amountCents, cancelUrl: r.cancelUrl }));
}

/** Going well: a subscription cancelled in the last 90 days, and what it no longer costs a year. */
export function cancelledSubscriptionInsights(
  rules: ReadonlyArray<{ id: string; name: string; amountCents: number; cadence: RecurringCadence; enabled: boolean; cancelledAt?: Date | null }>,
  now: Date,
  fmt: MoneyFormatter,
): Insight[] {
  const since = now.getTime() - CANCELLED_INSIGHT_DAYS * 86_400_000;
  return rules
    .filter((r) => !r.enabled && r.cancelledAt && r.cancelledAt.getTime() >= since && r.cancelledAt.getTime() <= now.getTime())
    .map((r) => {
      const annual = annualCostCents(r.amountCents, r.cadence);
      return {
        key: `good:cancelled:${r.id}`,
        section: "good" as const,
        severity: "low" as const,
        title: `Cancelled ${r.name}: saving ${fmt(annual)} a year`,
        body: `You cancelled it on ${ymdFromDateUtc(r.cancelledAt!)}; that is ${fmt(r.amountCents)} a charge you no longer pay.`,
        annualCents: annual,
        evidenceTxIds: [],
      };
    });
}
