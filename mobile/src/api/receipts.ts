import { useMutation, useQueryClient } from '@tanstack/react-query';

import { errorFromResponse, fetchWithTimeout } from '@/api/client';
import { useSession } from '@/session/session-provider';
import type { StoredSession } from '@/session/store';
import type { ReceiptPhoto } from '@/utils/receipts';

/** A photo can take a while on a weak connection; far longer than an ordinary call. */
const UPLOAD_TIMEOUT_MS = 90_000;

/** Where the server serves one receipt to this phone, with the token it needs (for `expo-image`). */
export function receiptSource(session: StoredSession, attachmentId: string) {
  return {
    uri: `${session.origin}/api/v1/attachments/${encodeURIComponent(attachmentId)}`,
    headers: { authorization: `Bearer ${session.token}` },
  };
}

/** Uploads a receipt photo to one entry, then refreshes every screen (the entry's receipt count changes). */
export function useUploadReceipt() {
  const { session } = useSession();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ transactionId, photo }: { transactionId: string; photo: ReceiptPhoto }) => {
      if (!session) throw new Error('Not signed in.');
      const form = new FormData();
      // React Native's FormData sends a file from its local uri, given its name and type.
      form.append('file', { uri: photo.uri, name: photo.fileName, type: photo.mimeType } as unknown as Blob);
      const res = await fetchWithTimeout(
        `${session.origin}/api/v1/transactions/${encodeURIComponent(transactionId)}/attachments`,
        { method: 'POST', headers: { authorization: `Bearer ${session.token}`, accept: 'application/json' }, body: form },
        UPLOAD_TIMEOUT_MS,
      );
      if (!res.ok) throw await errorFromResponse(res);
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['api'] }),
  });
}
