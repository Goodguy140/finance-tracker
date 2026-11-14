import { useLocalSearchParams } from 'expo-router';

import { EditRule } from '@/screens/bills/rule';
import { parsePrefillParam } from '@/utils/recurring-rules';

/** The sheet for adding a recurring rule, or changing one (`id`); `prefill` is Insights' "Track it". */
export default function RecurringRuleRoute() {
  const { id, prefill } = useLocalSearchParams<{ id?: string; prefill?: string }>();
  return <EditRule id={id ?? null} prefill={id ? null : parsePrefillParam(prefill)} />;
}
