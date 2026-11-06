import { File, Paths } from 'expo-file-system';
import { useCallback, useSyncExternalStore } from 'react';

import { DEFAULT_HOME_LAYOUT, resolveHomeLayout, storedHomeLayout, type HomeLayout } from '@/utils/home-layout';

/**
 * How the person arranged Home (Edit Home), kept on the phone for one sign-in. Home and the Edit
 * Home sheet read the same copy, so Home changes behind the sheet as cards are moved.
 */

const FILE = 'home-layout.json';

type Stored = { deviceId: string; layout: HomeLayout };

let cache: Stored | null = null;
const listeners = new Set<() => void>();

function read(deviceId: string): HomeLayout {
  if (cache?.deviceId === deviceId) return cache.layout;
  let kept: unknown = null;
  try {
    const file = new File(Paths.document, FILE);
    if (file.exists) {
      const parsed = JSON.parse(file.textSync()) as { deviceId?: unknown; layout?: unknown };
      if (parsed.deviceId === deviceId) kept = parsed.layout;
    }
  } catch {
    // Nothing kept: the default Home.
  }
  cache = { deviceId, layout: resolveHomeLayout(kept) };
  return cache.layout;
}

function write(deviceId: string, layout: HomeLayout) {
  cache = { deviceId, layout };
  try {
    const file = new File(Paths.document, FILE);
    if (!file.exists) file.create();
    file.writeSync(JSON.stringify({ deviceId, layout: storedHomeLayout(layout) }));
  } catch {
    // Kept for this launch only.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The cards on Home for this sign-in, top to bottom, and a way to change them. */
export function useHomeLayout(deviceId: string | null) {
  const layout = useSyncExternalStore(subscribe, () => (deviceId ? read(deviceId) : DEFAULT_HOME_LAYOUT));
  const change = useCallback(
    (update: (current: HomeLayout) => HomeLayout) => {
      if (!deviceId) return;
      const current = read(deviceId);
      const next = update(current);
      if (next !== current) write(deviceId, next);
    },
    [deviceId],
  );
  return [layout, change] as const;
}

export function forgetHomeLayout() {
  cache = null;
  try {
    const file = new File(Paths.document, FILE);
    if (file.exists) file.delete();
  } catch {
    // Unreadable under another sign-in anyway.
  }
  for (const listener of listeners) listener();
}
