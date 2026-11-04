import { useLocalSearchParams } from 'expo-router';

import { Account } from '@/screens/accounts/account';

export default function AccountRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Account id={id} />;
}
