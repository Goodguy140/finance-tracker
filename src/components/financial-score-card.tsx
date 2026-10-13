import { EMERGENCY_FUND_TARGET_MONTHS, scoreBand, type FinancialScore, type FinancialScoreBand } from "@/lib/financial-score";
import { formatYmShortLabel } from "@/lib/dashboard-period";

/** Ring and bar colour per band; the band's name is always printed beside it. */
const BAND_TONE: Record<FinancialScoreBand, { stroke: string; bar: string; text: string }> = {
  Strong: { stroke: "stroke-emerald-400", bar: "bg-emerald-400", text: "text-emerald-300" },
  Good: { stroke: "stroke-sky-400", bar: "bg-sky-400", text: "text-sky-300" },
  Fair: { stroke: "stroke-yellow-300", bar: "bg-yellow-300", text: "text-yellow-200" },
  "Needs work": { stroke: "stroke-amber-400", bar: "bg-amber-400", text: "text-amber-300" },
  "At risk": { stroke: "stroke-rose-400", bar: "bg-rose-400", text: "text-rose-300" },
};

const RADIUS = 42;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function ScoreRing({ score, band }: { score: number; band: FinancialScoreBand }) {
  return (
    <svg viewBox="0 0 100 100" className="h-24 w-24 shrink-0 -rotate-90 sm:h-28 sm:w-28" aria-hidden>
      <circle cx="50" cy="50" r={RADIUS} fill="none" strokeWidth="8" className="stroke-slate-800" />
      <circle
        cx="50"
        cy="50"
        r={RADIUS}
        fill="none"
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={`${(score / 100) * CIRCUMFERENCE} ${CIRCUMFERENCE}`}
        className={BAND_TONE[band].stroke}
      />
    </svg>
  );
}

/**
 * The overall financial score, shared by Insights and Reports. `note` says how the page's own
 * filters relate to it (Reports has a period and tag picker the score does not follow).
 */
export function FinancialScoreCard({ score, note }: { score: FinancialScore; note?: string }) {
  if (score.status === "insufficient") {
    return (
      <section aria-labelledby="financial-score" className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 lg:p-5" data-testid="financial-score">
        <h2 id="financial-score" className="text-lg font-semibold">
          Financial score
        </h2>
        <p className="mt-1 text-sm text-slate-400">{score.reason}</p>
      </section>
    );
  }

  const tone = BAND_TONE[score.band];
  const first = score.months[0];
  const last = score.months[score.months.length - 1];
  const span = first === last ? formatYmShortLabel(first) : `${formatYmShortLabel(first)} – ${formatYmShortLabel(last)}`;

  return (
    <section aria-labelledby="financial-score" className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 lg:p-5" data-testid="financial-score">
      <div className="flex items-center gap-4 sm:gap-5">
        <div className="relative">
          <ScoreRing score={score.score} band={score.band} />
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-3xl font-semibold tabular-nums sm:text-4xl" data-testid="financial-score-value">
              {score.score}
            </span>
            <span className="text-[10px] uppercase tracking-wide text-slate-500">of 100</span>
          </div>
        </div>
        <div className="min-w-0">
          <h2 id="financial-score" className="text-lg font-semibold">
            Financial score
          </h2>
          <p className={`text-base font-medium ${tone.text}`} data-testid="financial-score-band">
            {score.band}
          </p>
          <p className="mt-0.5 text-sm text-slate-400">
            Based on {span}
            {note ? `. ${note}` : ""}.
          </p>
        </div>
      </div>

      <ul className="mt-4 space-y-2.5" data-testid="financial-score-factors">
        {score.factors.map((factor) => {
          const factorTone = BAND_TONE[scoreBand(factor.score)];
          return (
            <li key={factor.id} className="text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-slate-200">{factor.label}</span>
                <span className="shrink-0 tabular-nums text-slate-300">{factor.score}</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-slate-800" aria-hidden>
                <div className={`h-1.5 rounded-full ${factorTone.bar}`} style={{ width: `${Math.max(factor.score, 2)}%` }} />
              </div>
              <p className="mt-1 text-xs text-slate-500">{factor.detail}</p>
            </li>
          );
        })}
      </ul>

      {score.suggestions.length ? (
        <div className="mt-4 border-t border-slate-800 pt-3">
          <h3 className="text-sm font-medium text-slate-200">Where to improve</h3>
          <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-sm text-slate-300" data-testid="financial-score-suggestions">
            {score.suggestions.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </div>
      ) : (
        <p className="mt-4 border-t border-slate-800 pt-3 text-sm text-slate-400">Nothing stands out to work on. Keep it up.</p>
      )}

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer select-none text-slate-400">How this is worked out</summary>
        <div className="mt-2 space-y-2 text-slate-400">
          <p>
            Each factor is scored 0–100 from your full months of income and spending (transfers between your accounts are left
            out) and your account balances, and the overall score is their weighted average:
          </p>
          <ul className="space-y-0.5 tabular-nums">
            {score.factors.map((f) => (
              <li key={f.id} className="flex justify-between gap-3">
                <span>{f.label}</span>
                <span>{Math.round(f.weight * 100)}%</span>
              </li>
            ))}
          </ul>
          {score.omitted.length ? (
            <p>
              Not counted:{" "}
              {score.omitted.map((o) => `${o.label.toLowerCase()} (${o.reason})`).join(", ")}.
            </p>
          ) : null}
          <p>
            The emergency fund is the latest balance of your chequing, savings and cash accounts, plus any other account marked
            &ldquo;Counts as savings&rdquo; except an RRSP, against {EMERGENCY_FUND_TARGET_MONTHS} months of your average spending.
            Debt isn&apos;t part of the score.
          </p>
        </div>
      </details>
    </section>
  );
}
