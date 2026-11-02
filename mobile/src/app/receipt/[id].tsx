import { useLocalSearchParams } from 'expo-router';

import { ReceiptViewer } from '@/screens/receipt';

export default function ReceiptRoute() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  return <ReceiptViewer id={id} name={name ?? null} />;
}
