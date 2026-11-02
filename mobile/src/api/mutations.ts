import { useMutation, useQueryClient } from '@tanstack/react-query';

import { apiRequest } from '@/api/client';
import { useSession } from '@/session/session-provider';

/**
 * A write to a `/api/v1` route. Every cached screen is refetched afterwards, since one edit can
 * move safe to spend, a budget and the list at once.
 */
export function useApiMutation<TBody, TResult>(
  method: 'POST' | 'PATCH' | 'DELETE',
  path: (vars: TBody) => string,
  body?: (vars: TBody) => unknown,
  headers?: (vars: TBody) => Record<string, string>,
) {
  const { session } = useSession();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (vars: TBody) => {
      if (!session) throw new Error('Not signed in.');
      return apiRequest<TResult>(session, method, path(vars), body ? body(vars) : undefined, headers ? headers(vars) : undefined);
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['api'] }),
  });
}
