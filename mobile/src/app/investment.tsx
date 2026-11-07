import { useLocalSearchParams } from 'expo-router';

import { InvestmentEntry } from '@/screens/investments/entry';

/** The sheet for a contribution or withdrawal (`kind=flow`) or a portfolio value (`kind=value`), new or changed (`id`). */
export default function InvestmentRoute() {
  const { kind, id } = useLocalSearchParams<{ kind?: string; id?: string }>();
  return <InvestmentEntry kind={kind === 'value' ? 'value' : 'flow'} id={id ?? null} />;
}
