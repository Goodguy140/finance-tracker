import Link from "next/link";
import { SavingsGoalProgress, goalSubtitle } from "@/components/savings-goal-progress";
import type { SavingsGoalView } from "@/lib/savings-goals-data";

/** The user's savings goals on Insights; they are set up and edited in Settings. */
export function SavingsGoalsCard({ goals }: { goals: SavingsGoalView[] }) {
  return (
    <section
      aria-labelledby="insights-goals"
      className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 lg:p-5"
      data-testid="savings-goals-card"
    >
      <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="insights-goals" className="text-lg font-semibold">
            Savings goals
            {goals.length ? <span className="ml-2 text-sm font-normal text-slate-500">{goals.length}</span> : null}
          </h2>
          <p className="mt-0.5 text-sm text-slate-400">How far along you are, and what each needs a month to make its date.</p>
        </div>
        <Link href="/settings/goals" className="text-sm text-sky-300 underline-offset-2 hover:underline">
          {goals.length ? "Manage" : "Set one up"}
        </Link>
      </header>
      {goals.length ? (
        <ul className="space-y-4">
          {goals.map((goal) => (
            <li key={goal.id} className="space-y-1.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <p className="text-sm font-medium text-slate-100">{goal.name}</p>
                <p className="text-xs text-slate-500">{goalSubtitle(goal)}</p>
              </div>
              <SavingsGoalProgress goal={goal} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-500">No goals yet. Add one in Settings to track it here.</p>
      )}
    </section>
  );
}
