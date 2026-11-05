/**
 * Where a link that opens the app goes (`src/app/+native-intent.ts`). This runs before the app
 * knows whether anyone is signed in or it is locked.
 *
 * - Something shared to Finances from another app opens it as financetracker://expo-sharing?…;
 *   that goes to the receipt screen (`useSharedReceipts` opens it again once it can be shown).
 * - https://<home server>/plaid/oauth?oauth_state_id=… is a bank's own app or site sending someone
 *   back to Plaid Link, which is still open over the app and picks the sign-in up itself. The app
 *   stays where it is: there is no screen for it, so following it would show "not found" behind
 *   Link. Opened cold, Link is gone, so it starts at Home.
 * - Every other link (the home screen widgets') goes where it says.
 */
export const PLAID_OAUTH_PATH = '/plaid/oauth';

export function systemPathTarget(path: string, initial: boolean): string {
  let url: URL;
  try {
    url = new URL(path, 'financetracker://app');
  } catch {
    return '/';
  }
  if (url.hostname === 'expo-sharing') return '/share';
  if (url.protocol === 'https:' && url.pathname === PLAID_OAUTH_PATH) return initial ? '/' : '';
  return path;
}
