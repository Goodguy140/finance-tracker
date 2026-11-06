import { useLocalSearchParams } from 'expo-router';

import { EditRule } from '@/screens/bills/rule';

/** The sheet for adding a recurring rule, or changing one (`id`). */
export default function RecurringRuleRoute() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return <EditRule id={id ?? null} />;
}
