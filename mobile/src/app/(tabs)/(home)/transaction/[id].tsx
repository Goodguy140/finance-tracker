import { useLocalSearchParams } from 'expo-router';

import { EditTransaction } from '@/screens/transactions/edit';

/** An entry opened from an account's register, edited without leaving Home. */
export default function HomeTransactionRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <EditTransaction id={id} />;
}
