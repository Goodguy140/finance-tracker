import { Stack } from 'expo-router/stack';

/** The navigation stack inside each tab: large titles that shrink as the list scrolls. */
export function TabStack() {
  return <Stack screenOptions={{ headerLargeTitleEnabled: true, headerShadowVisible: false }} />;
}
