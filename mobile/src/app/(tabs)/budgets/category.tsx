import { useLocalSearchParams } from 'expo-router';

import { CategoryScreen } from '@/screens/reports/category';

/** A category over time, from a budget (`budget` set when that budget can be changed here). */
export default function CategoryRoute() {
  const { id, budget } = useLocalSearchParams<{ id: string; budget?: string }>();
  return <CategoryScreen id={id} merchantRoute="/budgets/merchant" editBudget={budget === '1'} />;
}
