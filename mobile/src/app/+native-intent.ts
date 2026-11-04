/**
 * Something shared to Finances from another app opens it as financetracker://expo-sharing?…; that
 * goes to the receipt screen. Every other link (the home screen widgets') goes where it says. This
 * runs before the app knows whether anyone is signed in or it is locked: `useSharedReceipts` opens
 * the screen again once it can be shown.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    if (new URL(path, 'financetracker://app').hostname === 'expo-sharing') return '/share';
    return path;
  } catch {
    return '/';
  }
}
