"use client";

import { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { verifyTotpAction } from "@/app/actions/mfa";
import { inputClass, primaryBtnClass, secondaryBtnClass } from "@/components/forms/shared";
import { FormDialog } from "@/components/settings/dialog";
import { MFA_STEP_UP_MAX_AGE_MS } from "@/lib/auth-constants";
import type { MfaFactors } from "@/lib/recent-identity";
import { verifyWithPasskey, type PasskeyOutcome } from "./passkey-client";

/**
 * Step-up with whichever second factor the account has. Passkey only: the browser's passkey
 * prompt, as before. With an authenticator app: an in-page dialog for the six-digit code,
 * offering the passkey instead when there is one too. Resolves like `verifyWithPasskey`, so
 * callers treat both the same.
 */
export async function verifySecondFactor(factors: MfaFactors): Promise<PasskeyOutcome> {
  if (!factors.totp) return verifyWithPasskey();
  return new Promise<PasskeyOutcome>((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (outcome: PasskeyOutcome) => {
      root.unmount();
      host.remove();
      resolve(outcome);
    };
    root.render(<TotpCodeDialog passkey={factors.passkey} onDone={done} />);
  });
}

function TotpCodeDialog({ passkey, onDone }: { passkey: boolean; onDone: (outcome: PasskeyOutcome) => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cancel = () => onDone({ ok: false, cancelled: true, error: "Cancelled." });

  return (
    <FormDialog title="Confirm it's you" onClose={cancel}>
      <form
        className="space-y-3"
        data-testid="totp-step-up-dialog"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const result = await verifyTotpAction({ code });
            if (result.ok) onDone({ ok: true });
            else setError(result.error);
          } finally {
            setBusy(false);
          }
        }}
      >
        <TotpCodeField value={code} onChange={setCode} autoFocus />
        {error ? (
          <p role="alert" className="text-xs text-red-300">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          {passkey ? (
            <button
              type="button"
              className={secondaryBtnClass}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                const outcome = await verifyWithPasskey();
                setBusy(false);
                if (outcome.ok) onDone(outcome);
                else if (!outcome.cancelled) setError(outcome.error);
              }}
            >
              Use a passkey instead
            </button>
          ) : null}
          <button type="button" onClick={cancel} className={secondaryBtnClass}>
            Cancel
          </button>
          <button type="submit" disabled={busy || code.replace(/\s/g, "").length !== 6} className={primaryBtnClass}>
            Confirm
          </button>
        </div>
      </form>
    </FormDialog>
  );
}

/** The six-digit code input, shared by the `/mfa` wall, step-up and setup. */
export function TotpCodeField({
  value,
  onChange,
  autoFocus,
  label = "Code from your authenticator app",
}: {
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
  label?: string;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-slate-300">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d\s]/g, "").slice(0, 7))}
        className={inputClass}
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="123456"
        autoFocus={autoFocus}
        required
      />
    </label>
  );
}

/**
 * Step-up gate for the client. `freshUntil` is the server's view when the page rendered;
 * a successful prompt extends it locally so several gated actions in a row need one prompt.
 */
export function useStepUp(initialFreshUntil: number | null, factors: MfaFactors) {
  const enrolled = factors.passkey || factors.totp;
  const [localFreshUntil, setFreshUntil] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  // Whichever is newer: the server's view at render time, or a prompt passed since.
  const freshUntil = Math.max(initialFreshUntil ?? 0, localFreshUntil ?? 0) || null;
  const isFresh = useCallback(() => freshUntil != null && Date.now() < freshUntil - 5_000, [freshUntil]);

  const ensureFresh = useCallback(async (): Promise<PasskeyOutcome> => {
    if (!enrolled) {
      return {
        ok: false,
        cancelled: false,
        code: "mfa_required",
        error: "Add a passkey or an authenticator app in Settings → Security before linking external accounts.",
      };
    }
    if (isFresh()) return { ok: true };
    setBusy(true);
    try {
      const outcome = await verifySecondFactor(factors);
      if (outcome.ok) setFreshUntil(Date.now() + MFA_STEP_UP_MAX_AGE_MS);
      return outcome;
    } finally {
      setBusy(false);
    }
  }, [enrolled, factors, isFresh]);

  return { ensureFresh, isFresh, busy, enrolled };
}
