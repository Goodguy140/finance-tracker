"use client";

import { useActionState, useState } from "react";
import { ServerActionForm } from "@/components/server-action-form";
import { createApiTokenAction, type CreateApiTokenState } from "@/app/actions/api-tokens";
import { revokeApiTokenAction } from "@/app/actions";
import { inputClass, primaryBtnClass, secondaryBtnClass } from "@/components/forms/shared";

export type ApiTokenRow = {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: string;
  createdAt: string;
  lastUsedAt: string | null;
};

const initialState: CreateApiTokenState = { ok: null };

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={secondaryBtnClass}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard blocked — user can still select the text manually */
        }
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export function ApiTokensPanel({ tokens }: { tokens: ApiTokenRow[] }) {
  const [state, formAction, pending] = useActionState(createApiTokenAction, initialState);

  return (
    <div role="tabpanel" aria-label="API tokens" className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-2 border-b border-slate-800/80 pb-6">
        <h2 className="text-xl font-semibold tracking-tight text-slate-50 sm:text-2xl">API tokens</h2>
        <p className="max-w-prose text-sm leading-relaxed text-slate-400">
          Connect external apps — like your Life Dashboard — to read your budgets over the API.
          Tokens are scoped to <code className="rounded bg-slate-800 px-1 py-0.5 text-xs">budgets:read</code>,
          shown once, and can be revoked anytime.
        </p>
      </header>

      {state.ok === true ? (
        <div className="space-y-3 rounded-2xl border border-emerald-500/40 bg-emerald-950/40 p-4">
          <p className="text-sm font-medium text-emerald-200">
            Token “{state.name}” created — copy it now. For your security it won’t be shown again.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-lg border border-emerald-500/30 bg-slate-950/70 px-3 py-2 font-mono text-xs text-emerald-100">
              {state.token}
            </code>
            <CopyButton value={state.token} />
          </div>
        </div>
      ) : null}

      {state.ok === false ? (
        <div className="rounded-2xl border border-red-500/40 bg-red-950/40 p-4 text-sm text-red-100">
          {state.error}
        </div>
      ) : null}

      <form action={formAction} className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="flex-1 space-y-1.5">
            <span className="text-sm font-medium text-slate-300">Token name</span>
            <input
              name="name"
              className={inputClass}
              placeholder="e.g. Life Dashboard"
              maxLength={60}
              required
              autoComplete="off"
            />
          </label>
          <button type="submit" className={primaryBtnClass} disabled={pending}>
            {pending ? "Creating…" : "Create token"}
          </button>
        </div>
      </form>

      <div className="space-y-2">
        <h3 className="text-sm font-medium text-slate-300">Your tokens</h3>
        {tokens.length === 0 ? (
          <p className="text-sm text-slate-500">No tokens yet.</p>
        ) : (
          <ul className="divide-y divide-slate-800/80 overflow-hidden rounded-2xl border border-slate-800/80">
            {tokens.map((token) => (
              <li key={token.id} className="flex flex-wrap items-center justify-between gap-3 bg-slate-950/40 p-4">
                <div className="min-w-0 space-y-1">
                  <p className="truncate text-sm font-medium text-slate-100">{token.name}</p>
                  <p className="font-mono text-xs text-slate-400">{token.tokenPrefix}…</p>
                  <p className="text-xs text-slate-500">
                    {token.scopes} · created {fmtDate(token.createdAt)} ·{" "}
                    {token.lastUsedAt ? `last used ${fmtDate(token.lastUsedAt)}` : "never used"}
                  </p>
                </div>
                <ServerActionForm action={revokeApiTokenAction}>
                  <input type="hidden" name="tokenId" value={token.id} />
                  <button type="submit" className={secondaryBtnClass}>
                    Revoke
                  </button>
                </ServerActionForm>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
