"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { confirmIdentityWithPasswordAction } from "@/app/actions/mfa";
import { inputClass, primaryBtnClass, secondaryBtnClass } from "@/components/forms/shared";
import { verifyWithPasskey } from "@/components/mfa/passkey-client";
import { FormDialog } from "@/components/settings/dialog";
import { MFA_STEP_UP_MAX_AGE_MS } from "@/lib/auth-constants";
import type { IdentityPrompt } from "@/lib/recent-identity";

/**
 * The client half of `requireRecentIdentity` (src/lib/recent-identity.ts). Gated forms pass
 * `useConfirmIdentity()` as their `beforeSubmit`: it resolves at once while the last
 * confirmation is still fresh, and otherwise asks for a passkey or the password first.
 */

type Confirm = () => Promise<boolean>;

const ConfirmIdentityContext = createContext<Confirm | null>(null);

const SSO_REAUTH_MESSAGE = "For your safety, sign out and sign back in, then try again within 5 minutes.";

export function IdentityConfirmationProvider({ prompt, children }: { prompt: IdentityPrompt; children: ReactNode }) {
  const [localFreshUntil, setLocalFreshUntil] = useState<number | null>(null);
  const [pending, setPending] = useState<((ok: boolean) => void) | null>(null);

  const freshUntil = Math.max(prompt.freshUntil ?? 0, localFreshUntil ?? 0) || null;

  const confirm = useCallback(async (): Promise<boolean> => {
    // A few seconds of margin, so a confirmation about to lapse is not trusted in flight.
    if (freshUntil != null && Date.now() < freshUntil - 5_000) return true;
    if (prompt.method === "passkey") {
      const outcome = await verifyWithPasskey();
      if (outcome.ok) {
        setLocalFreshUntil(Date.now() + MFA_STEP_UP_MAX_AGE_MS);
        return true;
      }
      if (outcome.cancelled) return false;
      throw new Error(outcome.error);
    }
    if (prompt.method === "sso") throw new Error(SSO_REAUTH_MESSAGE);
    return new Promise<boolean>((resolve) => setPending(() => resolve));
  }, [freshUntil, prompt.method]);

  const finish = (ok: boolean) => {
    pending?.(ok);
    setPending(null);
  };

  return (
    <ConfirmIdentityContext.Provider value={confirm}>
      {children}
      {pending ? (
        <PasswordDialog
          onConfirmed={(until) => {
            setLocalFreshUntil(until);
            finish(true);
          }}
          onCancel={() => finish(false)}
        />
      ) : null}
    </ConfirmIdentityContext.Provider>
  );
}

/** For a gated form's `beforeSubmit`. Outside the provider it defers to the server's check. */
export function useConfirmIdentity(): Confirm {
  return useContext(ConfirmIdentityContext) ?? (async () => true);
}

function PasswordDialog({ onConfirmed, onCancel }: { onConfirmed: (freshUntil: number) => void; onCancel: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <FormDialog title="Confirm it's you" onClose={onCancel}>
      <form
        className="space-y-3"
        data-testid="confirm-identity-dialog"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const result = await confirmIdentityWithPasswordAction({ password });
            if (result.ok) onConfirmed(result.prompt.freshUntil ?? Date.now() + MFA_STEP_UP_MAX_AGE_MS);
            else setError(result.error);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="text-sm text-slate-400">Enter your password to continue. You won&apos;t be asked again for 5 minutes.</p>
        <label className="block space-y-1.5">
          <span className="text-xs text-slate-400">Current password</span>
          <input
            type="password"
            name="currentPassword"
            autoComplete="current-password"
            autoFocus
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
        </label>
        {error ? (
          <p role="alert" className="text-xs text-red-300">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className={secondaryBtnClass}>
            Cancel
          </button>
          <button type="submit" disabled={busy} className={primaryBtnClass}>
            Confirm
          </button>
        </div>
      </form>
    </FormDialog>
  );
}
