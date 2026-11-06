import { File, Paths } from 'expo-file-system';
import { useCallback, useState } from 'react';

import type { SpendingOptions } from '@/utils/spending';

/**
 * The Compare with and Show savings the person picked on Home's spending charts, kept on the phone
 * for one sign-in. Until they pick, the charts follow the website's card settings.
 */

const FILE = 'spending-options.json';

type Stored = { deviceId: string; options: SpendingOptions };

let cache: Stored | null = null;

function read(deviceId: string): SpendingOptions {
  if (cache?.deviceId === deviceId) return cache.options;
  cache = { deviceId, options: {} };
  try {
    const file = new File(Paths.document, FILE);
    if (file.exists) {
      const parsed = JSON.parse(file.textSync()) as Partial<Stored>;
      if (parsed.deviceId === deviceId && parsed.options && typeof parsed.options === 'object') cache = { deviceId, options: parsed.options };
    }
  } catch {
    // Nothing kept: the website's settings, as before.
  }
  return cache.options;
}

function write(deviceId: string, options: SpendingOptions) {
  cache = { deviceId, options };
  try {
    const file = new File(Paths.document, FILE);
    if (!file.exists) file.create();
    file.writeSync(JSON.stringify(cache));
  } catch {
    // Kept for this launch only.
  }
}

/** The person's picks for this sign-in, and a way to change one. */
export function useSpendingOptions(deviceId: string | null) {
  const [options, setOptions] = useState<SpendingOptions>(() => (deviceId ? read(deviceId) : {}));
  const change = useCallback(
    (next: SpendingOptions) => {
      setOptions((current) => {
        const merged = { ...current, ...next };
        if (deviceId) write(deviceId, merged);
        return merged;
      });
    },
    [deviceId],
  );
  return [options, change] as const;
}

export function forgetSpendingOptions() {
  cache = null;
  try {
    const file = new File(Paths.document, FILE);
    if (file.exists) file.delete();
  } catch {
    // Unreadable under another sign-in anyway.
  }
}
