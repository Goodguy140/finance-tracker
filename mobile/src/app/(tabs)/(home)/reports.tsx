import { useLocalSearchParams } from 'expo-router';

import { ReportsScreen } from '@/screens/reports';

/** The website's Reports page, from Home's Net worth card, or for one tag's year from the year-end summary. */
export default function ReportsRoute() {
  const { period, tag } = useLocalSearchParams<{ period?: string; tag?: string }>();
  return <ReportsScreen period={period} tagId={tag} />;
}
