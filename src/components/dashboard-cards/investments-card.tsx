"use client";

import Link from "next/link";
import { useState } from "react";
import { createPortal } from "react-dom";
import {
  countTransferTowardRoomAction,
  deleteInvestmentFlowAction,
  deletePortfolioSnapshotAction,
  updateInvestmentFlowAction,
  updatePortfolioSnapshotAction,
} from "@/app/actions";
import { InvestmentForms } from "@/components/forms/settings-forms";
import {
  CurrencyAmountInput,
  DateField,
  LabeledField,
  formGridResponsive,
  primaryBtnClass,
  secondaryBtnClass,
  selectClass,
  spanFullSm,
  textAreaClass,
  type Option,
} from "@/components/forms/shared";
import { ServerActionForm } from "@/components/server-action-form";
import {
  computeRoomYear,
  REGISTERED_ACCOUNT_TYPES,
  roomFlowsFromData,
  roomYearFor,
  type ContributionRoomData,
  type RegisteredAccountType,
} from "@/lib/contribution-room";
import { formatCurrency } from "@/lib/money";
import { MOBILE_OVERLAY_ROOT_Z_CLASS } from "@/lib/mobile-z-index";

/**
 * Everything about investment accounts on the dashboard: room left, the two add forms that
 * used to sit behind the header's Add menu, and the period's activity, which could not be
 * seen, changed or removed anywhere before.
 *
 * Transfers into a TFSA, RRSP or FHSA are listed beside the recorded contributions, because a
 * deposit synced from the bank arrives as a transfer while contribution room only counts
 * recorded contributions. "Count toward room" records one from the other, once.
 */

export type InvestmentActivityItem =
  | {
      kind: "flow";
      id: string;
      accountId: string;
      accountName: string;
      direction: "CONTRIBUTION" | "WITHDRAWAL";
      amountCents: number;
      dateYmd: string;
      dateDisplay: string;
      note: string | null;
      /** True when it was recorded from a transfer with "Count toward room". */
      fromTransfer: boolean;
    }
  | {
      kind: "snapshot";
      id: string;
      accountId: string;
      accountName: string;
      totalValueCents: number;
      dateYmd: string;
      dateDisplay: string;
      note: string | null;
    }
  | {
      /** A transfer into a registered account that does not count toward room yet. */
      kind: "transfer";
      id: string;
      accountName: string;
      amountCents: number;
      dateYmd: string;
      dateDisplay: string;
      title: string | null;
    };

/** One investment account's value and money-weighted return, as Reports shows them, rates already worded. */
export type InvestmentReturnRow = {
  /** Null for the "All together" row. */
  accountId: string | null;
  name: string;
  currency: string;
  valueCents: number;
  thisYear: string;
  twelveMonths: string;
};

export type InvestmentsCardBodyProps = {
  accounts: Option[];
  contributionRoom: ContributionRoomData;
  activity: InvestmentActivityItem[];
  /** Accounts with at least two values recorded; empty when none has. */
  returns: InvestmentReturnRow[];
  periodLabel: string;
  /** Today in the user's timezone, so the room year matches the rest of the dashboard. */
  todayYmd: string;
  showRoom?: boolean;
  showForms?: boolean;
  showReturns?: boolean;
  showActivity?: boolean;
};

export function InvestmentsCardBody({
  accounts,
  contributionRoom,
  activity,
  returns,
  periodLabel,
  todayYmd,
  showRoom = true,
  showForms = true,
  showReturns = true,
  showActivity = true,
}: InvestmentsCardBodyProps) {
  if (!showRoom && !showForms && !showReturns && !showActivity) {
    return <p className="text-sm text-slate-400">Every part of this card is turned off in its settings.</p>;
  }
  return (
    <div className="space-y-4">
      {showRoom ? <RoomSummary data={contributionRoom} todayYmd={todayYmd} /> : null}
      {showReturns && returns.length > 0 ? <ReturnsSummary rows={returns} /> : null}
      {showForms ? <InvestmentForms accounts={accounts} contributionRoom={contributionRoom} /> : null}
      {showActivity ? <ActivityList items={activity} accounts={accounts} periodLabel={periodLabel} /> : null}
    </div>
  );
}

function RoomSummary({ data, todayYmd }: { data: ContributionRoomData; todayYmd: string }) {
  const today = new Date(`${todayYmd}T00:00:00.000Z`);
  const flows = roomFlowsFromData(data);
  // Only the types someone holds or has entered room for, as on Settings → Accounts.
  const held = new Set<RegisteredAccountType>([...Object.values(data.accountTypes), ...data.entries.map((e) => e.accountType)]);
  const types = REGISTERED_ACCOUNT_TYPES.filter((type) => held.has(type));

  return (
    <section aria-label="Room left" className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-100">Room left</h3>
        <Link href="/settings/accounts#contribution-room" className="text-xs text-slate-400 underline underline-offset-2 hover:text-slate-200">
          Manage in Settings
        </Link>
      </div>
      {types.length === 0 ? (
        <p className="mt-1 text-xs text-slate-500">No TFSA, RRSP or FHSA accounts yet.</p>
      ) : (
        <ul className="mt-1 space-y-0.5 text-sm">
          {types.map((type) => {
            const room = computeRoomYear(type, roomYearFor(type, today), data.entries, flows);
            return (
              <li key={type} className="flex justify-between gap-2">
                <span className="text-slate-300">
                  {type} <span className="text-xs text-slate-500">{type === "RRSP" ? `${room.year} limit` : room.year}</span>
                </span>
                {room.remainingCents === null ? (
                  <span className="text-xs text-slate-500">No {room.year} figure yet</span>
                ) : (
                  <span className={`tabular-nums ${room.overCents > 0 ? "text-rose-300" : "text-slate-100"}`}>
                    {room.overCents > 0 ? `${formatCurrency(room.overCents)} over` : `${formatCurrency(room.remainingCents)} left`}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Each account's latest value and return, from the readings Reports' Investment returns uses. */
function ReturnsSummary({ rows }: { rows: InvestmentReturnRow[] }) {
  return (
    <section aria-label="Value and return" className="rounded-xl border border-slate-800 bg-slate-950/50 p-3" data-testid="investments-returns">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-100">Value and return</h3>
        <Link href="/reports#report-returns" className="text-xs text-slate-400 underline underline-offset-2 hover:text-slate-200">
          More on Reports
        </Link>
      </div>
      <ul className="mt-1 space-y-1 text-sm">
        {rows.map((row) => (
          <li key={row.accountId ?? "total"} className={`flex flex-wrap items-baseline justify-between gap-x-2 ${row.accountId ? "" : "border-t border-slate-800 pt-1 font-medium"}`}>
            {row.accountId ? (
              <Link href={`/accounts/${row.accountId}`} className="min-w-0 truncate text-slate-300 hover:text-sky-200 hover:underline">
                {row.name}
              </Link>
            ) : (
              <span className="text-slate-300">{row.name}</span>
            )}
            <span className="flex items-baseline gap-2 tabular-nums">
              <span className="text-slate-100">{formatCurrency(row.valueCents, row.currency)}</span>
              <span className="text-xs text-slate-400" title="Money-weighted return this calendar year, and over the last 12 months">
                {row.thisYear} this year · {row.twelveMonths} 12 mo
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ActivityList({
  items,
  accounts,
  periodLabel,
}: {
  items: InvestmentActivityItem[];
  accounts: Option[];
  periodLabel: string;
}) {
  const [editing, setEditing] = useState<InvestmentActivityItem | null>(null);

  return (
    <section aria-label="Recent activity">
      <h3 className="mb-1.5 text-sm font-semibold text-slate-100">Activity in {periodLabel}</h3>
      {items.length === 0 ? (
        <p className="text-xs text-slate-500">Nothing recorded in {periodLabel}.</p>
      ) : (
        <ul className="divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-950/40">
          {items.map((item) => (
            <ActivityRow key={`${item.kind}:${item.id}`} item={item} onEdit={() => setEditing(item)} />
          ))}
        </ul>
      )}
      {editing && editing.kind !== "transfer" && typeof document !== "undefined"
        ? createPortal(
            // Portalled: a card body is a size container, which would clip a fixed overlay to it.
            <div className={`fixed inset-0 ${MOBILE_OVERLAY_ROOT_Z_CLASS} flex items-center justify-center bg-black/60 p-3`}>
              <div
                role="dialog"
                aria-modal="true"
                aria-label={editing.kind === "flow" ? "Edit contribution or withdrawal" : "Edit portfolio value"}
                className="max-h-[min(92vh,40rem)] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-700 bg-slate-950 p-4 shadow-2xl"
              >
                <h3 className="mb-3 text-lg font-semibold text-slate-100">
                  {editing.kind === "flow" ? "Edit contribution or withdrawal" : "Edit portfolio value"}
                </h3>
                {editing.kind === "flow" ? (
                  <FlowEditForm item={editing} accounts={accounts} onDone={() => setEditing(null)} />
                ) : (
                  <SnapshotEditForm item={editing} accounts={accounts} onDone={() => setEditing(null)} />
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </section>
  );
}

function rowLabel(item: InvestmentActivityItem): string {
  if (item.kind === "flow") return item.direction === "CONTRIBUTION" ? "Contribution" : "Withdrawal";
  if (item.kind === "snapshot") return "Portfolio value";
  return "Transfer in";
}

function ActivityRow({ item, onEdit }: { item: InvestmentActivityItem; onEdit: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const label = rowLabel(item);
  const amountCents = item.kind === "snapshot" ? item.totalValueCents : item.kind === "transfer" ? -item.amountCents : item.amountCents;
  const detail = item.kind === "transfer" ? item.title : item.note;

  return (
    <li className="px-3 py-2 text-sm" aria-label={`${label}, ${item.accountName}, ${item.dateDisplay}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <span className="font-medium text-slate-100">{label}</span>
          <span className="text-slate-400"> · {item.accountName}</span>
          {item.kind === "flow" && item.fromTransfer ? (
            <span className="ml-1.5 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300">From transfer</span>
          ) : null}
          <p className="text-xs text-slate-500">
            {item.dateDisplay}
            {detail ? ` · ${detail}` : ""}
          </p>
        </div>
        <span
          className={`tabular-nums ${item.kind === "flow" && item.direction === "WITHDRAWAL" ? "text-amber-200" : "text-slate-100"}`}
        >
          {item.kind === "flow" && item.direction === "WITHDRAWAL" ? "−" : ""}
          {formatCurrency(amountCents)}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {item.kind === "transfer" ? (
          <ServerActionForm action={countTransferTowardRoomAction}>
            <input type="hidden" name="transactionId" value={item.id} />
            <button type="submit" className="rounded-lg bg-blue-500/20 px-2 py-1 text-xs font-medium text-blue-100 ring-1 ring-blue-500/40 hover:bg-blue-500/30">
              Count toward room
            </button>
          </ServerActionForm>
        ) : confirming ? (
          <div role="group" aria-label={`Delete this ${label.toLowerCase()}?`} className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
            <span>
              Delete this {label.toLowerCase()}?
              {item.kind === "flow" && item.fromTransfer ? " The transfer can be counted again." : ""}
            </span>
            <button type="button" onClick={() => setConfirming(false)} className="rounded-lg border border-slate-700 px-2 py-1 hover:bg-slate-800">
              Keep
            </button>
            <ServerActionForm action={item.kind === "flow" ? deleteInvestmentFlowAction : deletePortfolioSnapshotAction}>
              <input type="hidden" name="id" value={item.id} />
              <button type="submit" className="rounded-lg border border-rose-500/50 bg-rose-500/10 px-2 py-1 text-rose-200 hover:bg-rose-500/20">
                Delete
              </button>
            </ServerActionForm>
          </div>
        ) : (
          <>
            <button type="button" onClick={onEdit} className="rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800">
              Edit
            </button>
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800"
            >
              Delete
            </button>
          </>
        )}
      </div>
    </li>
  );
}

function AccountSelect({ accounts, defaultValue }: { accounts: Option[]; defaultValue: string }) {
  // An archived account is not in the picker, but the row still belongs to it.
  const known = accounts.some((a) => a.id === defaultValue);
  return (
    <LabeledField label="Account">
      <select name="accountId" aria-label="Account" className={selectClass} defaultValue={defaultValue}>
        {known ? null : <option value={defaultValue}>Current account</option>}
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
    </LabeledField>
  );
}

function DialogButtons({ onCancel }: { onCancel: () => void }) {
  return (
    <div className={`${spanFullSm} flex flex-col-reverse gap-2 sm:flex-row sm:justify-end`}>
      <button type="button" className={secondaryBtnClass} onClick={onCancel}>
        Cancel
      </button>
      <button type="submit" className={`${primaryBtnClass} py-2.5 sm:py-2`}>
        Save changes
      </button>
    </div>
  );
}

function FlowEditForm({
  item,
  accounts,
  onDone,
}: {
  item: Extract<InvestmentActivityItem, { kind: "flow" }>;
  accounts: Option[];
  onDone: () => void;
}) {
  return (
    <ServerActionForm action={updateInvestmentFlowAction} onSuccess={onDone} className={formGridResponsive}>
      <input type="hidden" name="id" value={item.id} />
      <AccountSelect accounts={accounts} defaultValue={item.accountId} />
      <LabeledField label="Direction">
        <select name="direction" aria-label="Direction" className={selectClass} defaultValue={item.direction}>
          <option value="CONTRIBUTION">Contribution</option>
          <option value="WITHDRAWAL">Withdrawal</option>
        </select>
      </LabeledField>
      <CurrencyAmountInput name="amount" label="Amount" placeholder="0.00" defaultValue={(item.amountCents / 100).toFixed(2)} required />
      <DateField name="date" label="Flow date" defaultValue={item.dateYmd} required />
      <LabeledField label="Note" className={spanFullSm}>
        <textarea name="note" aria-label="Note" rows={2} maxLength={250} defaultValue={item.note ?? ""} className={textAreaClass} />
      </LabeledField>
      <DialogButtons onCancel={onDone} />
    </ServerActionForm>
  );
}

function SnapshotEditForm({
  item,
  accounts,
  onDone,
}: {
  item: Extract<InvestmentActivityItem, { kind: "snapshot" }>;
  accounts: Option[];
  onDone: () => void;
}) {
  return (
    <ServerActionForm action={updatePortfolioSnapshotAction} onSuccess={onDone} className={formGridResponsive}>
      <input type="hidden" name="id" value={item.id} />
      <AccountSelect accounts={accounts} defaultValue={item.accountId} />
      <DateField name="date" label="Snapshot date" defaultValue={item.dateYmd} required />
      <CurrencyAmountInput
        name="totalValue"
        label="Total portfolio value"
        placeholder="0.00"
        defaultValue={(item.totalValueCents / 100).toFixed(2)}
        className={spanFullSm}
        required
      />
      <LabeledField label="Note" className={spanFullSm}>
        <textarea name="note" aria-label="Note" rows={2} maxLength={250} defaultValue={item.note ?? ""} className={textAreaClass} />
      </LabeledField>
      <DialogButtons onCancel={onDone} />
    </ServerActionForm>
  );
}
