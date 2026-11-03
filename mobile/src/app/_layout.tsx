import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { Stack } from 'expo-router/stack';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

import { QueryProvider } from '@/api/query';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAlertRegistration, useAlertTaps } from '@/notifications/alerts';
import { AppLockProvider, useAppLock } from '@/session/app-lock';
import { SessionProvider, useSession } from '@/session/session-provider';

// Kept up until the Keychain has been read, so a signed-in person never sees the sign-in screen
// flash, nor a locked app show before its lock screen.
SplashScreen.preventAutoHideAsync();

function RootStack() {
  const { session } = useSession();
  const lock = useAppLock();
  const ready = session !== undefined && (session === null || lock.enabled !== undefined);
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);
  useAlertRegistration(session);
  useAlertTaps(ready && session !== null && !lock.locked);
  if (!ready) return null;
  const signedIn = session !== null;
  // Locking takes every signed-in screen away, sheets included, rather than covering them.
  const locked = signedIn && lock.locked;
  return (
    <Stack>
      <Stack.Protected guard={locked}>
        <Stack.Screen name="locked" options={{ headerShown: false, animation: 'none' }} />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && !locked}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="add" options={{ presentation: 'modal', headerShadowVisible: false }} />
        <Stack.Screen name="receipt/[id]" options={{ presentation: 'modal', headerShadowVisible: false }} />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <SessionProvider>
        <QueryProvider>
          <AppLockProvider>
            <RootStack />
          </AppLockProvider>
        </QueryProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}
