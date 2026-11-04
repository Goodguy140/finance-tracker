import { File, Paths } from 'expo-file-system';

/**
 * The last categories and accounts the server sent, kept so the Add sheet opens with no
 * connection. Like the waiting adds, they belong to one sign-in.
 */

const FILE = 'remembered-lists.json';

type Stored = { deviceId: string; lists: Record<string, unknown> };

let cache: Stored | null = null;

function read(deviceId: string): Stored {
  if (cache?.deviceId === deviceId) return cache;
  cache = { deviceId, lists: {} };
  try {
    const file = new File(Paths.document, FILE);
    if (file.exists) {
      const parsed = JSON.parse(file.textSync()) as Partial<Stored>;
      if (parsed.deviceId === deviceId && parsed.lists && typeof parsed.lists === 'object') cache = { deviceId, lists: parsed.lists };
    }
  } catch {
    // Nothing remembered: the sheet waits for the server, as before.
  }
  return cache;
}

export function recallList<T>(deviceId: string, path: string): T | undefined {
  return read(deviceId).lists[path] as T | undefined;
}

export function rememberList(deviceId: string, path: string, data: unknown) {
  const stored = read(deviceId);
  stored.lists[path] = data;
  try {
    const file = new File(Paths.document, FILE);
    if (!file.exists) file.create();
    file.writeSync(JSON.stringify(stored));
  } catch {
    // Remembered for this launch only.
  }
}

export function forgetLists() {
  cache = null;
  try {
    const file = new File(Paths.document, FILE);
    if (file.exists) file.delete();
  } catch {
    // Unreadable under another sign-in anyway.
  }
}
