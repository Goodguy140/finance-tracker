import { useLocalSearchParams } from 'expo-router';

import { MerchantScreen } from '@/screens/reports/merchant';

/** Everything from one payee, opened from a category page's payees. */
export default function MerchantRoute() {
  const { key } = useLocalSearchParams<{ key: string }>();
  return <MerchantScreen merchantKey={key} />;
}
