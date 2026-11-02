import { useLocalSearchParams } from 'expo-router';

import { EditTransaction } from '@/screens/transactions/edit';

export default function TransactionRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <EditTransaction id={id} />;
}
