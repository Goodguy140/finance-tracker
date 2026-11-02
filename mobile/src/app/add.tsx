import { useLocalSearchParams } from 'expo-router';

import { AddTransaction } from '@/screens/add';

export default function AddRoute() {
  const { type } = useLocalSearchParams<{ type?: string }>();
  return <AddTransaction initialType={type === 'income' || type === 'transfer' ? type : 'expense'} />;
}
