"use client";

import { useId, useMemo, useState } from "react";
import { ServerActionForm } from "@/components/server-action-form";
import { formatCurrency } from "@/lib/money";
import {
  selectClass,
  textAreaClass,
  formGridResponsive,
  spanFullSm,
  primaryBtnClass,
  LabeledField,
  CurrencyAmountInput,
  DateField,
  type Option,
  getTodayIsoDate,
} from "./shared";
import { createInvestmentFlowAction, createPortfolioSnapshotAction } from "@/app/actions";
import { overContributionMessage } from "@/components/contribution-room-panel";
import { previewContribution, roomFlowsFromData, type ContributionRoomData } from "@/lib/contribution-room";
import { dateFromYmd } from "@/lib/date-only";

export function InvestmentForms({
  accounts,
  contributionRoom,
}: {
  accounts: Option[];
  contributionRoom?: ContributionRoomData;
}) {
  const today = getTodayIsoDate();
  const flowIds = useId();
  const snapIds = useId();
  const [flowAccountId, setFlowAccountId] = useState(accounts[0]?.id ?? "");
  const [direction, setDirection] = useState<"CONTRIBUTION" | "WITHDRAWAL">("CONTRIBUTION");
  const [amount, setAmount] = useState("");
  const [flowDate, setFlowDate] = useState(today);

  // Checked as the user types, before anything is saved: the record is still allowed (it is
  // what happened), but going over costs 1% a month, so it should never be a surprise.
  const roomWarning = useMemo(() => {
    const accountType = contributionRoom?.accountTypes[flowAccountId];
    const cents = Math.round(Number(amount) * 100);
    if (!contributionRoom || !accountType || direction !== "CONTRIBUTION" || !(cents > 0) || !flowDate) return null;
    const warning = previewContribution(
      accountType,
      dateFromYmd(flowDate),
      cents,
      contributionRoom.entries,
      roomFlowsFromData(contributionRoom),
    );
    return warning ? { accountType, ...warning } : null;
  }, [contributionRoom, flowAccountId, direction, amount, flowDate]);

  return (
    <div className="space-y-6">
      <ServerActionForm
        action={createInvestmentFlowAction}
        onSuccess={() => setAmount("")}
        className={formGridResponsive}
      >
        <p className={`${spanFullSm} text-sm text-slate-300`}>Record a contribution or withdrawal.</p>
        <LabeledField label="Account" hint="Investment account for this flow.">
          <select
            id={`${flowIds}-account`}
            name="accountId"
            className={selectClass}
            value={flowAccountId}
            onChange={(e) => setFlowAccountId(e.target.value)}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </LabeledField>
        <LabeledField label="Direction" hint="Money in or out of the account.">
          <select
            id={`${flowIds}-dir`}
            name="direction"
            className={selectClass}
            value={direction}
            onChange={(e) => setDirection(e.target.value === "WITHDRAWAL" ? "WITHDRAWAL" : "CONTRIBUTION")}
          >
            <option value="CONTRIBUTION">Contribution</option>
            <option value="WITHDRAWAL">Withdrawal</option>
          </select>
        </LabeledField>
        <CurrencyAmountInput
          name="amount"
          label="Amount"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <DateField
          name="date"
          label="Flow date"
          hint="Date for this contribution or withdrawal."
          value={flowDate}
          onChange={setFlowDate}
        />
        {roomWarning ? (
          <p
            role="alert"
            className={`${spanFullSm} rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-200`}
          >
            {roomWarning.remainingBeforeCents > 0
              ? `Only ${formatCurrency(roomWarning.remainingBeforeCents)} of ${roomWarning.roomYear} ${roomWarning.accountType} room left. `
              : ""}
            {overContributionMessage(roomWarning.accountType, roomWarning.overByCents, roomWarning.roomYear)}
          </p>
        ) : null}
        <LabeledField label="Note" hint="Optional (max 250 characters)." className={spanFullSm}>
          <textarea name="note" rows={3} maxLength={250} className={textAreaClass} placeholder="Optional memo" />
        </LabeledField>
        <button type="submit" className={`${spanFullSm} ${primaryBtnClass} py-2.5 sm:py-2`}>
          {roomWarning ? "Add anyway" : "Add investment flow"}
        </button>
      </ServerActionForm>
      <ServerActionForm action={createPortfolioSnapshotAction} className={formGridResponsive}>
        <p className={`${spanFullSm} text-sm text-slate-300`}>Save a point-in-time portfolio value.</p>
        <LabeledField label="Account" hint="Which account this snapshot applies to.">
          <select id={`${snapIds}-account`} name="accountId" className={selectClass}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </LabeledField>
        <DateField name="date" label="Snapshot date" hint="As-of date for the total value below." defaultValue={today} />
        <CurrencyAmountInput
          name="totalValue"
          label="Total portfolio value"
          placeholder="0.00"
          className={spanFullSm}
        />
        <LabeledField label="Note" hint="Optional (max 250 characters)." className={spanFullSm}>
          <textarea name="note" rows={3} maxLength={250} className={textAreaClass} placeholder="Optional context" />
        </LabeledField>
        <button type="submit" className={`${spanFullSm} ${primaryBtnClass} py-2.5 sm:py-2`}>
          Save portfolio value
        </button>
      </ServerActionForm>
    </div>
  );
}
