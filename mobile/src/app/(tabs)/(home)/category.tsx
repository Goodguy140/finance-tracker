import { useLocalSearchParams } from 'expo-router';

import { CategoryScreen } from '@/screens/reports/category';

/** A category over time, from a slice of Home's spending card. */
export default function CategoryRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <CategoryScreen id={id} merchantRoute="/merchant" editBudget={false} />;
}
