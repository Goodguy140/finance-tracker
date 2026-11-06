import { useLocalSearchParams } from 'expo-router';

import { RecordBalance } from '@/screens/accounts/balance';

/** The sheet for typing in an account's balance, opened from its account page. */
export default function BalanceRoute() {
  const params = useLocalSearchParams<{ accountId: string; name?: string; currency?: string; liability?: string; cents?: string; linked?: string }>();
  const cents = params.cents === undefined || params.cents === '' ? null : Number(params.cents);
  return (
    <RecordBalance
      accountId={params.accountId}
      name={params.name ?? 'Account'}
      currency={params.currency ?? 'CAD'}
      liability={params.liability === '1'}
      linked={params.linked === '1'}
      currentCents={cents !== null && Number.isFinite(cents) ? cents : null}
    />
  );
}
