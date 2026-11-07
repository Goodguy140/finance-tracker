import { useLocalSearchParams } from 'expo-router';

import { MonthReviewScreen } from '@/screens/budgets/review';

/** The monthly review, from the Budgets page (`month`, or the month just finished). */
export default function MonthReviewRoute() {
  const { month } = useLocalSearchParams<{ month?: string }>();
  return <MonthReviewScreen initialMonth={month ?? null} />;
}
