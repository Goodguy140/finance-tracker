import { useSyncExternalStore } from 'react';

/**
 * Something just done that the bar at the bottom offers to take back for a few seconds: an entry
 * deleted (put back with its undo id) or an entry added (deleted again).
 */
export type UndoOffer =
  | { kind: 'deleted'; undoId: string; label: string; offeredAt: number }
  | { kind: 'added'; transactionId: string; label: string; offeredAt: number };

type Offer = UndoOffer extends infer O ? (O extends UndoOffer ? Omit<O, 'offeredAt'> : never) : never;

let current: UndoOffer | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** The offer's own id, so clearing an old offer never takes away a newer one. */
export function undoOfferId(offer: Offer | UndoOffer): string {
  return offer.kind === 'deleted' ? `deleted:${offer.undoId}` : `added:${offer.transactionId}`;
}

export function offerUndo(offer: Offer, now = Date.now()) {
  current = { ...offer, offeredAt: now } as UndoOffer;
  emit();
}

export function clearUndo(id?: string) {
  if (id && (!current || undoOfferId(current) !== id)) return;
  current = null;
  emit();
}

export function currentUndo(): UndoOffer | null {
  return current;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useUndoOffer(): UndoOffer | null {
  return useSyncExternalStore(subscribe, currentUndo, currentUndo);
}
