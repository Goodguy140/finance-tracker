import { useLocalSearchParams } from 'expo-router';

import { MakeRule } from '@/screens/rules/make';

/** The sheet for making a rule, filled in from an entry, a bank row or a suggestion. */
export default function TransactionRuleRoute() {
  const params = useLocalSearchParams<{
    title?: string;
    type?: string;
    categoryId?: string;
    accountId?: string;
    accountName?: string;
    match?: string;
  }>();
  return <MakeRule params={params} />;
}
