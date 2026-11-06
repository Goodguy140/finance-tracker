import { useLocalSearchParams } from 'expo-router';

import { CoverBudget } from '@/screens/budgets/cover';

/** The sheet for covering a budget's overage this month from other budgets. */
export default function BudgetCoverRoute() {
  const { categoryId } = useLocalSearchParams<{ categoryId: string }>();
  return <CoverBudget categoryId={categoryId} />;
}
