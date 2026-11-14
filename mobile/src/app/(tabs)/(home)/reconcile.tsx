import { useLocalSearchParams } from 'expo-router';

import { ReconcileScreen } from '@/screens/accounts/reconcile';

/** Reconcile one account (`id`) with a statement, from its page. */
export default function ReconcileRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ReconcileScreen id={id} />;
}
