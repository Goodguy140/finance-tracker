import { useLocalSearchParams } from 'expo-router';

import { EditBudget } from '@/screens/budgets/edit';

/** The sheet for a category's budgets (`categoryId`), or for adding one to a category without. */
export default function BudgetRoute() {
  const { categoryId } = useLocalSearchParams<{ categoryId?: string }>();
  return <EditBudget categoryId={categoryId ?? null} />;
}
