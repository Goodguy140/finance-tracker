import { useLocalSearchParams } from 'expo-router';

import { EditAccount } from '@/screens/accounts/edit';

/** The sheet for adding an account, or changing or archiving one (`id`). */
export default function AccountEditRoute() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return <EditAccount id={id ?? null} />;
}
