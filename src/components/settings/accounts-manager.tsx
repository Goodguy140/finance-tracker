"use client";

import { useMemo, useRef, useState } from "react";
import { ChevronRight, Plus, Trash2 } from "lucide-react";
import {
  createFinancialAccountAction,
  deleteAccountBalanceAction,
  deleteFinancialAccountAction,
  setAccountBalanceAction,
  setCardTermsAction,
  setFinancialAccountArchivedAction,
  updateDefaultExpenseAccountAction,
  updateFinancialAccountAction,
} from "@/app/actions";
import { AccountTypePill } from "@/components/account-type-pill";
import { RoomCard } from "@/components/contribution-room-panel";
import { inputClass, primaryBtnClass, secondaryBtnClass, selectClass } from "@/components/forms/shared";
import { ServerActionForm } from "@/components/server-action-form";
import { ConfirmDialog, Drawer, FormDialog, useConfirm } from "@/components/settings/dialog";
import { ACCOUNT_TYPE_LABELS, ACCOUNT_TYPE_ORDER, formatAccountTypeLabel } from "@/lib/account-type-labels";
import {
  computeRoomYear,
  REGISTERED_ACCOUNT_TYPES,
  roomFlowsFromData,
  roomYearFor,
  type ContributionRoomData,
  type RegisteredAccountType,
} from "@/lib/contribution-room";
import { cardUtilization, dueDayLabel, HIGH_UTILIZATION_PCT } from "@/lib/credit-cards";
import { formatCurrency } from "@/lib/money";

export type ManagedAccount = {
  id: string;
  name: string;
  type: string;
  archived: boolean;
  currency: string;
  countsAsSavings: boolean;
  /** The bank feeding it, if one is mapped. */
  linkedBank: string | null;
  /** Whether its balance counts against net worth (a loan, a card). Null when archived. */
  liability: boolean | null;
  latest: { cents: number; dateYmd: string; source: "PLAID" | "MANUAL" | "PORTFOLIO" } | null;
  /** Balances entered by hand, newest first. Bank-synced ones are not listed: a sync rewrites them. */
  manualBalances: { id: string; cents: number; dateYmd: string }[];
  /** A credit card's limit and the day of the month its payment is due. */
  creditLimitCents: number | null;
  paymentDueDay: number | null;
};

const SOURCE_LABEL = { PLAID: "from your bank", MANUAL: "entered by you", PORTFOLIO: "portfolio snapshot" } as const;

function formatYmd(ymd: string) {
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function isRegistered(type: string): type is RegisteredAccountType {
  return (REGISTERED_ACCOUNT_TYPES as readonly string[]).includes(type);
}

function todayUtcDate() {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

function BalanceText({ account, showDate = false }: { account: ManagedAccount; showDate?: boolean }) {
  if (!account.latest) return null;
  return (
    <span className="flex shrink-0 flex-col items-end" data-testid="account-row-balance">
      <span className={`text-sm font-medium tabular-nums ${account.liability ? "text-amber-200" : "text-slate-100"}`}>
        {account.liability ? "Owes " : ""}
        {formatCurrency(account.latest.cents, account.currency)}
      </span>
      {showDate ? <span className="text-[11px] text-slate-500">as of {formatYmd(account.latest.dateYmd)}</span> : null}
    </span>
  );
}

function AccountRow({
  account,
  isDefault,
  roomLine,
  onOpen,
}: {
  account: ManagedAccount;
  isDefault: boolean;
  roomLine: string | null;
  onOpen: () => void;
}) {
  const details = [
    formatAccountTypeLabel(account.type),
    account.currency,
    account.linkedBank,
    isDefault ? "default" : null,
    roomLine,
  ].filter(Boolean);
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Edit ${account.name}`}
        className="group flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/40"
      >
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-sm font-medium ${account.archived ? "text-slate-400" : "text-slate-100"}`}>
            {account.name}
          </span>
          <span className="block truncate text-xs text-slate-500">{details.join(" · ")}</span>
        </span>
        {account.linkedBank ? (
          <span className="hidden shrink-0 rounded-md border border-emerald-500/30 px-1.5 py-0.5 text-[11px] text-emerald-300 sm:inline">
            Linked
          </span>
        ) : null}
        {account.countsAsSavings ? (
          <span className="hidden shrink-0 rounded-md border border-violet-500/35 px-1.5 py-0.5 text-[11px] text-violet-200 sm:inline">
            Savings
          </span>
        ) : null}
        <BalanceText account={account} showDate />
        <ChevronRight className="h-4 w-4 shrink-0 text-slate-600 transition group-hover:text-slate-300" aria-hidden />
      </button>
    </li>
  );
}

export function AccountsManager({
  accounts,
  defaultExpenseAccountId,
  contributionRoom,
  todayYmd,
}: {
  accounts: ManagedAccount[];
  defaultExpenseAccountId: string | null;
  contributionRoom: ContributionRoomData;
  todayYmd: string;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const active = accounts.filter((a) => !a.archived);
  const archived = accounts.filter((a) => a.archived);
  const open = accounts.find((a) => a.id === openId) ?? null;

  // What is left of this year's room, per registered type, for the row's second line.
  const rooms = useMemo(() => {
    const today = todayUtcDate();
    const flows = roomFlowsFromData(contributionRoom);
    const out = new Map<RegisteredAccountType, ReturnType<typeof computeRoomYear>>();
    for (const t of REGISTERED_ACCOUNT_TYPES) {
      out.set(t, computeRoomYear(t, roomYearFor(t, today), contributionRoom.entries, flows));
    }
    return out;
  }, [contributionRoom]);
  const roomLine = (type: string) => {
    if (!isRegistered(type)) return null;
    const room = rooms.get(type);
    if (!room || room.remainingCents === null) return null;
    return room.overCents > 0
      ? `${formatCurrency(room.overCents)} over ${room.year} room`
      : `${formatCurrency(room.remainingCents)} room left in ${room.year}`;
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
          Active · {active.length}
        </p>
        <button type="button" className={primaryBtnClass} onClick={() => setAdding(true)}>
          <Plus className="mr-1 h-4 w-4" aria-hidden />
          New account
        </button>
      </div>

      {active.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-700 px-4 py-6 text-center text-sm text-slate-500">
          No active accounts. Add one, or restore an archived one.
        </p>
      ) : (
        <ul
          data-testid="account-list"
          className="divide-y divide-slate-800 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/50"
        >
          {active.map((account) => (
            <AccountRow
              key={account.id}
              account={account}
              isDefault={account.id === defaultExpenseAccountId}
              roomLine={roomLine(account.type)}
              onOpen={() => setOpenId(account.id)}
            />
          ))}
        </ul>
      )}

      {archived.length > 0 ? (
        <div className="space-y-2">
          <button
            type="button"
            aria-expanded={showArchived}
            onClick={() => setShowArchived((v) => !v)}
            className="text-sm text-slate-400 underline-offset-4 hover:text-slate-200 hover:underline"
          >
            {showArchived ? "Hide" : "Show"} {archived.length} archived account{archived.length === 1 ? "" : "s"}
          </button>
          {showArchived ? (
            <ul className="divide-y divide-slate-800 overflow-hidden rounded-xl border border-slate-800/70 bg-slate-950/40">
              {archived.map((account) => (
                <AccountRow
                  key={account.id}
                  account={account}
                  isDefault={false}
                  roomLine={null}
                  onOpen={() => setOpenId(account.id)}
                />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {adding ? (
        <FormDialog title="New account" onClose={() => setAdding(false)}>
          <ServerActionForm action={createFinancialAccountAction} onSuccess={() => setAdding(false)} className="space-y-4">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-slate-300">Name</span>
              <input name="name" placeholder="e.g. Everyday Visa" className={inputClass} required autoFocus />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-slate-300">Type</span>
              <select name="type" className={selectClass} defaultValue="CHEQUING">
                {ACCOUNT_TYPE_ORDER.map((t) => (
                  <option key={t} value={t}>
                    {ACCOUNT_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" className={secondaryBtnClass} onClick={() => setAdding(false)}>
                Cancel
              </button>
              <button type="submit" className={primaryBtnClass}>
                Add account
              </button>
            </div>
          </ServerActionForm>
        </FormDialog>
      ) : null}

      {open ? (
        <AccountDrawer
          key={open.id}
          account={open}
          isDefault={open.id === defaultExpenseAccountId}
          room={isRegistered(open.type) ? (rooms.get(open.type) ?? null) : null}
          todayYmd={todayYmd}
          onClose={() => setOpenId(null)}
        />
      ) : null}
    </div>
  );
}

function AccountDrawer({
  account,
  isDefault,
  room,
  todayYmd,
  onClose,
}: {
  account: ManagedAccount;
  isDefault: boolean;
  room: ReturnType<typeof computeRoomYear> | null;
  todayYmd: string;
  onClose: () => void;
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const removeForm = useRef<HTMLFormElement>(null);
  const defaultForm = useRef<HTMLFormElement>(null);
  const liability = account.liability ?? false;
  const { ask, dialog: confirmDialog } = useConfirm();

  return (
    <Drawer
      title={account.name}
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          <AccountTypePill accountType={account.type} />
          <span>{account.currency}</span>
          {account.archived ? <span className="text-slate-500">Archived</span> : null}
        </span>
      }
      onClose={onClose}
      footer={
        <>
          <div className="flex gap-2">
            <ServerActionForm action={setFinancialAccountArchivedAction} onSuccess={onClose}>
              <input type="hidden" name="accountId" value={account.id} />
              <input type="hidden" name="archived" value={account.archived ? "false" : "true"} />
              <button type="submit" className={secondaryBtnClass}>
                {account.archived ? "Restore" : "Archive"}
              </button>
            </ServerActionForm>
            <button
              type="button"
              className={`${secondaryBtnClass} border-red-500/40 text-red-200 hover:border-red-400/60`}
              onClick={() => setConfirmRemove(true)}
            >
              Remove…
            </button>
          </div>
          <ServerActionForm ref={removeForm} action={deleteFinancialAccountAction} onSuccess={onClose} className="hidden">
            <input type="hidden" name="accountId" value={account.id} />
          </ServerActionForm>
        </>
      }
    >
      <ServerActionForm action={updateFinancialAccountAction} onSuccess={onClose} className="space-y-4">
        <input type="hidden" name="accountId" value={account.id} />
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-slate-300">Name</span>
          <input name="name" defaultValue={account.name} className={inputClass} required />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-slate-300">Type</span>
            <select name="type" className={selectClass} defaultValue={account.type}>
              {ACCOUNT_TYPE_ORDER.map((t) => (
                <option key={t} value={t}>
                  {ACCOUNT_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-slate-300">Currency</span>
            <input name="currency" defaultValue={account.currency} maxLength={3} className={inputClass} required />
          </label>
        </div>
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            name="countsAsSavings"
            defaultChecked={account.countsAsSavings}
            className="mt-1 h-4 w-4 shrink-0 rounded border-slate-600 bg-slate-900 text-blue-500"
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-slate-200">Counts as savings</span>
            <span className="block text-xs text-slate-500">
              Transfers into it count as saved in Reports and the financial score.
            </span>
          </span>
        </label>
        <button type="submit" className={`${primaryBtnClass} w-full`}>
          Save account
        </button>
      </ServerActionForm>

      {!account.archived ? (
        <ServerActionForm ref={defaultForm} action={updateDefaultExpenseAccountAction} className="border-t border-slate-800 pt-4">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              name="defaultExpenseAccountId"
              value={account.id}
              defaultChecked={isDefault}
              onChange={() => defaultForm.current?.requestSubmit()}
              className="mt-1 h-4 w-4 shrink-0 rounded border-slate-600 bg-slate-900 text-blue-500"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-slate-200">Default for new expenses</span>
              <span className="block text-xs text-slate-500">
                Picked first on the dashboard&apos;s Add card and in CSV import. Saves as you tick it.
              </span>
            </span>
          </label>
        </ServerActionForm>
      ) : null}

      {!account.archived && account.liability !== null ? (
        <section aria-label="Balance" data-testid="account-balance" className="space-y-3 border-t border-slate-800 pt-4">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-semibold text-slate-100">Balance</h3>
            <BalanceText account={account} />
          </div>
          <p className="text-xs text-slate-500">
            {account.latest
              ? `${formatYmd(account.latest.dateYmd)}, ${SOURCE_LABEL[account.latest.source]}.`
              : account.linkedBank
                ? "Waiting for the next bank sync."
                : "No balance yet. Enter one now and then for net worth on Reports."}
            {account.linkedBank ? " The bank updates it on every sync." : ""}
          </p>
          <ServerActionForm action={setAccountBalanceAction} onSuccess={onClose} className="grid grid-cols-2 gap-3">
            <input type="hidden" name="accountId" value={account.id} />
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-slate-400">
                {liability ? `Amount owed (${account.currency})` : `Balance (${account.currency})`}
              </span>
              <input
                name="balance"
                aria-label={liability ? "Amount owed" : "Balance"}
                type="number"
                step="0.01"
                inputMode="decimal"
                required
                defaultValue={account.latest ? (account.latest.cents / 100).toFixed(2) : ""}
                className={inputClass}
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-slate-400">As of</span>
              <input name="date" type="date" aria-label="As of" required defaultValue={todayYmd} max={todayYmd} className={inputClass} />
            </label>
            <button type="submit" className={`${secondaryBtnClass} col-span-2`}>
              Save balance
            </button>
          </ServerActionForm>
          {account.manualBalances.length > 0 ? (
            <div className="space-y-1.5" data-testid="manual-balances">
              <h4 className="text-xs font-medium text-slate-400">Entered by you</h4>
              <ul className="divide-y divide-slate-800/80 rounded-xl border border-slate-800">
                {account.manualBalances.map((entry) => (
                  <li key={entry.id} className="flex items-center justify-between gap-3 px-3 py-1.5">
                    <span className="text-sm text-slate-300">{formatYmd(entry.dateYmd)}</span>
                    <span className="ml-auto text-sm tabular-nums text-slate-200">
                      {formatCurrency(entry.cents, account.currency)}
                    </span>
                    <ServerActionForm
                      action={deleteAccountBalanceAction}
                      beforeSubmit={() =>
                        ask({
                          title: "Delete this balance?",
                          body: `The ${formatCurrency(entry.cents, account.currency)} you entered for ${formatYmd(entry.dateYmd)} is removed, and net worth on Reports no longer counts it.`,
                          confirmLabel: "Delete balance",
                          danger: true,
                        })
                      }
                    >
                      <input type="hidden" name="id" value={entry.id} />
                      <button
                        type="submit"
                        aria-label={`Delete balance from ${formatYmd(entry.dateYmd)}`}
                        className="rounded-lg p-1 text-slate-500 transition hover:bg-slate-800 hover:text-red-300"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </button>
                    </ServerActionForm>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {!account.archived && account.type === "CREDIT_CARD" ? <CardTerms account={account} onSaved={onClose} /> : null}

      {room ? (
        <section aria-label="Contribution room" className="space-y-2 border-t border-slate-800 pt-4">
          <h3 className="text-sm font-semibold text-slate-100">Contribution room</h3>
          <RoomCard room={room} />
          <p className="text-xs text-slate-500">
            One figure per person, shared by every {room.accountType} you hold. Enter it under Contribution room on this page.
          </p>
        </section>
      ) : null}

      {confirmRemove ? (
        <ConfirmDialog
          title={`Remove “${account.name}”?`}
          body="The account is deleted. Past transactions recorded against it are kept, with no account. This can't be undone; archive it instead to just hide it."
          confirmLabel="Remove account"
          danger
          onCancel={() => setConfirmRemove(false)}
          onConfirm={() => {
            setConfirmRemove(false);
            removeForm.current?.requestSubmit();
          }}
        />
      ) : null}
      {confirmDialog}
    </Drawer>
  );
}

function CardTerms({ account, onSaved }: { account: ManagedAccount; onSaved: () => void }) {
  const utilization = cardUtilization(account.latest?.cents, account.creditLimitCents);
  return (
    <section aria-label="Card" data-testid="card-terms" className="space-y-3 border-t border-slate-800 pt-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-100">Card</h3>
        {utilization ? (
          <span className={`text-sm tabular-nums ${utilization.high ? "text-amber-200" : "text-slate-300"}`}>
            {utilization.pct}% used
          </span>
        ) : null}
      </div>
      <p className="text-xs text-slate-500">
        {utilization?.high
          ? `Over ${HIGH_UTILIZATION_PCT}% of the limit, which weighs on a credit score. Paying it down before the statement date helps.`
          : `The limit shows how much of it is used (keeping under ${HIGH_UTILIZATION_PCT}% helps a credit score). The due day puts the payment in Insights and bill reminders.`}
        {account.paymentDueDay ? ` Due on ${dueDayLabel(account.paymentDueDay)} of each month.` : ""}
      </p>
      <ServerActionForm action={setCardTermsAction} onSuccess={onSaved} className="grid grid-cols-2 gap-3">
        <input type="hidden" name="accountId" value={account.id} />
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-slate-400">Credit limit ({account.currency})</span>
          <input
            name="creditLimit"
            aria-label="Credit limit"
            inputMode="decimal"
            placeholder="5000.00"
            defaultValue={account.creditLimitCents === null ? "" : (account.creditLimitCents / 100).toFixed(2)}
            className={inputClass}
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-slate-400">Payment due day</span>
          <input
            name="dueDay"
            aria-label="Payment due day"
            type="number"
            min={1}
            max={31}
            placeholder="21"
            defaultValue={account.paymentDueDay ?? ""}
            className={inputClass}
          />
        </label>
        <button type="submit" className={`${secondaryBtnClass} col-span-2`}>
          Save card details
        </button>
      </ServerActionForm>
    </section>
  );
}
