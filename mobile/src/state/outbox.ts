import { Directory, File, Paths } from 'expo-file-system';
import { useSyncExternalStore } from 'react';

import { applyOutcome, readOutbox, type PendingAdd, type SendOutcome } from '@/utils/outbox';
import type { ReceiptPhoto } from '@/utils/receipts';

/**
 * Adds made while the server could not be reached, kept in the app's own storage (not the cache,
 * which iOS may empty) until they are sent. The list belongs to one sign-in: a new sign-in, even
 * to the same server, never sends what an earlier one left behind.
 */

const FILE = 'outbox.json';
const PHOTOS = 'outbox-receipts';

let deviceId: string | null = null;
let items: PendingAdd[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function save() {
  if (!deviceId) return;
  try {
    const file = new File(Paths.document, FILE);
    if (!file.exists) file.create();
    file.writeSync(JSON.stringify({ deviceId, items }));
  } catch {
    // Kept in memory for this launch; nothing else to do if storage refuses.
  }
}

/** Reads the list for this sign-in. Called whenever the signed-in phone changes. */
export function openOutbox(forDeviceId: string | null) {
  if (forDeviceId === deviceId) return;
  deviceId = forDeviceId;
  items = [];
  if (forDeviceId) {
    try {
      const file = new File(Paths.document, FILE);
      items = readOutbox(file.exists ? file.textSync() : null, forDeviceId);
    } catch {
      items = [];
    }
  }
  emit();
}

/**
 * A copy of the receipt in the app's own storage: the picker's file may be gone by the time it is
 * sent. Stored by file name only, because iOS moves the app's folder when the app is updated.
 */
async function keepPhoto(key: string, photo: ReceiptPhoto): Promise<ReceiptPhoto | null> {
  try {
    const dir = new Directory(Paths.document, PHOTOS);
    if (!dir.exists) dir.create({ intermediates: true });
    const extension = photo.fileName.includes('.') ? photo.fileName.slice(photo.fileName.lastIndexOf('.')) : '.jpg';
    const name = `${key}${extension}`;
    await new File(photo.uri).copy(new File(dir, name));
    return { ...photo, uri: name };
  } catch {
    return null;
  }
}

/** The kept photo as a file on this phone now. */
export function keptPhotoFile(photo: ReceiptPhoto): File {
  return new File(Paths.document, PHOTOS, photo.uri);
}

function dropPhoto(item: PendingAdd) {
  if (!item.photo) return;
  try {
    const file = keptPhotoFile(item.photo);
    if (file.exists) file.delete();
  } catch {
    // A stray copy costs a little space and nothing else.
  }
}

/** Keeps an add to send later. Returns false when the receipt could not be kept with it. */
export async function keepForLater(add: Omit<PendingAdd, 'photo' | 'transactionId' | 'error'>, photo: ReceiptPhoto | null) {
  const kept = photo ? await keepPhoto(add.key, photo) : null;
  items = [...items.filter((i) => i.key !== add.key), { ...add, photo: kept, transactionId: null, error: null }];
  save();
  emit();
  return photo === null || kept !== null;
}

export function recordOutcome(key: string, outcome: SendOutcome) {
  const before = items.find((i) => i.key === key);
  items = applyOutcome(items, key, outcome);
  if (before && !items.some((i) => i.key === key)) dropPhoto(before);
  save();
  emit();
}

export function discardPending(key: string) {
  const item = items.find((i) => i.key === key);
  if (!item) return;
  dropPhoto(item);
  items = items.filter((i) => i.key !== key);
  save();
  emit();
}

/** Signing out lets everything go: the next sign-in may be someone else's. */
export function clearOutbox() {
  for (const item of items) dropPhoto(item);
  items = [];
  try {
    const file = new File(Paths.document, FILE);
    if (file.exists) file.delete();
  } catch {
    // Unreadable under another sign-in anyway.
  }
  emit();
}

export function pendingAdds(): PendingAdd[] {
  return items;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useOutbox(): PendingAdd[] {
  return useSyncExternalStore(subscribe, pendingAdds, pendingAdds);
}
