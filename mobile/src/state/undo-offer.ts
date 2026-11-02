import { useSyncExternalStore } from 'react';

/** An entry just deleted, which the Transactions list offers to put back. */
export type UndoOffer = { undoId: string; label: string; offeredAt: number };

let current: UndoOffer | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function offerUndo(undoId: string, label: string, now = Date.now()) {
  current = { undoId, label, offeredAt: now };
  emit();
}

export function clearUndo(undoId?: string) {
  if (undoId && current?.undoId !== undoId) return;
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
