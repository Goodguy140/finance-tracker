import * as LocalAuthentication from 'expo-local-authentication';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { useSession } from '@/session/session-provider';
import { loadAppLock, saveAppLock } from '@/session/store';
import { lockMethodName, shouldRelock } from '@/utils/app-lock';

type AppLockValue = {
  /** Undefined while this sign-in's setting is being read. */
  enabled: boolean | undefined;
  /** Showing the lock screen instead of the app. */
  locked: boolean;
  /** "Face ID", "Touch ID" or "Passcode". */
  method: string;
  /** Asks iOS; unlocks on success. */
  unlock: () => Promise<void>;
  /** Turns the lock on or off once iOS confirms it is the owner. The reason it did not, or null. */
  setEnabled: (on: boolean) => Promise<string | null>;
};

type LockState = { deviceId: string | null; enabled: boolean | undefined; locked: boolean };

const AppLockContext = createContext<AppLockValue | null>(null);
const CANCELLED = new Set(['user_cancel', 'system_cancel', 'app_cancel']);

/**
 * The optional Face ID lock: when this sign-in has it on, the app opens to the lock screen and
 * locks again after five minutes in the background. The setting belongs to the sign-in, so a new
 * sign-in on the phone always starts with it off.
 */
export function AppLockProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const deviceId = session?.deviceId ?? null;
  const [state, setState] = useState<LockState>({ deviceId, enabled: undefined, locked: false });
  const [method, setMethod] = useState('Face ID');
  const backgroundedAt = useRef<number | null>(null);

  // A different sign-in starts over: its setting is read again below.
  if (state.deviceId !== deviceId) setState({ deviceId, enabled: undefined, locked: false });

  useEffect(() => {
    if (!deviceId) return;
    let live = true;
    loadAppLock(deviceId)
      .catch(() => false)
      .then((on) => {
        if (live) setState((s) => (s.deviceId === deviceId ? { ...s, enabled: on, locked: on } : s));
      });
    return () => {
      live = false;
    };
  }, [deviceId]);

  useEffect(() => {
    void LocalAuthentication.supportedAuthenticationTypesAsync()
      .then((types) =>
        setMethod(
          lockMethodName({
            face: types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION),
            fingerprint: types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT),
          }),
        ),
      )
      .catch(() => undefined);
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'background') {
        backgroundedAt.current = Date.now();
      } else if (next === 'active') {
        const away = backgroundedAt.current;
        backgroundedAt.current = null;
        if (shouldRelock(away, Date.now())) setState((s) => (s.enabled ? { ...s, locked: true } : s));
      }
    });
    return () => subscription.remove();
  }, []);

  const unlock = useCallback(async () => {
    const result = await LocalAuthentication.authenticateAsync({ promptMessage: 'Unlock Finances' });
    if (result.success) setState((s) => ({ ...s, locked: false }));
  }, []);

  const setEnabled = useCallback(
    async (on: boolean): Promise<string | null> => {
      if (!deviceId) return 'Sign in first.';
      if (on && (await LocalAuthentication.getEnrolledLevelAsync()) === LocalAuthentication.SecurityLevel.NONE) {
        return 'Set up Face ID or a passcode for this iPhone in the Settings app first.';
      }
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: on ? 'Turn on the lock for Finances' : 'Turn off the lock for Finances',
      });
      if (!result.success) return CANCELLED.has(result.error) ? null : 'Couldn’t confirm it’s you. Try again.';
      await saveAppLock(on ? deviceId : null);
      setState((s) => ({ ...s, enabled: on, locked: false }));
      return null;
    },
    [deviceId],
  );

  return (
    <AppLockContext.Provider value={{ enabled: state.enabled, locked: state.locked, method, unlock, setEnabled }}>
      {children}
    </AppLockContext.Provider>
  );
}

export function useAppLock(): AppLockValue {
  const value = useContext(AppLockContext);
  if (!value) throw new Error('useAppLock must be used inside AppLockProvider.');
  return value;
}
