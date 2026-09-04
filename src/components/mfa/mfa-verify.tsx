"use client";

import { useState, useTransition } from "react";
import { signOut } from "next-auth/react";
import { redeemRecoveryCodeAction } from "@/app/actions/mfa";
import { inputClass, primaryBtnClass, secondaryBtnClass } from "@/components/forms/shared";
import { verifyWithPasskey } from "./passkey-client";

export function MfaVerify({
  next,
  email,
  recoveryCodesRemaining,
}: {
  next: string;
  email: string;
  recoveryCodesRemaining: number;
}) {
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"passkey" | "recovery">("passkey");
  const [code, setCode] = useState("");
  const [pending, startTransition] = useTransition();

  // Full page load on purpose: the verified cookie was just set, and a client-side
  // navigation would render the destination against the pre-verification request.
  const proceed = () => window.location.assign(next);

  const usePasskey = () => {
    setError(null);
    startTransition(async () => {
      const outcome = await verifyWithPasskey();
      if (outcome.ok) proceed();
      else if (!outcome.cancelled) setError(outcome.error);
    });
  };

  const submitRecoveryCode = () => {
    setError(null);
    startTransition(async () => {
      const outcome = await redeemRecoveryCodeAction({ code });
      if (outcome.ok) proceed();
      else setError(outcome.error);
    });
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-400">
        Signed in as <span className="font-medium text-slate-200">{email}</span>. This account is protected by a
        passkey — confirm it&rsquo;s you to continue.
      </p>
      {error ? (
        <p role="alert" className="rounded-lg border border-red-500/40 bg-red-950/40 px-3 py-2 text-sm text-red-100">
          {error}
        </p>
      ) : null}

      {mode === "passkey" ? (
        <div className="space-y-3">
          <button type="button" onClick={usePasskey} disabled={pending} className={`w-full ${primaryBtnClass} py-2.5`}>
            {pending ? "Waiting for your passkey…" : "Use passkey"}
          </button>
          {recoveryCodesRemaining > 0 ? (
            <button
              type="button"
              className="text-sm font-medium text-blue-300 underline-offset-4 hover:text-blue-200 hover:underline"
              onClick={() => {
                setError(null);
                setMode("recovery");
              }}
            >
              Lost your passkey? Use a recovery code
            </button>
          ) : null}
        </div>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            submitRecoveryCode();
          }}
        >
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-slate-300">Recovery code</span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className={inputClass}
              placeholder="xxxxx-xxxxx"
              autoComplete="one-time-code"
              autoCapitalize="off"
              spellCheck={false}
              required
            />
          </label>
          <p className="text-xs text-slate-500">
            Each code works once. {recoveryCodesRemaining} remaining — after signing in, add a new passkey and
            generate fresh codes.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={pending} className={primaryBtnClass}>
              {pending ? "Checking…" : "Use recovery code"}
            </button>
            <button type="button" className={secondaryBtnClass} onClick={() => setMode("passkey")}>
              Back to passkey
            </button>
          </div>
        </form>
      )}

      <div className="border-t border-slate-800/80 pt-3">
        <button
          type="button"
          className="text-sm text-slate-400 underline-offset-4 hover:text-slate-200 hover:underline"
          onClick={() => signOut({ callbackUrl: "/login" })}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
