import { useLocalSearchParams } from 'expo-router';

import { QueueRowDetail } from '@/screens/review/row';

export default function QueueRowRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <QueueRowDetail id={id} />;
}
