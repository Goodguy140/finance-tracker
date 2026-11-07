import { useLocalSearchParams } from 'expo-router';

import { EditGoal } from '@/screens/goals/edit';

/** The sheet for adding a savings goal, or changing one (`id`). */
export default function GoalRoute() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return <EditGoal id={id ?? null} />;
}
