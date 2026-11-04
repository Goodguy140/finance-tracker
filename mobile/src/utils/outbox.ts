import { ApiError, SignedOutError } from '@/api/client';
import { formatCents } from '@/utils/money';
import type { ReceiptPhoto } from '@/utils/receipts';

/**
 * An add made while the server could not be reached, kept on the phone until it can be. It keeps
 * the `Idempotency-Key` it was first sent with, so if that first try did reach the server after
 * all, sending it again answers with the entry already made rather than adding a second one.
 */
export type PendingAdd = {
  key: string;
  /** The `POST /api/v1/transactions` body, as the Add sheet built it. */
  body: Record<string, unknown>;
  /** "$12.50 Coffee", to list it by. */
  label: string;
  /** When it was saved on the phone, ISO. */
  savedAt: string;
  /** The receipt photo kept with it; `uri` is the copy's file name in the app's own storage. */
  photo: ReceiptPhoto | null;
  /** Set once the entry is in and only its receipt is left to upload. */
  transactionId: string | null;
  /** Why the server refused it: it stays listed, not sent again, until discarded. */
  error: string | null;
};

/** What happened to one send, and so what becomes of the pending add. */
export type SendOutcome =
  | { kind: 'added'; transactionId: string }
  | { kind: 'receipt-done' }
  /** The add went in on an earlier try and the person has deleted it since: nothing to send. */
  | { kind: 'gone' }
  | { kind: 'refused'; message: string }
  | { kind: 'unreachable' }
  | { kind: 'signed-out' };

/**
 * What a failed send means. Kept for later: the server was not reached or did not answer, could
 * not take it just then (a 5xx, which is also what a proxy in front of a server that is down
 * answers, or 429), or is still saving an earlier try with the same key (409). Any other 4xx
 * would be refused again.
 */
export function failureOutcome(error: unknown): SendOutcome {
  if (error instanceof SignedOutError) return { kind: 'signed-out' };
  if (!(error instanceof ApiError)) return { kind: 'unreachable' };
  if (error.status === 410) return { kind: 'gone' };
  if (error.status >= 500 || error.status === 429 || error.status === 409) return { kind: 'unreachable' };
  return { kind: 'refused', message: error.message };
}

/**
 * The list after one send. An add that went in is done, unless it has a receipt still to upload;
 * a refused one stays with its reason (a refused receipt is let go: the entry is in, and the
 * receipt can be added from it); an unreachable one stays as it was, for the next try.
 */
export function applyOutcome(items: readonly PendingAdd[], key: string, outcome: SendOutcome): PendingAdd[] {
  return items.flatMap((item) => {
    if (item.key !== key) return [item];
    switch (outcome.kind) {
      case 'added':
        return item.photo ? [{ ...item, transactionId: outcome.transactionId, error: null }] : [];
      case 'receipt-done':
      case 'gone':
        return [];
      case 'refused':
        return item.transactionId ? [] : [{ ...item, error: outcome.message }];
      case 'unreachable':
      case 'signed-out':
        return [item];
    }
  });
}

/** The ones to try now, oldest first: not refused. */
export function sendable(items: readonly PendingAdd[]): PendingAdd[] {
  return items.filter((item) => item.error === null);
}

/** "2 entries are saved on this phone and will be added when your server can be reached." */
export function outboxLine(items: readonly PendingAdd[]): string | null {
  if (items.length === 0) return null;
  const refused = items.filter((item) => item.error !== null).length;
  const waiting = items.length - refused;
  const parts: string[] = [];
  if (waiting > 0) {
    parts.push(
      `${waiting === 1 ? '1 entry is' : `${waiting} entries are`} saved on this phone and will be added when your server can be reached.`,
    );
  }
  if (refused > 0) parts.push(`${refused === 1 ? '1 was' : `${refused} were`} refused by the server.`);
  return parts.join(' ');
}

/** The stored file, read back: only lists for this sign-in count, and anything malformed is dropped. */
export function readOutbox(raw: string | null, deviceId: string): PendingAdd[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { deviceId?: unknown; items?: unknown };
    if (parsed.deviceId !== deviceId || !Array.isArray(parsed.items)) return [];
    return parsed.items.filter(
      (item): item is PendingAdd =>
        !!item && typeof item === 'object' && typeof item.key === 'string' && typeof item.body === 'object' && item.body !== null,
    );
  } catch {
    return [];
  }
}

/** "$12.50 Coffee": what the list of waiting adds calls one. */
export function pendingLabel(body: { amountCents?: unknown; title?: unknown; type?: unknown }, currency: string, categoryName: string | null): string {
  const cents = typeof body.amountCents === 'number' ? body.amountCents : 0;
  const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : null;
  const fallback = body.type === 'transfer' ? 'Transfer' : body.type === 'income' ? 'Income' : 'Expense';
  return `${formatCents(cents, currency)} ${title ?? categoryName ?? fallback}`;
}
