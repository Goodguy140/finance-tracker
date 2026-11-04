import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { apiRequest } from '@/api/client';
import { uploadReceipt } from '@/api/receipts';
import type { StoredSession } from '@/session/store';
import { keptPhotoFile, openOutbox, pendingAdds, recordOutcome, useOutbox } from '@/state/outbox';
import { failureOutcome, sendable, type PendingAdd, type SendOutcome } from '@/utils/outbox';

/** How often to try again while something is waiting, besides each time the app comes to the front. */
const RETRY_MS = 30_000;

let sending: Promise<boolean> | null = null;

async function sendOne(session: StoredSession, item: PendingAdd): Promise<SendOutcome> {
  try {
    if (!item.transactionId) {
      const { transaction } = await apiRequest<{ transaction: { id: string } }>(session, 'POST', '/api/v1/transactions', item.body, {
        'Idempotency-Key': item.key,
      });
      return { kind: 'added', transactionId: transaction.id };
    }
    // The entry is in; only its receipt is left. A copy that has gone missing will never upload.
    const file = item.photo ? keptPhotoFile(item.photo) : null;
    if (!item.photo || !file?.exists) return { kind: 'refused', message: 'The receipt photo is no longer on this phone.' };
    await uploadReceipt(session, item.transactionId, { ...item.photo, uri: file.uri });
    return { kind: 'receipt-done' };
  } catch (err) {
    return failureOutcome(err);
  }
}

/**
 * Sends what is waiting, oldest first, stopping at the first that cannot get through (the rest
 * would fare no better). Resolves true when anything went in. Only one pass runs at a time.
 */
export function sendPending(session: StoredSession): Promise<boolean> {
  sending ??= (async () => {
    let any = false;
    try {
      for (let item = sendable(pendingAdds())[0]; item; item = sendable(pendingAdds())[0]) {
        const outcome = await sendOne(session, item);
        recordOutcome(item.key, outcome);
        if (outcome.kind === 'unreachable' || outcome.kind === 'signed-out') break;
        if (outcome.kind === 'added' || outcome.kind === 'receipt-done') any = true;
      }
    } finally {
      sending = null;
    }
    return any;
  })();
  return sending;
}

/**
 * Keeps the phone's waiting adds moving: opens the list for this sign-in, and while anything is
 * waiting, sends it now, whenever the app comes back to the front, and every 30 seconds.
 */
export function useOutboxSender(session: StoredSession | null | undefined) {
  const client = useQueryClient();
  const waiting = sendable(useOutbox()).length;
  const deviceId = session?.deviceId ?? null;

  useEffect(() => openOutbox(deviceId), [deviceId]);

  useEffect(() => {
    if (!session || waiting === 0) return;
    const run = () =>
      void sendPending(session).then((any) => {
        if (any) void client.invalidateQueries({ queryKey: ['api'] });
      });
    run();
    const timer = setInterval(run, RETRY_MS);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') run();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [session, waiting, client]);
}
