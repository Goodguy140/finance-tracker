import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import { clearSession, loadSession, saveSession, type StoredSession } from '@/session/store';
import { revokeOnServer } from '@/session/sign-in-with-server';
import { clearOutbox, pendingAdds } from '@/state/outbox';
import { forgetLists } from '@/state/remembered-lists';
import { clearWidgets } from '@/widgets/update';

type SessionContextValue = {
  /** Undefined while the Keychain is still being read. */
  session: StoredSession | null | undefined;
  /** Why the last session ended, when the person did not end it themselves. */
  notice: string | null;
  signedIn: (session: StoredSession) => Promise<void>;
  signOut: (options?: { notice?: string; revoke?: boolean }) => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<StoredSession | null | undefined>(undefined);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    // The root layout hides the splash screen once it knows what to show.
    loadSession()
      .catch(() => null)
      .then((stored) => setSession(stored));
  }, []);

  const signedIn = useCallback(async (next: StoredSession) => {
    await saveSession(next);
    setNotice(null);
    setSession(next);
  }, []);

  const signOut = useCallback(
    async (options: { notice?: string; revoke?: boolean } = {}) => {
      if (session && options.revoke !== false) await revokeOnServer(session);
      await clearSession();
      // What this sign-in kept on the phone goes with it: the next one may be someone else's.
      const unsent = pendingAdds().length;
      clearOutbox();
      forgetLists();
      clearWidgets();
      const lost = unsent > 0 ? `${unsent === 1 ? '1 entry' : `${unsent} entries`} saved on this phone had not reached the server and were let go.` : null;
      setNotice([options.notice, lost].filter(Boolean).join(' ') || null);
      setSession(null);
    },
    [session],
  );

  return <SessionContext.Provider value={{ session, notice, signedIn, signOut }}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider.');
  return value;
}
