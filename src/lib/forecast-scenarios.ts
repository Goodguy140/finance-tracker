import type { RecurringCadence } from "@prisma/client";
import { dateFromYmd, ymdFromDateUtc } from "./date-only";
import type { ProjectableRule } from "./projected-balances";
import { advanceRecurringDateOnOrAfter, recurringAnchor, recurringAnchorDay } from "./recurring-transactions";

/**
 * What-if scenarios on the projected balances: changes tried against the recurring rules
 * before they are projected, held only in the browser. Nothing here is saved.
 *
 * - `add`: a new recurring bill or income from a date (a car payment from March).
 * - `income`: every recurring income changed by a percentage from a date (a 5% raise). The
 *   rule keeps its old amount up to the day before and the new one from its first occurrence on
 *   or after the date.
 * - `remove`: rules taken out entirely (cancel three subscriptions).
 */
export type ScenarioChange =
  | {
      kind: "add";
      name: string;
      type: "EXPENSE" | "INCOME";
      amountCents: number;
      cadence: RecurringCadence;
      startYmd: string;
      accountId: string;
    }
  | { kind: "income"; pct: number; fromYmd: string }
  | { kind: "remove"; ruleIds: string[] };

export const SCENARIO_DAYS = [30, 90, 180, 365] as const;

function dayBefore(ymd: string): Date {
  const d = dateFromYmd(ymd);
  d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

export function applyScenario(rules: readonly ProjectableRule[], changes: readonly ScenarioChange[]): ProjectableRule[] {
  let out = [...rules];
  for (const change of changes) {
    if (change.kind === "remove") {
      const gone = new Set(change.ruleIds);
      out = out.filter((r) => !r.id || !gone.has(r.id));
    } else if (change.kind === "add") {
      if (change.amountCents <= 0) continue;
      const start = dateFromYmd(change.startYmd);
      out.push({
        id: `scenario:${out.length}`,
        name: change.name || (change.type === "INCOME" ? "New income" : "New bill"),
        type: change.type,
        amountCents: change.amountCents,
        cadence: change.cadence,
        nextExpectedDate: start,
        anchorDay: start.getUTCDate(),
        endDate: null,
        enabled: true,
        accountId: change.accountId,
        transferAccountId: null,
      });
    } else if (change.kind === "income" && change.pct !== 0) {
      const from = dateFromYmd(change.fromYmd);
      out = out.flatMap((r) => {
        if (r.type !== "INCOME" || !r.enabled) return [r];
        if (r.endDate && ymdFromDateUtc(r.endDate) < change.fromYmd) return [r];
        const amountCents = Math.max(0, Math.round(r.amountCents * (1 + change.pct / 100)));
        const anchorDay = recurringAnchorDay(r);
        const firstChanged = advanceRecurringDateOnOrAfter(r.nextExpectedDate, r.cadence, from, recurringAnchor(r));
        if (ymdFromDateUtc(r.nextExpectedDate) >= change.fromYmd) return [{ ...r, amountCents }];
        return [
          { ...r, endDate: dayBefore(change.fromYmd) },
          { ...r, id: r.id ? `${r.id}:changed` : undefined, nextExpectedDate: firstChanged, anchorDay, amountCents },
        ];
      });
    }
  }
  return out;
}
