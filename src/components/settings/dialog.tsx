"use client";

import { useCallback, useEffect, useId, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { primaryBtnClass, secondaryBtnClass } from "@/components/forms/shared";

export const dangerBtnClass =
  "touch-manipulation inline-flex min-h-11 items-center justify-center rounded-xl border border-red-500/50 bg-red-900/60 px-4 py-2 text-sm font-medium text-red-50 transition hover:bg-red-900/85 sm:min-h-0";

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}

/** A modal in the page itself, so it looks like the app rather than the browser. */
export function ModalShell({
  titleId,
  onClose,
  children,
  wide,
}: {
  titleId: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEscape(onClose);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[250] flex items-end justify-center bg-slate-950/80 p-4 sm:items-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`max-h-[calc(100dvh-2rem)] w-full overflow-y-auto ${wide ? "max-w-lg" : "max-w-md"} space-y-4 rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl`}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** A titled modal with a close button, for a short form such as "New account". */
export function FormDialog({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const titleId = useId();
  return (
    <ModalShell titleId={titleId} onClose={onClose} wide={wide}>
      <div className="flex items-center justify-between gap-3">
        <h2 id={titleId} className="text-base font-semibold text-slate-100">
          {title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-800 hover:text-slate-100"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      {children}
    </ModalShell>
  );
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  return (
    <ModalShell titleId={titleId} onClose={onCancel}>
      <h2 id={titleId} className="text-base font-semibold text-slate-100">
        {title}
      </h2>
      <div className="text-sm text-slate-300">{body}</div>
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={secondaryBtnClass} onClick={onCancel} autoFocus>
          Cancel
        </button>
        <button type="button" className={danger ? dangerBtnClass : primaryBtnClass} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </ModalShell>
  );
}

/**
 * A panel sliding in from the right on wide screens and up from the bottom on phones, for
 * everything about one item (an account) while its list stays in view behind it.
 */
export function Drawer({
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const titleId = useId();
  useEscape(onClose);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[240] flex items-end bg-slate-950/70 sm:items-stretch sm:justify-end"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[92dvh] w-full flex-col rounded-t-2xl border border-slate-700 bg-slate-900 shadow-2xl sm:max-h-none sm:max-w-md sm:rounded-none sm:border-y-0 sm:border-r-0"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-800 px-5 pb-3 pt-[max(1rem,env(safe-area-inset-top))]">
          <div className="min-w-0">
            <h2 id={titleId} className="truncate text-lg font-semibold text-slate-50">
              {title}
            </h2>
            {subtitle ? <div className="mt-0.5 text-sm text-slate-400">{subtitle}</div> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-slate-100"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

type ConfirmRequest = {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
};

/**
 * An in-page stand-in for `window.confirm`: `ask()` opens a ConfirmDialog and resolves with
 * the answer, so it drops straight into a form's `beforeSubmit`. Render `dialog` anywhere in
 * the component.
 */
export function useConfirm(): { ask: (request: ConfirmRequest) => Promise<boolean>; dialog: ReactNode } {
  const [pending, setPending] = useState<(ConfirmRequest & { resolve: (ok: boolean) => void }) | null>(null);
  const ask = useCallback(
    (request: ConfirmRequest) => new Promise<boolean>((resolve) => setPending({ ...request, resolve })),
    [],
  );
  const settle = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };
  const dialog = pending ? (
    <ConfirmDialog
      title={pending.title}
      body={pending.body}
      confirmLabel={pending.confirmLabel}
      danger={pending.danger}
      onCancel={() => settle(false)}
      onConfirm={() => settle(true)}
    />
  ) : null;
  return { ask, dialog };
}
