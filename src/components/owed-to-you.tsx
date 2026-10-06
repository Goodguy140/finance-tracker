"use client";

import { setOwedSharePaidAction } from "@/app/actions";
import { MetaChip } from "@/components/meta-chip";
import { ServerActionForm } from "@/components/server-action-form";
import { secondaryBtnClass } from "@/components/forms/shared";
import { formatCurrency } from "@/lib/money";

export type OwedToYouItem = {
  id: string;
  name: string;
  amountCents: number;
  /** The expense it is owed on: its title, or its category when it has none. */
  expenseLabel: string;
  expenseDateDisplay: string;
  /** When it was marked paid back; null while outstanding. */
  paidDisplay: string | null;
};

/**
 * What people owe the user on one-off expenses, above the expense log. Every outstanding
 * share is listed whatever the period on screen; what was paid back lately stays a while so
 * a mistaken tap can be undone. Shares are added and changed in the expense's edit dialog.
 */
export function OwedToYouList({ items }: { items: OwedToYouItem[] }) {
  if (items.length === 0) return null;
  const outstanding = items.filter((item) => item.paidDisplay === null);
  const repaid = items.filter((item) => item.paidDisplay !== null);
  const outstandingCents = outstanding.reduce((sum, item) => sum + item.amountCents, 0);

  return (
    <section className="mb-3 space-y-2 rounded-xl border border-amber-500/25 bg-amber-950/10 p-3" data-testid="owed-to-you">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-100">Owed to you</h3>
        <span className="text-sm tabular-nums text-amber-100" data-testid="owed-to-you-total">
          {outstanding.length > 0 ? `${formatCurrency(outstandingCents)} outstanding` : "All paid back"}
        </span>
      </div>
      <p className="text-xs text-slate-500">
        Already left out of your spending. Mark each one paid when the money comes back.
      </p>
      {outstanding.length > 0 ? (
        <ul className="space-y-2">
          {outstanding.map((item) => (
            <OwedRow key={item.id} item={item} />
          ))}
        </ul>
      ) : null}
      {repaid.length > 0 ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs text-slate-400">Paid back lately · {repaid.length}</summary>
          <ul className="mt-2 space-y-2">
            {repaid.map((item) => (
              <OwedRow key={item.id} item={item} />
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

function OwedRow({ item }: { item: OwedToYouItem }) {
  const paid = item.paidDisplay !== null;
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/50 p-2.5 text-sm">
      <div className="min-w-0 flex-1">
        <p className={`font-medium leading-snug ${paid ? "text-slate-400" : "text-slate-100"}`}>
          {item.name} <span className="font-normal text-slate-400">· {formatCurrency(item.amountCents)}</span>
        </p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          <MetaChip label="For">{item.expenseLabel}</MetaChip>
          <MetaChip label="Date">{item.expenseDateDisplay}</MetaChip>
          {paid ? <MetaChip label="Paid back">{item.paidDisplay}</MetaChip> : null}
        </div>
      </div>
      <ServerActionForm action={setOwedSharePaidAction}>
        <input type="hidden" name="shareId" value={item.id} />
        <input type="hidden" name="paid" value={paid ? "false" : "true"} />
        <button
          type="submit"
          className={`${secondaryBtnClass} text-xs`}
          aria-label={paid ? `Undo: ${item.name} has not paid` : `Mark ${item.name} paid`}
        >
          {paid ? "Undo" : "Mark paid"}
        </button>
      </ServerActionForm>
    </li>
  );
}
