import { Stack } from 'expo-router/stack';

/**
 * The navigation stack inside each tab. A tab's first screen asks for a large title
 * (`<Stack.Title large>`), which shrinks as the list scrolls; screens pushed on top keep a small one.
 */
export function TabStack() {
  return <Stack screenOptions={{ headerShadowVisible: false }} />;
}
