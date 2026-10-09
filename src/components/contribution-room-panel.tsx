"use client";

import { useState } from "react";
import { ServerActionForm } from "@/components/server-action-form";
import { deleteContributionRoomAction, upsertContributionRoomAction } from "@/app/actions";
import {
  computeRoomYear,
  REGISTERED_ACCOUNT_TYPES,
  RRSP_OVERCONTRIBUTION_CUSHION_CENTS,
  roomFlowsFromData,
  roomYearFor,
  type ContributionRoomData,
  type RegisteredAccountType,
  type RoomYear,
} from "@/lib/contribution-room";
import { formatCurrency } from "@/lib/money";
import {
  CurrencyAmountInput,
  formGridResponsive,
  inputClass,
  LabeledField,
  primaryBtnClass,
  secondaryBtnClass,
  selectClass,
  spanFullSm,
} from "./forms/shared";

/** Where each figure comes from, in the words CRA uses for it. */
const ROOM_SOURCE_HINT: Record<RegisteredAccountType, string> = {
  TFSA: "Your TFSA contribution room on January 1, from CRA My Account. It already includes unused room and last year's withdrawals.",
  RRSP: "The RRSP deduction limit for the year, from your notice of assessment. Contributions in the first 60 days of the next year count against it.",
  FHSA: "Your FHSA participation room for the year, from your notice of assessment. In the year you open your first FHSA, it is $8,000.",
};

function todayUtcDate() {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

export function overContributionMessage(accountType: RegisteredAccountType, overByCents: number, roomYear: number) {
  const over = formatCurrency(overByCents);
  if (accountType === "RRSP") {
    if (overByCents <= RRSP_OVERCONTRIBUTION_CUSHION_CENTS) {
      return `${over} over your ${roomYear} RRSP limit. That is inside CRA's $2,000 cushion, so no penalty yet.`;
    }
    const taxed = formatCurrency(overByCents - RRSP_OVERCONTRIBUTION_CUSHION_CENTS);
    return `${over} over your ${roomYear} RRSP limit. CRA charges 1% a month on the ${taxed} above the $2,000 cushion.`;
  }
  return `${over} over your ${roomYear} ${accountType} room. CRA charges 1% a month on the excess until it is withdrawn.`;
}

export function RoomCard({ room }: { room: RoomYear }) {
  const { accountType, year } = room;
  return (
    <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/55 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h5 className="text-sm font-semibold text-slate-100">{accountType}</h5>
        <span className="text-xs tabular-nums text-slate-500">
          {accountType === "RRSP" ? `${year} limit` : year}
        </span>
      </div>
      {room.remainingCents === null ? (
        <p className="text-xs leading-relaxed text-slate-500">
          Add your {year} figure from CRA below to see what is left.
        </p>
      ) : (
        <>
          <p
            className={`text-xl font-semibold tabular-nums ${room.overCents > 0 ? "text-rose-300" : "text-slate-50"}`}
          >
            {formatCurrency(room.remainingCents)}
            <span className="ml-1.5 text-xs font-normal text-slate-500">left</span>
          </p>
          <dl className="space-y-0.5 text-xs text-slate-400">
            <div className="flex justify-between gap-2">
              <dt>{room.source === "entered" ? "Room from CRA" : `Estimated from ${room.estimatedFromYear}`}</dt>
              <dd className="tabular-nums">{formatCurrency(room.startingRoomCents ?? 0)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>Contributed</dt>
              <dd className="tabular-nums">{formatCurrency(room.contributedCents)}</dd>
            </div>
            {accountType === "TFSA" && room.withdrawnCents > 0 ? (
              <div className="flex justify-between gap-2">
                <dt>Withdrawn, back Jan 1, {year + 1}</dt>
                <dd className="tabular-nums">{formatCurrency(room.withdrawnCents)}</dd>
              </div>
            ) : null}
          </dl>
          {room.overCents > 0 ? (
            <p role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-2 py-1.5 text-xs text-rose-200">
              {overContributionMessage(accountType, room.overCents, year)}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

export function ContributionRoomPanel({ data }: { data: ContributionRoomData }) {
  const today = todayUtcDate();
  const currentYear = today.getUTCFullYear();
  const flows = roomFlowsFromData(data);

  // Only the types someone actually holds or has entered room for; an empty FHSA card
  // would just be noise for someone with no FHSA.
  const heldTypes = new Set<RegisteredAccountType>([
    ...Object.values(data.accountTypes),
    ...data.entries.map((e) => e.accountType),
  ]);
  const types = REGISTERED_ACCOUNT_TYPES.filter((t) => heldTypes.has(t));
  const rooms = types.map((t) => computeRoomYear(t, roomYearFor(t, today), data.entries, flows));

  // Open on arrival while a type still has no figure for this year: that is the moment it is
  // needed. Held in state so saving a figure does not snap the form shut under the person.
  const [openOnArrival] = useState(() => rooms.some((room) => room.remainingCents === null));

  // Nothing to say to someone with no TFSA, RRSP or FHSA and no room on file.
  if (types.length === 0) return null;

  return (
    <section
      id="contribution-room"
      aria-label="Contribution room"
      className="scroll-mt-24 space-y-4 rounded-xl border border-slate-800 bg-slate-900/50 p-4 sm:p-5"
    >
      <div>
        <h3 className="text-base font-semibold text-slate-100">Contribution room</h3>
        <p className="mt-0.5 max-w-prose text-sm text-slate-400">
          Copy each year&apos;s room from CRA; contributions you record are subtracted, and you are warned before going over.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {rooms.map((room) => (
          <RoomCard key={room.accountType} room={room} />
        ))}
      </div>

      <details open={openOnArrival} className="group rounded-xl border border-slate-800 bg-slate-950/30">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-sm font-medium text-slate-200 [&::-webkit-details-marker]:hidden">
          <span aria-hidden className="text-slate-500 transition group-open:rotate-90">
            ›
          </span>
          Enter room from CRA
          {data.entries.length > 0 ? (
            <span className="text-xs font-normal text-slate-500">{data.entries.length} entered</span>
          ) : null}
        </summary>
        <div className="space-y-4 border-t border-slate-800 p-3">
      <ServerActionForm action={upsertContributionRoomAction} className={formGridResponsive}>
        <LabeledField label="Account type" hint="CRA gives one figure per person, however many accounts you hold.">
          <select name="accountType" className={selectClass} defaultValue={types[0] ?? "TFSA"}>
            {REGISTERED_ACCOUNT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </LabeledField>
        <LabeledField label="Year" hint="The year the room is for. Saving a year again replaces its figure.">
          <input
            name="year"
            type="number"
            min={2009}
            max={currentYear + 1}
            defaultValue={currentYear}
            className={inputClass}
            required
          />
        </LabeledField>
        <CurrencyAmountInput name="room" label="Room" placeholder="0.00" className={spanFullSm} required />
        <ul className={`${spanFullSm} space-y-1 text-xs leading-relaxed text-slate-500`}>
          {REGISTERED_ACCOUNT_TYPES.map((t) => (
            <li key={t}>
              <span className="font-medium text-slate-400">{t}:</span> {ROOM_SOURCE_HINT[t]}
            </li>
          ))}
        </ul>
        <button type="submit" className={`${spanFullSm} ${primaryBtnClass} py-2.5 sm:py-2`}>
          Save room
        </button>
      </ServerActionForm>

      {data.entries.length > 0 ? (
        <div className="space-y-2">
          <h4 className="text-xs font-medium uppercase tracking-wide text-slate-500">Entered</h4>
          <ul className="space-y-1.5">
            {data.entries.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-1.5 text-sm"
              >
                <span className="text-slate-300">
                  {entry.accountType} {entry.year}
                </span>
                <span className="ml-auto tabular-nums text-slate-200">{formatCurrency(entry.roomCents)}</span>
                <ServerActionForm action={deleteContributionRoomAction}>
                  <input type="hidden" name="id" value={entry.id} />
                  <button
                    type="submit"
                    className={`${secondaryBtnClass} px-2 py-1 text-xs`}
                    aria-label={`Remove ${entry.accountType} ${entry.year} room`}
                  >
                    Remove
                  </button>
                </ServerActionForm>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
        </div>
      </details>
    </section>
  );
}
