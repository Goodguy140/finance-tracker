"use client";

import { useRef, useState } from "react";
import { clearUserFinancialDataAction, deleteAccountAction, importUserBackupAction } from "@/app/actions";
import { inputClass, primaryBtnClass, secondaryBtnClass } from "@/components/forms/shared";
import { ServerActionForm } from "@/components/server-action-form";
import { BACKUP_MAX_BYTES, backupTooLargeMessage } from "@/lib/backup-limits";

export function BackupForms() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [tooLarge, setTooLarge] = useState<string | null>(null);

  // Checked here because a body past the server's limit is refused before the action runs,
  // with nothing it could say about why.
  function checkSize(): boolean {
    const file = fileInput.current?.files?.[0];
    const message = file && file.size > BACKUP_MAX_BYTES ? backupTooLargeMessage(file.size) : null;
    setTooLarge(message);
    return message === null;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-prose text-sm text-slate-400">Everything in your account, as one JSON file.</p>
        <a href="/api/backup/export/me" className={primaryBtnClass}>
          Export backup JSON
        </a>
      </div>
      <form
        method="get"
        action="/api/export/transactions"
        className="space-y-3 border-t border-slate-800 pt-4"
        data-testid="transactions-csv-export"
      >
        <div>
          <p className="text-sm font-medium text-slate-200">Export transactions (CSV)</p>
          <p className="mt-0.5 max-w-prose text-xs text-slate-500">
            Every expense, income entry and transfer as a spreadsheet, with category, account, tags and note. Leave the dates
            empty for everything.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-slate-400">
            From
            <input name="from" type="date" className={`${inputClass} mt-1 block`} />
          </label>
          <label className="text-xs text-slate-400">
            To
            <input name="to" type="date" className={`${inputClass} mt-1 block`} />
          </label>
          <button type="submit" className={secondaryBtnClass}>
            Download CSV
          </button>
        </div>
      </form>
      <ServerActionForm
        action={importUserBackupAction}
        beforeSubmit={async () => checkSize()}
        className="space-y-3 border-t border-slate-800 pt-4"
      >
        <div>
          <p className="text-sm font-medium text-slate-200">Restore from a backup</p>
          <p className="mt-0.5 max-w-prose text-xs text-slate-500">
            Replaces this account&apos;s data with the file&apos;s, and disconnects any linked banks: backups do not include
            bank connections or receipts, so reconnect banks afterwards and keep any receipts you need first. Only a
            backup of this same account email is accepted.
          </p>
        </div>
        <input
          ref={fileInput}
          name="backupJson"
          type="file"
          accept="application/json,.json"
          required
          className={inputClass}
          onChange={checkSize}
        />
        {tooLarge ? (
          <p role="alert" className="text-xs text-red-300">
            {tooLarge}
          </p>
        ) : null}
        <button type="submit" className={secondaryBtnClass}>
          Import backup JSON
        </button>
      </ServerActionForm>
    </div>
  );
}

const dangerSubmitClass =
  "rounded-xl border border-red-500/50 bg-red-900/60 px-3 py-2 text-sm font-medium text-red-50 transition hover:bg-red-900/85";

/** Two irreversible actions, each behind its own typed confirmation. */
export function DangerZoneForms() {
  return (
    <div className="space-y-5">
      <ServerActionForm action={clearUserFinancialDataAction} className="space-y-2">
        <p className="text-sm font-medium text-slate-100">Clear financial data</p>
        <p className="max-w-prose text-xs text-slate-400">
          Permanently removes transactions (including splits), budgets, financial accounts, categories, recurring
          transactions, investment flows, and portfolio snapshots. Your login, profile and sessions are kept, and starter
          categories and accounts are recreated.
        </p>
        <label className="block space-y-1.5">
          <span className="text-xs text-slate-400">
            Type <span className="font-mono text-slate-200">RESET FINANCIAL DATA</span> to confirm
          </span>
          <input name="confirmation" className={inputClass} placeholder="RESET FINANCIAL DATA" autoComplete="off" />
        </label>
        <button type="submit" className={dangerSubmitClass}>
          Clear all financial data
        </button>
      </ServerActionForm>
      <ServerActionForm action={deleteAccountAction} className="space-y-2 border-t border-red-900/40 pt-5">
        <p className="text-sm font-medium text-slate-100">Delete account</p>
        <p className="max-w-prose text-xs text-slate-400">Removes your login and everything in it. This can&apos;t be undone.</p>
        <label className="block space-y-1.5">
          <span className="text-xs text-slate-400">
            Type <span className="font-mono text-slate-200">DELETE</span> to confirm
          </span>
          <input name="confirmation" className={inputClass} autoComplete="off" />
        </label>
        <button type="submit" className={dangerSubmitClass}>
          Delete account
        </button>
      </ServerActionForm>
    </div>
  );
}
