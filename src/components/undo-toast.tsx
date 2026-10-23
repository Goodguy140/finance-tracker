"use client";

import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { undoDeleteTransactionAction } from "@/app/actions";
import { isActionFailure } from "@/lib/action-result";

/**
 * "Deleted · Undo", shown for a few seconds after an expense or income entry is deleted.
 * The edit dialog that did the delete has closed by then, so the toast lives in the root
 * layout and is fed through this small module-level store.
 */

type Toast = { id: number; message: string; undoId: string };

const SHOW_MS = 8000;
let current: Toast | null = null;
let nextId = 1;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function showUndoToast(message: string, undoId: string) {
  current = { id: nextId++, message, undoId };
  emit();
}

function dismiss(id: number) {
  if (current?.id === id) {
    current = null;
    emit();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function UndoToastHost() {
  const toast = useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Keyed by toast, so a failure on one toast never shows on the next.
  const [failure, setFailure] = useState<{ id: number; message: string } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => dismiss(toast.id), SHOW_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  if (!toast) return null;
  const error = failure?.id === toast.id ? failure.message : null;
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="undo-toast"
      className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-[70] flex justify-center px-4 lg:bottom-6"
    >
      <div className="flex max-w-md items-center gap-3 rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm text-slate-100 shadow-2xl">
        <span>{error ?? toast.message}</span>
        {error ? null : (
          <button
            type="button"
            disabled={pending}
            className="font-semibold text-sky-300 hover:text-sky-200 disabled:opacity-60"
            onClick={() =>
              startTransition(async () => {
                const form = new FormData();
                form.set("undoId", toast.undoId);
                const result = await undoDeleteTransactionAction(form);
                if (isActionFailure(result)) {
                  setFailure({ id: toast.id, message: result.error });
                  return;
                }
                dismiss(toast.id);
                router.refresh();
              })
            }
          >
            {pending ? "Undoing…" : "Undo"}
          </button>
        )}
        <button
          type="button"
          aria-label="Dismiss"
          className="text-slate-500 hover:text-slate-300"
          onClick={() => dismiss(toast.id)}
        >
          ×
        </button>
      </div>
    </div>
  );
}
