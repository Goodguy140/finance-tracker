"use client";

import { useActionState, useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ServerActionForm } from "@/components/server-action-form";
import { PlaidStatusPill } from "@/components/plaid-status-pill";
import { MetaChip } from "@/components/meta-chip";
import { usePlaidLink } from "@/components/plaid-link-button";
import { usePasskeyStepUp } from "@/components/mfa/passkey-client";
import { inputClass, primaryBtnClass, secondaryBtnClass } from "@/components/forms/shared";
import { mapPlaidAccountAction } from "@/app/actions";
import { syncPlaidItemAction } from "@/app/actions/plaid";
import {
  createPlaidLinkTokenAction,
  exchangePlaidPublicTokenAction,
  unlinkPlaidItemAction,
  type PlaidExchangeState,
  type PlaidLinkTokenState,
  type PlaidUnlinkState,
} from "@/app/actions/plaid";

export type PlaidAccountRow = {
  id: string;
  name: string;
  officialName: string | null;
  mask: string | null;
  typeLabel: string;
  currency: string | null;
  accountId: string | null;
  syncEnabled: boolean;
};

export type PlaidItemRow = {
  id: string;
  institutionName: string;
  status: string;
  errorMessage: string | null;
  historyLine: string;
  shortfallLine: string | null;
  lastSyncedLabel: string | null;
  consentExpiresLabel: string | null;
  /** Set when this connection is billable at Plaid but cannot currently sync. */
  costWarning: string | null;
  accounts: PlaidAccountRow[];
};

export type AccountOption = { id: string; name: string; currency: string };

export type PlaidPanelMfaState = { enrolled: boolean; freshUntil: number | null };

export type PlaidConnectionsPanelProps = {
  configured: boolean;
  environment: "sandbox" | "production" | null;
  items: PlaidItemRow[];
  accountOptions: AccountOption[];
  historyWindows: { days: number; label: string }[];
  mfa: PlaidPanelMfaState;
  /**
   * Skips the Plaid Link iframe and exchanges a fixture token instead, so the link flow
   * can be driven end to end without a Plaid account. Set from the server only, and
   * never true in production (see `plaidFakeClientEnabled`).
   */
  fakeLink: boolean;
};

const linkTokenInitial: PlaidLinkTokenState = { ok: null };
const exchangeInitial: PlaidExchangeState = { ok: null };
const unlinkInitial: PlaidUnlinkState = { ok: null };

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5 shrink-0" fill="none">
      <path d="M3 8.5l3.5 3.5L13 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PlaidConnectionsPanel({
  configured,
  environment,
  items,
  accountOptions,
  historyWindows,
  mfa,
  fakeLink,
}: PlaidConnectionsPanelProps) {
  const router = useRouter();
  const [historyDays, setHistoryDays] = useState(String(historyWindows[1]?.days ?? 90));
  const [tokenState, requestLinkToken] = useActionState(createPlaidLinkTokenAction, linkTokenInitial);
  const [exchangeState, exchange, exchanging] = useActionState(
    exchangePlaidPublicTokenAction,
    exchangeInitial,
  );
  const [unlinkState, unlink, unlinking] = useActionState(unlinkPlaidItemAction, unlinkInitial);
  const stepUp = usePasskeyStepUp(mfa.freshUntil, mfa.enrolled);
  const [stepUpError, setStepUpError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [confirmUnlinkId, setConfirmUnlinkId] = useState<string | null>(null);

  const handleSuccess = useCallback(
    (publicToken: string, _institutionName: string | null) => {
      const form = new FormData();
      form.set("publicToken", publicToken);
      form.set("historyDays", historyDays);
      startTransition(() => exchange(form));
    },
    [exchange, historyDays],
  );

  const handleExit = useCallback((message: string | null) => {
    // Closing Link is a normal thing to do; only a real error message is surfaced.
    setNotice(message);
  }, []);

  const { scriptError } = usePlaidLink({
    linkToken: !fakeLink && tokenState.ok === true ? tokenState.linkToken : null,
    onSuccess: handleSuccess,
    onExit: handleExit,
  });

  useEffect(() => {
    if (exchangeState.ok === true) router.refresh();
  }, [exchangeState, router]);

  // Test seam: stand in for what Link's onSuccess would hand back.
  const fakeExchangedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!fakeLink || tokenState.ok !== true) return;
    if (fakeExchangedFor.current === tokenState.linkToken) return;
    fakeExchangedFor.current = tokenState.linkToken;
    handleSuccess(`public-sandbox-e2e`, null);
  }, [fakeLink, tokenState, handleSuccess]);

  /** Mints a link token behind a passkey prompt; Link opens when the token arrives. */
  const connect = (plaidItemId?: string) => {
    setStepUpError(null);
    setNotice(null);
    startTransition(async () => {
      const outcome = await stepUp.ensureFresh();
      if (!outcome.ok) {
        if (!outcome.cancelled) setStepUpError(outcome.error);
        return;
      }
      const form = new FormData();
      form.set("historyDays", historyDays);
      if (plaidItemId) form.set("plaidItemId", plaidItemId);
      requestLinkToken(form);
    });
  };

  const doUnlink = (plaidItemId: string) => {
    setStepUpError(null);
    startTransition(async () => {
      const outcome = await stepUp.ensureFresh();
      if (!outcome.ok) {
        if (!outcome.cancelled) setStepUpError(outcome.error);
        return;
      }
      const form = new FormData();
      form.set("plaidItemId", plaidItemId);
      unlink(form);
      setConfirmUnlinkId(null);
    });
  };

  const busy = pending || exchanging || unlinking || stepUp.busy;
  const errorMessage =
    stepUpError ??
    scriptError ??
    (tokenState.ok === false ? tokenState.error : null) ??
    (exchangeState.ok === false ? exchangeState.error : null) ??
    (unlinkState.ok === false ? unlinkState.error : null);

  return (
    <section aria-labelledby="connected-banks-heading" className="space-y-6">
      <header className="space-y-2">
        <h3 id="connected-banks-heading" className="text-lg font-semibold tracking-tight text-slate-100 lg:text-xl">
          Connected banks
        </h3>
        <p className="max-w-prose text-sm leading-relaxed text-slate-400">
          Connect a bank to pull in transactions and confirm the ones you have already
          entered. Nothing is added to your log automatically — every synced transaction
          waits for you to review it.
        </p>
      </header>

      {!configured ? (
        <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-4 text-sm text-slate-300">
          Bank sync is not set up on this server. An administrator can configure it under{" "}
          <Link href="/settings/admin" className="font-medium underline underline-offset-4">
            Server admin → Plaid
          </Link>
          .
        </div>
      ) : null}

      {configured && environment === "sandbox" ? (
        <div className="rounded-2xl border border-amber-500/35 bg-amber-950/30 p-4 text-sm text-amber-100">
          This server is pointed at Plaid’s <strong>sandbox</strong>. Anything you connect
          returns fake data and never touches a real bank.
        </div>
      ) : null}

      {!mfa.enrolled && configured ? (
        <div className="rounded-2xl border border-amber-800/80 bg-amber-950/40 p-4 text-sm text-amber-100">
          Connecting a bank requires a passkey.{" "}
          <Link href="/settings#profile" className="font-medium underline underline-offset-4">
            Add one in Security
          </Link>{" "}
          first.
        </div>
      ) : null}

      {errorMessage ? (
        <div role="alert" className="rounded-2xl border border-red-500/40 bg-red-950/40 p-4 text-sm text-red-100">
          {errorMessage}
        </div>
      ) : null}

      {notice ? (
        <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-4 text-sm text-slate-300">{notice}</div>
      ) : null}

      {exchangeState.ok === true ? (
        <div className="rounded-2xl border border-emerald-500/40 bg-emerald-950/40 p-4 text-sm text-emerald-100">
          <span className="inline-flex items-center gap-1.5 font-medium">
            <CheckIcon /> Connected to {exchangeState.institutionName}
          </span>
          <p className="mt-1 text-emerald-100/90">
            {exchangeState.accountCount} account{exchangeState.accountCount === 1 ? "" : "s"} found.
            Transactions back to {exchangeState.cutoffDisplay} will be fetched. Map each account
            below to decide where its transactions go.
          </p>
        </div>
      ) : null}

      {unlinkState.ok === true ? (
        <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-4 text-sm text-slate-300">
          Disconnected {unlinkState.institutionName}. Transactions already in your log were kept.
        </div>
      ) : null}

      {configured ? (
        <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <h3 className="font-semibold text-slate-100">Connect a bank</h3>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-slate-300">How far back to fetch</span>
            <select
              className={inputClass}
              value={historyDays}
              onChange={(e) => setHistoryDays(e.target.value)}
              disabled={busy}
            >
              {historyWindows.map((w) => (
                <option key={w.days} value={String(w.days)}>
                  {w.label}
                </option>
              ))}
            </select>
          </label>
          {tokenState.ok === true && tokenState.cutoffNote ? (
            <p className="text-xs text-slate-400">{tokenState.cutoffNote}</p>
          ) : (
            <p className="text-xs text-slate-500">
              Chosen once, when you connect. Later syncs only pick up new transactions — they
              never reach further back on their own.
            </p>
          )}
          <button
            type="button"
            className={primaryBtnClass}
            onClick={() => connect()}
            disabled={busy || !mfa.enrolled}
          >
            {busy ? "Working…" : "Connect a bank"}
          </button>
        </section>
      ) : null}

      {items.length === 0 ? (
        configured ? (
          <p className="text-sm text-slate-500">No banks connected yet.</p>
        ) : null
      ) : (
        <ul className="space-y-4">
          {items.map((item) => (
            <li key={item.id} className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <h3 className="truncate font-semibold text-slate-100">{item.institutionName}</h3>
                  <PlaidStatusPill status={item.status} />
                </div>
                <div className="flex flex-wrap gap-2">
                  <ServerActionForm action={syncPlaidItemAction}>
                    <input type="hidden" name="plaidItemId" value={item.id} />
                    <button className={secondaryBtnClass} type="submit" disabled={busy}>
                      Sync now
                    </button>
                  </ServerActionForm>
                  {item.status === "LOGIN_REQUIRED" ? (
                    <button
                      type="button"
                      className={secondaryBtnClass}
                      onClick={() => connect(item.id)}
                      disabled={busy}
                    >
                      Sign in again
                    </button>
                  ) : null}
                  {confirmUnlinkId === item.id ? (
                    <>
                      <button
                        type="button"
                        className={secondaryBtnClass}
                        onClick={() => setConfirmUnlinkId(null)}
                        disabled={busy}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="touch-manipulation rounded-xl border border-red-400/50 bg-red-900/55 px-3 py-2 text-sm font-medium text-red-50 transition hover:bg-red-900/85"
                        onClick={() => doUnlink(item.id)}
                        disabled={busy}
                      >
                        Yes, disconnect
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className={secondaryBtnClass}
                      onClick={() => setConfirmUnlinkId(item.id)}
                      disabled={busy}
                    >
                      Disconnect
                    </button>
                  )}
                </div>
              </div>

              {confirmUnlinkId === item.id ? (
                <p className="rounded-lg border border-amber-500/35 bg-amber-950/30 px-3 py-2 text-xs text-amber-100">
                  This revokes access at Plaid as well as here. Transactions already in your log
                  stay, and keep their verified badge — it will note that the link was removed.
                </p>
              ) : null}

              {item.costWarning ? (
                <p className="rounded-lg border border-amber-500/35 bg-amber-950/25 px-3 py-2 text-xs text-amber-100">
                  {item.costWarning}
                </p>
              ) : null}

              {item.errorMessage ? (
                <p className="rounded-lg border border-red-500/35 bg-red-950/30 px-3 py-2 text-xs text-red-100">
                  {item.errorMessage}
                </p>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <MetaChip label="History">{item.historyLine}</MetaChip>
                {item.lastSyncedLabel ? <MetaChip label="Last sync">{item.lastSyncedLabel}</MetaChip> : null}
                {item.consentExpiresLabel ? (
                  <MetaChip label="Consent expires">{item.consentExpiresLabel}</MetaChip>
                ) : null}
              </div>

              {item.shortfallLine ? (
                <p className="rounded-lg border border-slate-700 bg-slate-950/50 px-3 py-2 text-xs text-slate-300">
                  {item.shortfallLine}
                </p>
              ) : null}

              <ul className="space-y-2">
                {item.accounts.map((account) => (
                  <li
                    key={account.id}
                    className="flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-950/50 p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-100">
                        {account.name}
                        {account.mask ? <span className="text-slate-500"> ••{account.mask}</span> : null}
                      </p>
                      <p className="text-xs text-slate-500">
                        {account.typeLabel}
                        {account.currency ? ` · ${account.currency}` : ""}
                      </p>
                    </div>
                    <ServerActionForm action={mapPlaidAccountAction} className="flex items-center gap-2">
                      <input type="hidden" name="plaidAccountRowId" value={account.id} />
                      <select
                        name="accountId"
                        defaultValue={account.accountId ?? ""}
                        className={inputClass}
                        aria-label={`Send ${account.name} transactions to`}
                      >
                        <option value="">Don’t sync this account</option>
                        {accountOptions.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.name} ({option.currency})
                          </option>
                        ))}
                      </select>
                      <button className={secondaryBtnClass} type="submit">
                        Save
                      </button>
                    </ServerActionForm>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
