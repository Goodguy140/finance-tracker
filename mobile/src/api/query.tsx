import {
  focusManager,
  keepPreviousData,
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { apiGet, SignedOutError } from '@/api/client';
import { shouldRetry } from '@/api/retry';
import { useSession } from '@/session/session-provider';
import { recallList, rememberList } from '@/state/remembered-lists';

// Data older than `staleTime` is fetched again when the app comes back to the front, as a
// browser does when its tab is shown again.
focusManager.setEventListener((handleFocus) => {
  const subscription = AppState.addEventListener('change', (state) => handleFocus(state === 'active'));
  return () => subscription.remove();
});

/** Set by `QueryProvider` while it is mounted: what to do when the server says this phone is signed out. */
let onSignedOut: ((notice: string) => void) | null = null;

function handleError(error: unknown) {
  if (error instanceof SignedOutError) onSignedOut?.(error.message);
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: handleError }),
  mutationCache: new MutationCache({ onError: handleError }),
  defaultOptions: { queries: { staleTime: 30_000, retry: shouldRetry } },
});

/**
 * The cache every screen reads through. A 401 anywhere signs the phone out with a note on the
 * sign-in screen, and signing out empties the cache so the next account starts clean.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const { session, signOut } = useSession();

  useEffect(() => {
    onSignedOut = (notice) => void signOut({ notice, revoke: false });
    return () => {
      onSignedOut = null;
    };
  }, [signOut]);

  useEffect(() => {
    if (session === null) queryClient.clear();
  }, [session]);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

/**
 * GET a `/api/v1` path as this phone, cached under the path. `null` waits. With `keepPrevious`, a
 * change of path keeps showing the last answer until the new one arrives, as a chart should.
 */
export function useApiQuery<T>(path: string | null, options: { keepPrevious?: boolean } = {}) {
  const { session } = useSession();
  return useQuery({
    queryKey: ['api', path],
    queryFn: () => apiGet<T>(session!, path!),
    enabled: Boolean(session && path),
    placeholderData: options.keepPrevious ? keepPreviousData : undefined,
  });
}

/**
 * As `useApiQuery`, but starting from the last answer kept on the phone, which is replaced as soon
 * as the server answers: for the lists the Add sheet needs, so it opens with no connection.
 */
export function useRememberedQuery<T>(path: string) {
  const { session } = useSession();
  const deviceId = session?.deviceId ?? null;
  return useQuery({
    queryKey: ['api', path],
    queryFn: async () => {
      const data = await apiGet<T>(session!, path);
      if (deviceId) rememberList(deviceId, path, data);
      return data;
    },
    enabled: Boolean(session),
    // Stale from the start, so the server is asked straight away.
    initialData: () => (deviceId ? recallList<T>(deviceId, path) : undefined),
    initialDataUpdatedAt: 0,
  });
}

/** The message to show for a failed load. */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Could not load. Pull down to try again.';
}
