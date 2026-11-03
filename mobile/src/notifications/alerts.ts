import * as Notifications from 'expo-notifications';
import { useRootNavigationState, useRouter } from 'expo-router';
import { useEffect } from 'react';

import { apiRequest } from '@/api/client';
import type { AlertKind, AlertRegistration } from '@/api/types';
import type { StoredSession } from '@/session/store';
import { ALERTS_PATH, apnsEnvironment, registrationBody, routeForAlert } from '@/utils/alerts';

// An alert that arrives while the app is open still shows as a banner.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const ENVIRONMENT = apnsEnvironment(__DEV__);

export type AlertPermission = 'granted' | 'denied' | 'undetermined';

// The app never asks for provisional (quiet) alerts, so `granted` is the whole of "allowed".
function permissionOf(status: Notifications.NotificationPermissionsStatus): AlertPermission {
  if (status.granted) return 'granted';
  return status.canAskAgain ? 'undetermined' : 'denied';
}

/** Whether iOS lets this app show alerts. */
export async function alertPermission(): Promise<AlertPermission> {
  return permissionOf(await Notifications.getPermissionsAsync());
}

/** Shows iOS's own question, the first time; afterwards only iOS Settings can change the answer. */
export async function askForAlerts(): Promise<AlertPermission> {
  return permissionOf(await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } }));
}

/**
 * Tells the server where Apple delivers this phone's alerts, with any switch that is changing.
 * Switches left out keep their value on the server.
 */
export async function registerForAlerts(
  session: StoredSession,
  change: { alerts?: Partial<Record<AlertKind, boolean>>; hideAmounts?: boolean } = {},
): Promise<AlertRegistration> {
  const token = await Notifications.getDevicePushTokenAsync();
  const result = await apiRequest<{ registration: AlertRegistration }>(
    session,
    'PUT',
    ALERTS_PATH,
    registrationBody(String(token.data), ENVIRONMENT, change),
  );
  return result.registration;
}

/**
 * Registers again at each launch once alerts are allowed: Apple can change a phone's token, and
 * a fresh sign-in on a phone that already allowed alerts starts getting them.
 */
export function useAlertRegistration(session: StoredSession | null | undefined) {
  useEffect(() => {
    if (!session) return;
    void (async () => {
      try {
        if ((await alertPermission()) === 'granted') await registerForAlerts(session);
      } catch {
        // The next launch tries again; Settings says if alerts are not reaching the server.
      }
    })();
  }, [session]);
}

/**
 * A tapped alert opens the screen it is about, including the one that launched the app. Waits
 * for `enabled` (signed in and unlocked), so an alert tapped while Face ID is up opens after it.
 */
export function useAlertTaps(enabled: boolean) {
  const router = useRouter();
  const navigatorReady = Boolean(useRootNavigationState()?.key);
  const ready = enabled && navigatorReady;
  useEffect(() => {
    if (!ready) return;
    let frame: number | null = null;
    const open = (response: Notifications.NotificationResponse | null) => {
      if (!response) return;
      Notifications.clearLastNotificationResponse();
      const route = routeForAlert(response.notification.request.content.data);
      // A frame later, so the tabs that unlocking just put back are there to navigate in.
      if (route) frame = requestAnimationFrame(() => router.navigate(route));
    };
    open(Notifications.getLastNotificationResponse());
    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    return () => {
      subscription.remove();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [ready, router]);
}
