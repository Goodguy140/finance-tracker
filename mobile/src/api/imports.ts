import { File } from 'expo-file-system';

import { errorFromResponse, fetchWithTimeout } from '@/api/client';
import type { StoredSession } from '@/session/store';
import type { StatementImportSummary, StatementPreview } from '@/utils/statement-import';

/** A long statement takes a while to send on a weak connection, and to book; far longer than an ordinary call. */
const IMPORT_TIMEOUT_MS = 90_000;

/** The shared statement's text. Throws when the file can no longer be read. */
export async function readStatementText(uri: string): Promise<string> {
  try {
    return await new File(uri).text();
  } catch {
    throw new Error('Couldn’t read the statement on this phone. Share it again.');
  }
}

async function post<T>(session: StoredSession, path: string, body: unknown): Promise<T> {
  const res = await fetchWithTimeout(
    `${session.origin}${path}`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${session.token}`, accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    IMPORT_TIMEOUT_MS,
  );
  if (!res.ok) throw await errorFromResponse(res);
  return (await res.json()) as T;
}

/** Reads the statement on the server: its columns, first rows, and the website form's guess at which is which. */
export function previewStatement(session: StoredSession, file: { fileName: string; text: string }): Promise<StatementPreview> {
  return post<StatementPreview>(session, '/api/v1/imports/preview', file);
}

/** Books the statement, as the website's import does. */
export function importStatement(session: StoredSession, body: Record<string, unknown>): Promise<StatementImportSummary> {
  return post<StatementImportSummary>(session, '/api/v1/imports', body);
}
