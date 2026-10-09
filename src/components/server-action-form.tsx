"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition, type ReactNode, type Ref } from "react";
import { createPortal } from "react-dom";
import { isActionFailure, type ActionFailure } from "@/lib/action-result";
import { canReachServer } from "@/lib/use-online-status";

export const OFFLINE_WRITE_MESSAGE = "You're offline, so this wasn't saved. Reconnect and reload the page to make changes.";

type ServerActionFormProps<R> = {
  action: (formData: FormData) => Promise<R>;
  children: ReactNode;
  className?: string;
  /** Receives what the action returned, for actions that report back (an import summary). */
  onSuccess?: (result: Exclude<R, ActionFailure>) => void;
  /**
   * Runs before the action; return false to abort silently (e.g. the user dismissed a
   * passkey prompt). Lets step-up-gated forms verify first without a second toast path.
   */
  beforeSubmit?: () => Promise<boolean>;
  /** For submitting from outside the form, e.g. once an in-page confirm dialog says yes. */
  ref?: Ref<HTMLFormElement>;
};

export function ServerActionForm<R>({ action, children, className, onSuccess, beforeSubmit, ref }: ServerActionFormProps<R>) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const dismiss = useCallback(() => setError(null), []);

  useEffect(() => {
    if (!error) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [error, dismiss]);

  const formClass = [className, pending ? "pointer-events-none opacity-65" : ""].filter(Boolean).join(" ");

  const toast =
    error !== null ? (
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="server-action-error-title"
        className="pointer-events-auto fixed inset-x-3 bottom-[max(1rem,env(safe-area-inset-bottom))] z-[300] max-h-[min(50vh,22rem)] overflow-y-auto rounded-2xl border border-red-500/45 bg-red-950/98 p-4 shadow-2xl sm:inset-x-auto sm:right-6 sm:bottom-6 sm:left-auto sm:w-[min(100%,26rem)]"
      >
        <h2 id="server-action-error-title" className="text-sm font-semibold text-red-200">
          Something went wrong
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-red-100/95">{error}</p>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            className="touch-manipulation rounded-xl border border-red-400/50 bg-red-900/55 px-3 py-2 text-sm font-medium text-red-50 transition hover:bg-red-900/85"
            onClick={dismiss}
          >
            Dismiss
          </button>
        </div>
      </div>
    ) : null;

  return (
    <>
      {typeof document !== "undefined" && error !== null ? createPortal(toast, document.body) : null}
      <form
        ref={ref}
        className={formClass}
        action={(formData) => {
          setError(null);
          // Refused up front, not queued: a write replayed later behind the person's back
          // is worse for a ledger than one that visibly did not happen.
          if (!canReachServer()) {
            setError(OFFLINE_WRITE_MESSAGE);
            return;
          }
          startTransition(async () => {
            try {
              if (beforeSubmit && !(await beforeSubmit())) return;
              const result = await action(formData);
              if (isActionFailure(result)) {
                setError(result.error);
                return;
              }
              onSuccess?.(result as Exclude<R, ActionFailure>);
              router.refresh();
            } catch (e) {
              const message =
                e instanceof Error ? e.message : "Something went wrong. Please try again.";
              setError(message);
            }
          });
        }}
      >
        {children}
      </form>
    </>
  );
}
