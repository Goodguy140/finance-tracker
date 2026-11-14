import { useLocalSearchParams } from 'expo-router';

import { EditRule } from '@/screens/rules/edit';
import { MakeRule } from '@/screens/rules/make';

/** The sheet for one rule: `id` opens a rule already made; otherwise a new one, filled in from an entry, a bank row or a suggestion. */
export default function TransactionRuleRoute() {
  const params = useLocalSearchParams<{
    id?: string;
    title?: string;
    type?: string;
    categoryId?: string;
    accountId?: string;
    accountName?: string;
    match?: string;
  }>();
  if (params.id) return <EditRule id={params.id} />;
  return <MakeRule params={params} />;
}
