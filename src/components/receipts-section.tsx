"use client";

import { useRef, useState } from "react";
import { addAttachmentAction, removeAttachmentAction } from "@/app/actions";
import { ServerActionForm } from "@/components/server-action-form";
import { ATTACHMENT_ACCEPT } from "@/lib/attachments";

export type ReceiptInfo = { id: string; fileName: string; contentType: string };

/** The receipts kept with an entry, in its edit dialog: open, add, remove. */
export function ReceiptsSection({ transactionId, receipts }: { transactionId: string; receipts: ReceiptInfo[] }) {
  const uploadRef = useRef<HTMLFormElement>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  return (
    <section aria-label="Receipts" data-testid="receipts" className="mt-4 space-y-2 border-t border-slate-800 pt-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-slate-200">Receipts</h3>
        <ServerActionForm action={addAttachmentAction} ref={uploadRef}>
          <input type="hidden" name="transactionId" value={transactionId} />
          <label className="cursor-pointer rounded-lg border border-slate-700 bg-slate-800/70 px-2.5 py-1 text-xs text-slate-200 transition hover:bg-slate-800">
            Attach receipt
            <input
              type="file"
              name="file"
              accept={ATTACHMENT_ACCEPT}
              aria-label="Attach receipt"
              className="sr-only"
              onChange={(e) => {
                if (e.target.files?.length) uploadRef.current?.requestSubmit();
              }}
            />
          </label>
        </ServerActionForm>
      </div>
      {receipts.length === 0 ? (
        <p className="text-xs text-slate-500">A photo or PDF of the receipt, kept with this entry.</p>
      ) : (
        <ul className="space-y-1.5">
          {receipts.map((receipt) => (
            <li key={receipt.id} className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/50 p-1.5">
              <a
                href={`/api/attachments/${receipt.id}`}
                target="_blank"
                rel="noopener"
                className="flex min-w-0 flex-1 items-center gap-2 text-sm text-sky-300 hover:text-sky-200"
              >
                {receipt.contentType.startsWith("image/") && receipt.contentType !== "image/heic" ? (
                  // eslint-disable-next-line @next/next/no-img-element -- an authenticated API file, not a static asset
                  <img src={`/api/attachments/${receipt.id}`} alt="" className="h-10 w-10 shrink-0 rounded object-cover" />
                ) : (
                  <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-slate-800 text-[10px] text-slate-300">
                    {receipt.contentType === "application/pdf" ? "PDF" : "IMG"}
                  </span>
                )}
                <span className="truncate">{receipt.fileName}</span>
              </a>
              {confirmingId === receipt.id ? (
                <ServerActionForm action={removeAttachmentAction} className="flex items-center gap-1.5">
                  <input type="hidden" name="attachmentId" value={receipt.id} />
                  <button type="submit" className="rounded-md bg-red-500/20 px-2 py-1 text-xs text-red-100 hover:bg-red-500/30">
                    Remove
                  </button>
                  <button type="button" className="px-1 text-xs text-slate-400" onClick={() => setConfirmingId(null)}>
                    Keep
                  </button>
                </ServerActionForm>
              ) : (
                <button
                  type="button"
                  aria-label={`Remove ${receipt.fileName}`}
                  className="px-2 text-xs text-slate-400 hover:text-red-200"
                  onClick={() => setConfirmingId(receipt.id)}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
