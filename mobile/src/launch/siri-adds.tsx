import * as AppIntents from 'expo-app-intents';
import { useRouter } from 'expo-router';
import { useRef } from 'react';

import { latestSiriPrefill, LOG_EXPENSE } from '@/utils/siri';

/**
 * "Log an expense in Finances" (app-intents/LogExpenseIntent.swift): opens the Add sheet with the
 * amount Siri heard. Rendered only while signed in and unlocked, so Siri used while Face ID is up
 * opens the sheet once it is done: each mount reads what is waiting. Opening the sheet changes
 * nothing, so an invocation handled twice costs a second look at the sheet, never a second entry.
 */
export function SiriAdds() {
  const router = useRouter();
  const seen = useRef(new Set<string>());
  AppIntents.useAppIntents(async (pending) => {
    const fresh = pending.filter((invocation) => invocation.name === LOG_EXPENSE && !seen.current.has(invocation.id));
    if (fresh.length === 0) return;
    for (const invocation of fresh) seen.current.add(invocation.id);
    const prefill = latestSiriPrefill(fresh, Date.now());
    if (prefill) {
      // A frame later, so the tabs that unlocking just put back are there to navigate in.
      requestAnimationFrame(() =>
        router.navigate({ pathname: '/add', params: { amount: prefill.amount, ...(prefill.title ? { title: prefill.title } : {}) } }),
      );
    }
    for (const invocation of fresh) {
      try {
        await AppIntents.removePendingInvocationAsync(invocation.id);
      } catch {
        // Left waiting; the next launch finds it stale and lets it go.
      }
    }
  });
  return null;
}
