import { useLocalSearchParams } from 'expo-router';

import { EditPlan } from '@/screens/plans/edit';

/** The sheet for adding a one-off plan, or changing one (`id`). */
export default function PlanRoute() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return <EditPlan id={id ?? null} />;
}
