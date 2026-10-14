"use client";

import type { ReactNode } from "react";
import { MOBILE_OVERLAY_ROOT_Z_CLASS } from "@/lib/mobile-z-index";
import { primaryBtnClass, secondaryBtnClass } from "@/components/forms";

/**
 * The frame the edit expense / edit income dialogs share: a wide dialog on desktop, a
 * full-screen sheet on phones, with the fields scrolling between a fixed header and a
 * fixed footer. Save and Delete live in the footer so they stay in view however long the
 * form grows (receipt breakdown, split lines, owed shares, a note).
 *
 * The footer sits outside the edit `<form>`, so its submit button names the form with
 * the `form` attribute.
 */
export function EditSheet({
  titleId,
  title,
  onClose,
  children,
  footer,
}: {
  titleId: string;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div
      className={`fixed inset-0 ${MOBILE_OVERLAY_ROOT_Z_CLASS} flex items-stretch justify-center bg-black/70 sm:items-center sm:p-4`}
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex h-[100dvh] w-full flex-col bg-slate-900 shadow-2xl sm:h-auto sm:max-h-[min(90dvh,48rem)] sm:max-w-2xl sm:rounded-2xl sm:border sm:border-slate-700"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-800/90 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-6 sm:pt-4">
          <h3 id={titleId} className="text-lg font-semibold text-slate-100">
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="touch-manipulation inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-800 hover:text-slate-200"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 [-webkit-overflow-scrolling:touch] sm:px-6">
          {children}
        </div>
        <div className="shrink-0 border-t border-slate-800/90 bg-slate-900 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:rounded-b-2xl sm:px-6 sm:pb-4">
          {footer}
        </div>
      </div>
    </div>
  );
}

/** The quiet text button Delete uses in the sheet footer. */
export const editSheetDeleteBtnClass =
  "touch-manipulation -ml-2 rounded-lg px-2 py-2 text-sm font-medium text-red-300 transition hover:bg-red-950/40 hover:text-red-200 disabled:opacity-50";

/** Delete on the left, Cancel and Save on the right, with the save error above them. */
export function EditSheetFooter({
  formId,
  error,
  isPending,
  deletePending,
  onClose,
  deleteControl,
}: {
  formId: string;
  error: string | null;
  isPending: boolean;
  deletePending: boolean;
  onClose: () => void;
  deleteControl: ReactNode;
}) {
  return (
    <>
      {error ? <p className="mb-2 text-sm text-red-300">{error}</p> : null}
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">{deleteControl}</div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            disabled={isPending || deletePending}
            className={`${secondaryBtnClass} py-2.5 sm:py-2`}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            form={formId}
            disabled={isPending || deletePending}
            className={`${primaryBtnClass} py-2.5 sm:py-2`}
          >
            {isPending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </>
  );
}
