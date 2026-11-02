import { useLocalSearchParams } from 'expo-router';

import { Transactions } from '@/screens/transactions';

export default function TransactionsRoute() {
  // `?review=1` (from Home's "need a look") opens the list on Needs review.
  const { review } = useLocalSearchParams<{ review?: string }>();
  return <Transactions key={review ?? 'all'} initialNeedsReview={review === '1'} />;
}
