"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition, type ReactNode } from "react";
import { createPortal } from "react-dom";

type ServerActionFormProps = {
  action: (formData: FormData) => Promise<unknown>;
  children: ReactNode;
  className?: string;
  onSuccess?: () => void;
};

export function ServerActionForm({ action, children, className, onSuccess }: ServerActionFormProps) {
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
        className={formClass}
        action={(formData) => {
          setError(null);
          startTransition(async () => {
            try {
              await action(formData);
              onSuccess?.();
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
