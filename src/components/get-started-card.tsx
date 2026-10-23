import Link from "next/link";
import { dismissGetStartedAction } from "@/app/actions";
import { ServerActionForm } from "@/components/server-action-form";
import type { GetStartedStep } from "@/lib/get-started";

/** First-run checklist above the dashboard; each step ticks itself off from the user's data. */
export function GetStartedCard({ steps }: { steps: GetStartedStep[] }) {
  const done = steps.filter((step) => step.done).length;
  return (
    <section
      aria-labelledby="get-started-title"
      data-testid="get-started"
      className="mb-3 rounded-2xl border border-sky-500/30 bg-sky-950/20 p-3 sm:p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="get-started-title" className="text-lg font-semibold text-slate-100">
            Get started
          </h2>
          <p className="text-xs text-slate-400">
            {done} of {steps.length} done. This goes away once they all are.
          </p>
        </div>
        <ServerActionForm action={dismissGetStartedAction}>
          <button type="submit" className="text-xs text-slate-400 underline-offset-4 hover:text-slate-200 hover:underline">
            Hide
          </button>
        </ServerActionForm>
      </div>
      <ol className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {steps.map((step) => (
          <li
            key={step.id}
            data-testid={`get-started-${step.id}`}
            data-done={step.done ? "true" : "false"}
            className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 ${
              step.done ? "border-emerald-500/25 bg-emerald-950/15" : "border-slate-800 bg-slate-900/60"
            }`}
          >
            <span
              aria-hidden
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs ${
                step.done ? "border-emerald-400/60 bg-emerald-500/20 text-emerald-200" : "border-slate-600 text-transparent"
              }`}
            >
              ✓
            </span>
            <span className="min-w-0 flex-1">
              <span className={`block text-sm font-medium ${step.done ? "text-slate-400 line-through" : "text-slate-100"}`}>
                {step.label}
                <span className="sr-only">{step.done ? " (done)" : ""}</span>
              </span>
              {step.done ? null : (
                <>
                  <span className="mt-0.5 block text-xs text-slate-400">{step.hint}</span>
                  <Link href={step.href} className="mt-1 inline-block text-xs font-medium text-sky-300 hover:text-sky-200">
                    {step.action} →
                  </Link>
                </>
              )}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
