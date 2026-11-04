/**
 * "Log an expense in Finances" (app-intents/LogExpenseIntent.swift) arrives as a `logExpense`
 * invocation with the amount Siri heard and, from the Shortcuts app, what it was for. It only
 * opens the Add sheet with those filled in; the person still taps Add.
 */
export const LOG_EXPENSE = 'logExpense';

/**
 * How long an invocation stays worth acting on. One left waiting (the app was signed out, say) is
 * let go rather than opening an Add sheet out of nowhere the next time the app is used.
 */
export const SIRI_FRESH_MS = 10 * 60 * 1000;

export type SiriPrefill = { amount: string; title: string | null };

/** The Add sheet's starting amount and title, or null when the invocation is stale or unusable. */
export function siriPrefill(params: Record<string, unknown>, createdAt: number, now: number): SiriPrefill | null {
  if (!(now - createdAt <= SIRI_FRESH_MS)) return null;
  const amount = params.amount;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || amount >= 1e9) return null;
  const title = typeof params.title === 'string' && params.title.trim() ? params.title.trim().slice(0, 200) : null;
  return { amount: (Math.round(amount * 100) / 100).toFixed(2), title };
}

/**
 * Of the invocations waiting, the one to open: the newest usable `logExpense`. Siri can only run one
 * at a time, so more than one waiting means earlier ones were never seen through; opening several
 * Add sheets in a row would be worse than opening the latest.
 */
export function latestSiriPrefill(
  invocations: readonly { name: string; params: Record<string, unknown>; createdAt: number }[],
  now: number,
): SiriPrefill | null {
  let latest: { at: number; prefill: SiriPrefill } | null = null;
  for (const invocation of invocations) {
    if (invocation.name !== LOG_EXPENSE) continue;
    const prefill = siriPrefill(invocation.params, invocation.createdAt, now);
    if (prefill && (!latest || invocation.createdAt >= latest.at)) latest = { at: invocation.createdAt, prefill };
  }
  return latest?.prefill ?? null;
}
