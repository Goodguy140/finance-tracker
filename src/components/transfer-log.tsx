"use client";

import { useState } from "react";
import { markAsTransferAction, unmarkTransferAction } from "@/app/actions";
import { MetaChip } from "@/components/meta-chip";
import { ServerActionForm } from "@/components/server-action-form";
import { VerifiedBadge, type VerificationInfo } from "@/components/verified-badge";
import { secondaryBtnClass } from "@/components/forms/shared";
import { formatCurrency } from "@/lib/money";

export type TransferLogEntry = {
  id: string;
  /** Positive left the account, negative arrived in it. */
  amountCents: number;
  dateDisplay: string;
  title: string | null;
  note: string | null;
  accountLabel: string;
  verification: VerificationInfo | null;
};

/**
 * The period's transfers, under the expense log. They are kept out of every total, so they
 * are listed apart from the spending rather than mixed into it, collapsed unless asked for.
 */
export function TransferLog({ entries }: { entries: TransferLogEntry[] }) {
  const [open, setOpen] = useState(false);
  if (entries.length === 0) return null;

  return (
    <section className="mt-3 space-y-2 border-t border-slate-800/80 pt-3" data-testid="transfer-log">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 text-left text-sm"
      >
        <span className="font-medium text-slate-200">
          Transfers <span className="text-slate-500">· {entries.length}</span>
        </span>
        <span className="text-xs text-slate-400">{open ? "Hide" : "Show"}</span>
      </button>
      <p className="text-xs text-slate-500">
        Money moved between your own accounts, such as card payments. Not counted as spending or income.
      </p>
      {open ? (
        <ul className="space-y-2">
          {entries.map((entry) => (
            <TransferRow key={entry.id} entry={entry} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function TransferRow({ entry }: { entry: TransferLogEntry }) {
  const arrived = entry.amountCents < 0;
  return (
    <li className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/50 p-2.5 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-snug text-slate-100">{entry.title?.trim() || "Transfer"}</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <MetaChip label={arrived ? "Into" : "From"}>{entry.accountLabel}</MetaChip>
            <MetaChip label="Date">{entry.dateDisplay}</MetaChip>
            {entry.note ? <MetaChip label="Note">{entry.note}</MetaChip> : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 text-right">
          <span className="rounded-full border border-sky-500/35 bg-sky-500/10 px-2.5 py-1 text-sm font-semibold tabular-nums text-sky-100">
            {arrived ? "In" : "Out"} {formatCurrency(Math.abs(entry.amountCents))}
          </span>
          {entry.verification ? <VerifiedBadge info={entry.verification} variant="text" /> : null}
        </div>
      </div>
      <ServerActionForm action={unmarkTransferAction}>
        <input type="hidden" name="transactionId" value={entry.id} />
        <button type="submit" className={`${secondaryBtnClass} text-xs`}>
          Not a transfer: count as {arrived ? "income" : "an expense"}
        </button>
      </ServerActionForm>
    </li>
  );
}

/** The edit dialogs' way in: books the entry as a transfer, which drops it from every total. */
export function MarkAsTransferSection({
  transactionId,
  kind,
  onDone,
}: {
  transactionId: string;
  kind: "expense" | "income";
  onDone: () => void;
}) {
  return (
    <div className="mt-4 border-t border-slate-800/90 pt-4">
      <p className="mb-2 text-xs leading-relaxed text-slate-500">
        {kind === "expense"
          ? "Paying a credit card or moving money to savings is not spending. Mark it as a transfer to take it out of your totals and budgets."
          : "Money from one of your own accounts is not income. Mark it as a transfer to take it out of your totals."}
      </p>
      <ServerActionForm action={markAsTransferAction} onSuccess={onDone}>
        <input type="hidden" name="transactionId" value={transactionId} />
        <button type="submit" className={`w-full ${secondaryBtnClass} py-2.5 sm:w-auto sm:py-2`}>
          Mark as transfer
        </button>
      </ServerActionForm>
    </div>
  );
}
