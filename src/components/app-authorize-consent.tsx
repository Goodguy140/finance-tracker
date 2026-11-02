"use client";

import { useState, useSyncExternalStore } from "react";
import { approveAppSignInAction } from "@/app/actions/app-devices";
import { primaryBtnClass, secondaryBtnClass } from "@/components/forms/shared";
import { useConfirmIdentity } from "@/components/mfa/confirm-identity";
import { isActionFailure } from "@/lib/action-result";
import type { AuthorizeRequest } from "@/lib/app-devices";

const noopSubscribe = () => () => {};

/** The question on `/app/authorize`: let this phone in, or not. */
export function AppAuthorizeConsent({
  request,
  email,
  cancelUrl,
}: {
  request: AuthorizeRequest;
  email: string;
  cancelUrl: string;
}) {
  const confirmIdentity = useConfirmIdentity();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [returnUrl, setReturnUrl] = useState<string | null>(null);
  // Allow does nothing until the page is interactive; disabled until then, not a dead button.
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);

  async function allow() {
    setError(null);
    setPending(true);
    try {
      if (!(await confirmIdentity())) return;
      const formData = new FormData();
      formData.set("code_challenge", request.codeChallenge);
      formData.set("state", request.state);
      formData.set("device", request.deviceName);
      const result = await approveAppSignInAction(formData);
      if (isActionFailure(result)) {
        setError(result.error);
        return;
      }
      setReturnUrl(result.redirectUrl);
      // The sign-in sheet closes as soon as it sees the app's own address.
      window.location.assign(result.redirectUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  if (returnUrl) {
    return (
      <div className="space-y-3 text-sm text-slate-300">
        <p>Done. Returning you to the app…</p>
        <p>
          If nothing happens,{" "}
          <a href={returnUrl} className="font-medium text-blue-300 underline hover:text-blue-200">
            open the app
          </a>
          . The link works once, for the next minute.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-200">
        Sign in the Finance Tracker app on <strong className="text-slate-100">{request.deviceName}</strong> as{" "}
        <strong className="text-slate-100">{email}</strong>?
      </p>
      <p className="text-sm text-slate-400">
        The app can see and change your transactions, budgets and accounts until it is signed out, in the app or
        under Settings → Security. It cannot change how you sign in, delete your data, or use admin controls.
      </p>
      <p className="rounded-lg border border-amber-800/60 bg-amber-950/30 px-3 py-2 text-sm text-amber-100">
        Only allow this if you just started signing in from the app on your own phone.
      </p>
      {error ? (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={allow} disabled={pending || !hydrated} className={primaryBtnClass}>
          {pending ? "Signing in…" : "Allow"}
        </button>
        <a href={cancelUrl} className={`inline-flex items-center ${secondaryBtnClass}`}>
          Cancel
        </a>
      </div>
    </div>
  );
}
