import { shiftYm } from "@/lib/dashboard-period";
import { moneyFormatter, printMonthShort, printYmd } from "./format";
import { INK, PrintDoc, type ChecklistItem } from "./pdf-doc";
import {
  carriedCards,
  horizonEndYmd,
  monthsText,
  nextSteps,
  PLAN_HORIZON_LABELS,
  PLAN_HORIZONS,
  PLAN_RANGE_OPTIONS,
  stepsInRange,
  type ActionPlan,
  type PlanStep,
} from "./action-plan";

/** The action plan as a PDF: where things stand, the first three steps, then a checklist per horizon. */
export async function renderActionPlanPdf(plan: ActionPlan, displayName: string | null): Promise<Uint8Array> {
  const fmt = moneyFormatter(plan.currency);
  const filled = plan.mode === "filled";
  const rangeLabel = PLAN_RANGE_OPTIONS.find((o) => o.value === plan.range)!.label;
  const doc = await PrintDoc.create({
    title: `Financial action plan, ${rangeLabel.toLowerCase()}`,
    footer: filled
      ? `Action plan${displayName ? ` for ${displayName}` : ""}, made ${printYmd(plan.todayYmd)} from your data. Amounts in ${plan.currency}. Reprint it in a few months to see what moved.`
      : `Financial action plan. Amounts in ${plan.currency}.`,
  });

  const facts = plan.facts;
  doc.title("Financial action plan", [
    `${filled && displayName ? `${displayName}  |  ` : ""}${rangeLabel}  |  ${printYmd(plan.todayYmd)}`,
    filled
      ? facts && facts.monthsMeasured > 0
        ? `Worked out from ${printMonthShort(shiftYm(plan.todayYmd.slice(0, 7), -facts.monthsMeasured))} to ${printMonthShort(shiftYm(plan.todayYmd.slice(0, 7), -1))}. Tick each step as you do it; ticked ones are already done.`
        : "Worked out from what the app knows so far. Tick each step as you do it; ticked ones are already done."
      : "Tick each step as you do it, and add your own on the empty lines.",
  ]);

  const step = (s: PlanStep, marker?: string): ChecklistItem => ({
    title: s.title,
    detail: s.detail || undefined,
    area: s.area,
    meta: [s.amountCents ? `${fmt(s.amountCents)}${s.per ? ` a ${s.per}` : ""}` : "", s.byYmd ? `by ${printYmd(s.byYmd)}` : ""].filter(Boolean),
    checked: s.done,
    marker,
  });

  if (filled && facts) {
    const score = facts.score;
    const covered = facts.emergencyFundCents !== null && facts.avgSpendingCents > 0 ? facts.emergencyFundCents / facts.avgSpendingCents : null;
    // A card cleared every statement is spending in transit, not debt.
    const debts = [...carriedCards(facts), ...facts.loans];
    const owed = debts.reduce((s, d) => s + d.balanceCents, 0);
    const rate = facts.avgIncomeCents > 0 ? facts.avgSavedCents / facts.avgIncomeCents : null;
    doc.tiles([
      { label: "Financial score", value: score.status === "scored" ? `${score.score} / 100` : "Not yet", note: score.status === "scored" ? score.band : "Needs a full month" },
      {
        label: "Emergency fund",
        value: covered === null ? "Unknown" : monthsText(covered),
        note: facts.emergencyFundCents === null ? "No balances yet" : fmt(facts.emergencyFundCents),
        color: covered !== null && covered < 1 ? INK.negative : undefined,
      },
      {
        label: "Saved a month",
        value: facts.monthsMeasured ? fmt(facts.avgSavedCents) : "-",
        note: rate === null ? undefined : `${Math.round(rate * 100)}% of income`,
        color: facts.avgSavedCents < 0 ? INK.negative : undefined,
      },
      { label: "Cards and loans", value: fmt(owed), note: owed ? `${debts.length} carried` : "Nothing carried" },
    ]);

    const first = nextSteps(stepsInRange(plan));
    if (first.length) {
      doc.section("Start here", "The most pressing steps, wherever they sit in the plan.", 90);
      doc.checklist(first.map((s, i) => step(s, String(i + 1))));
    }
  } else {
    doc.section("Where I am today", undefined, 100);
    doc.writeLines(["Income a month", "Spending a month", "Emergency fund", "Owed on cards and loans", "Saved a month", "Net worth"], { columns: 2 });
  }

  const steps = stepsInRange(plan);
  for (const horizon of PLAN_HORIZONS.filter((h) => h <= plan.range)) {
    const list = steps.filter((s) => s.horizon === horizon);
    const previous = PLAN_HORIZONS[PLAN_HORIZONS.indexOf(horizon) - 1];
    const note =
      horizon === 24
        ? `From ${printYmd(horizonEndYmd(plan.todayYmd, 12))} on.`
        : `Done by ${printYmd(horizonEndYmd(plan.todayYmd, horizon))}${previous ? `, after the ${previous}-month list` : ""}.`;
    doc.section(PLAN_HORIZON_LABELS[horizon], note, 70);
    if (filled && !list.length) doc.paragraph("Nothing pressing here. Add your own below.", { size: 9.5, color: INK.muted });
    doc.checklist(list.map((s) => step(s)), { writeIn: filled ? 2 : 3 });
  }

  if (!filled) {
    doc.section("What I'm working toward", undefined, 80);
    doc.writeLines(["Goal", "By when", "Amount needed", "Each month"], { columns: 2 });
  }
  return doc.finish();
}

