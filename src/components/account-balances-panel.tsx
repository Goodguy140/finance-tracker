"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { setAccountBalanceAction } from "@/app/actions";
import { AccountTypePill } from "@/components/account-type-pill";
import { ServerActionForm } from "@/components/server-action-form";
import { formatCurrency } from "@/lib/money";
import { inputClass, LabeledField, primaryBtnClass, secondaryBtnClass } from "./forms/shared";

export type AccountBalancesPanelRow = {
  accountId: string;
  name: string;
  type: string;
  currency: string;
  liability: boolean;
  /** Whether a bank feeds this account. */
  linked: boolean;
  latest: { cents: number; dateYmd: string; source: "PLAID" | "MANUAL" | "PORTFOLIO" } | null;
};

const SOURCE_LABEL = { PLAID: "from your bank", MANUAL: "entered by you", PORTFOLIO: "portfolio snapshot" } as const;

function formatYmd(ymd: string) {
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/**
 * Each account's latest balance, and a way to enter one by hand. Linked accounts update on
 * every bank sync; this is for cash, loans, property and anything else with no feed.
 */
export function AccountBalancesPanel({ rows, todayYmd }: { rows: AccountBalancesPanelRow[]; todayYmd: string }) {
  const [editing, setEditing] = useState<AccountBalancesPanelRow | null>(null);

  return (
    <section
      id="balances"
      className="scroll-mt-24 space-y-4 rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-900/85 to-slate-900/55 p-3.5 shadow-lg lg:p-4"
    >
      <div className="space-y-1 border-b border-slate-800/80 pb-3">
        <h3 className="text-lg font-semibold tracking-tight text-slate-100 lg:text-xl">Balances</h3>
        <p className="max-w-prose text-sm leading-relaxed text-slate-400">
          What each account holds, for net worth on the Reports page. Linked accounts update with every bank sync. For
          cash, a mortgage, a house or anything else without a feed, enter the balance yourself now and then.
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">No active accounts.</p>
      ) : (
        <ul className="divide-y divide-slate-800/80" data-testid="account-balances">
          {rows.map((row) => (
            <li key={row.accountId} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <div className="min-w-0 space-y-1">
                <p className="truncate text-sm font-medium text-slate-100">{row.name}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <AccountTypePill accountType={row.type} />
                  {row.latest ? (
                    <span className="text-xs text-slate-500">
                      {formatYmd(row.latest.dateYmd)}, {SOURCE_LABEL[row.latest.source]}
                    </span>
                  ) : (
                    <span className="text-xs text-slate-500">{row.linked ? "Waiting for the next bank sync" : "No balance yet"}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3">
                {row.latest ? (
                  <span className={`text-sm font-semibold tabular-nums ${row.liability ? "text-amber-200" : "text-slate-100"}`}>
                    {row.liability ? "Owes " : ""}
                    {formatCurrency(row.latest.cents, row.currency)}
                  </span>
                ) : null}
                <button
                  type="button"
                  className={secondaryBtnClass}
                  onClick={() => setEditing(row)}
                  aria-label={`Update balance for ${row.name}`}
                >
                  Update
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-[70] bg-black/50 p-4" role="dialog" aria-modal="true" aria-label={`Balance for ${editing.name}`}>
              <div className="mx-auto mt-10 w-full max-w-md rounded-2xl border border-slate-700 bg-slate-950 p-4 sm:p-5">
                <div className="mb-4 flex items-center justify-between">
                  <h4 className="text-lg font-semibold text-slate-100">Balance for {editing.name}</h4>
                  <button type="button" className={secondaryBtnClass} onClick={() => setEditing(null)}>
                    Close
                  </button>
                </div>
                <ServerActionForm action={setAccountBalanceAction} onSuccess={() => setEditing(null)} className="space-y-3">
                  <input type="hidden" name="accountId" value={editing.accountId} />
                  <LabeledField
                    label={editing.liability ? `Amount owed (${editing.currency})` : `Balance (${editing.currency})`}
                    hint={
                      editing.liability
                        ? "What you still owe, as a positive number."
                        : "Negative if the account is overdrawn."
                    }
                  >
                    <input
                      name="balance"
                      aria-label={editing.liability ? "Amount owed" : "Balance"}
                      type="number"
                      step="0.01"
                      inputMode="decimal"
                      required
                      defaultValue={editing.latest ? (editing.latest.cents / 100).toFixed(2) : ""}
                      className={inputClass}
                    />
                  </LabeledField>
                  <LabeledField label="As of" hint="An entry for a day that already has one replaces it.">
                    <input name="date" type="date" aria-label="As of" required defaultValue={todayYmd} max={todayYmd} className={inputClass} />
                  </LabeledField>
                  {editing.linked ? (
                    <p className="text-xs text-slate-500">This account is linked to a bank, so its next sync will record its balance again.</p>
                  ) : null}
                  <button type="submit" className={`${primaryBtnClass} w-full`}>
                    Save balance
                  </button>
                </ServerActionForm>
              </div>
            </div>,
            document.body,
          )
        : null}
    </section>
  );
}
