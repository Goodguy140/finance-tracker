import * as Linking from 'expo-linking';
import { useRootNavigationState, useRouter } from 'expo-router';
import { getSharedPayloads } from 'expo-sharing';
import { useEffect } from 'react';

function isShareLink(url: string): boolean {
  try {
    return new URL(url).hostname === 'expo-sharing';
  } catch {
    return false;
  }
}

/**
 * Opens the receipt screen for something shared to Finances. The link does that by itself when the
 * app is ready (`+native-intent.ts`); this catches the share made while the app was locked or signed
 * out, which those screens set aside. Waits for `enabled` (signed in and unlocked). The share stays
 * until the receipt screen lets it go, so it is offered once, not lost.
 */
export function useSharedReceipts(enabled: boolean) {
  const router = useRouter();
  const navigatorReady = Boolean(useRootNavigationState()?.key);
  const ready = enabled && navigatorReady;
  useEffect(() => {
    if (!ready) return;
    let frame: number | null = null;
    const open = () => {
      let waiting = false;
      try {
        waiting = getSharedPayloads().length > 0;
      } catch {
        waiting = false;
      }
      // A frame later, so the tabs that unlocking just put back are there to navigate in.
      if (waiting) frame = requestAnimationFrame(() => router.navigate('/share'));
    };
    open();
    const subscription = Linking.addEventListener('url', ({ url }) => {
      if (isShareLink(url)) open();
    });
    return () => {
      subscription.remove();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [ready, router]);
}
