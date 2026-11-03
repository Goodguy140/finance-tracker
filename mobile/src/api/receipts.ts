import { useMutation, useQueryClient } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import { File } from 'expo-file-system';

import { errorFromResponse, fetchWithTimeout } from '@/api/client';
import { useSession } from '@/session/session-provider';
import type { StoredSession } from '@/session/store';
import { multipartFileBody } from '@/utils/multipart';
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
      let bytes: Uint8Array;
      try {
        bytes = await new File(photo.uri).bytes();
      } catch {
        throw new Error('Couldn’t read the photo on this phone. Choose it again.');
      }
      // Built by hand: Expo's fetch cannot send React Native's `{ uri }` FormData parts.
      const { body, contentType } = multipartFileBody(
        'file',
        { name: photo.fileName, type: photo.mimeType, bytes },
        `ReceiptBoundary${randomUUID().replace(/-/g, '')}`,
      );
      const res = await fetchWithTimeout(
        `${session.origin}/api/v1/transactions/${encodeURIComponent(transactionId)}/attachments`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${session.token}`, accept: 'application/json', 'content-type': contentType },
          body,
        },
        UPLOAD_TIMEOUT_MS,
      );
      if (!res.ok) throw await errorFromResponse(res);
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['api'] }),
  });
}
