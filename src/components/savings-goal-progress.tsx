import Link from "next/link";
import type { ReactNode } from "react";
import { formatCurrency } from "@/lib/money";
import type { GoalStatus } from "@/lib/savings-goals";
import type { SavingsGoalView } from "@/lib/savings-goals-data";

const BAR_TONE: Record<GoalStatus, string> = {
  reached: "bg-emerald-400",
  "on-track": "bg-sky-400",
  open: "bg-sky-400",
  needs: "bg-sky-400",
  behind: "bg-amber-400",
  overdue: "bg-rose-400",
  "no-balance": "bg-slate-600",
};

const STATUS_LABEL: Partial<Record<GoalStatus, { text: string; tone: string }>> = {
  reached: { text: "Reached", tone: "text-emerald-300" },
  "on-track": { text: "On track", tone: "text-sky-300" },
  behind: { text: "Behind", tone: "text-amber-300" },
  overdue: { text: "Past its date", tone: "text-rose-300" },
};

export function formatGoalDate(ymd: string, withDay = true) {
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    ...(withDay ? { day: "numeric" } : {}),
    year: "numeric",
    timeZone: "UTC",
  });
}

/** One sentence on what the goal needs next, from its status. */
function goalAdvice(goal: SavingsGoalView): ReactNode {
  const fmt = (cents: number) => formatCurrency(cents, goal.currency);
  const p = goal.progress;
  const pace =
    p.monthlyPaceCents === null
      ? null
      : p.monthlyPaceCents > 0
        ? `the balance has grown about ${fmt(p.monthlyPaceCents)} a month lately`
        : "the balance hasn't grown lately";
  switch (p.status) {
    case "reached":
      return "You've saved the full amount.";
    case "no-balance":
      return (
        <>
          {goal.account?.name ?? "The account"} has no balance yet.{" "}
          <Link href="/settings/accounts" className="text-sky-300 underline-offset-2 hover:underline">
            Add one in Accounts
          </Link>
          .
        </>
      );
    case "overdue":
      return `${fmt(p.remainingCents)} still to go.`;
    case "open":
      return p.projectedYmd
        ? `${fmt(p.remainingCents)} to go; at the recent pace, about ${formatGoalDate(p.projectedYmd, false)}.`
        : `${fmt(p.remainingCents)} to go.`;
    case "needs":
    case "on-track":
    case "behind": {
      const needed = `Needs ${fmt(p.monthlyNeededCents ?? 0)} a month to make ${formatGoalDate(goal.targetYmd ?? "")}`;
      return pace ? `${needed}; ${pace}.` : `${needed}.`;
    }
  }
}

/** A goal's amounts, bar and next step. Shared by the Insights card and Settings. */
export function SavingsGoalProgress({ goal }: { goal: SavingsGoalView }) {
  const fmt = (cents: number) => formatCurrency(cents, goal.currency);
  const p = goal.progress;
  const label = STATUS_LABEL[p.status];
  const percent = Math.round(p.fraction * 100);
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm">
        <span className="text-slate-200">
          {p.savedCents === null ? "—" : fmt(p.savedCents)} <span className="text-slate-500">of {fmt(goal.targetCents)}</span>
        </span>
        <span className="text-xs text-slate-400">
          {label ? <span className={`mr-2 font-medium ${label.tone}`}>{label.text}</span> : null}
          {percent}%
        </span>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-slate-800"
        role="progressbar"
        aria-label={`${goal.name} progress`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div className={`h-full rounded-full ${BAR_TONE[p.status]}`} style={{ width: `${percent}%` }} />
      </div>
      <p className="text-xs text-slate-400" data-testid="goal-advice">
        {goalAdvice(goal)}
      </p>
    </div>
  );
}

/** Where a goal's progress comes from, and its date, for the line under its name. */
export function goalSubtitle(goal: SavingsGoalView): string {
  const source = goal.account ? `Follows ${goal.account.name}${goal.account.archived ? " (archived)" : ""}` : "Tracked by hand";
  return goal.targetYmd ? `${source} · by ${formatGoalDate(goal.targetYmd)}` : `${source} · no date`;
}
