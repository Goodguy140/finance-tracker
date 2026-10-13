"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { startAuthentication } from "@simplewebauthn/browser";
import { beginPasswordlessSignInAction } from "@/app/actions/mfa";
import { describeWebAuthnError } from "@/components/mfa/passkey-client";
import { SsoSignInForms } from "@/components/sso-sign-in-forms";
import { ServerActionForm } from "@/components/server-action-form";
import {
  inputClass,
  primaryBtnClass,
  secondaryBtnClass,
} from "./shared";
import { signupAction, requestPasswordResetAction, resetPasswordAction } from "@/app/actions";
import { isActionFailure } from "@/lib/action-result";

export function SignupForm() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        setPending(true);
        const form = e.currentTarget;
        const formData = new FormData(form);
        try {
          const result = await signupAction(formData);
          if (isActionFailure(result)) {
            setError(result.error);
            return;
          }
          const email = String(formData.get("email") ?? "");
          const password = String(formData.get("password") ?? "");
          await signIn("credentials", {
            email,
            password,
            callbackUrl: `${window.location.origin}/`,
          });
        } catch (err) {
          setError(err instanceof Error ? err.message : "Sign up failed.");
        } finally {
          setPending(false);
        }
      }}
    >
      {error ? <p className="text-sm text-red-300">{error}</p> : null}
      <input
        name="displayName"
        required
        placeholder="Display name"
        className={inputClass}
      />
      <input
        name="email"
        required
        type="email"
        placeholder="Email"
        className={inputClass}
      />
      <input
        name="password"
        required
        type="password"
        placeholder="Password (min 8)"
        className={inputClass}
      />
      <input
        name="countryCode"
        defaultValue="CA"
        className={inputClass}
      />
      <input
        name="timezone"
        defaultValue="America/Toronto"
        className={inputClass}
      />
      <button className={primaryBtnClass} disabled={pending} type="submit">
        Create account
      </button>
    </form>
  );
}

export function LoginForm({ passwordLoginDisabled = false }: { passwordLoginDisabled?: boolean }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <div className="space-y-3">
      {error ? <p className="text-sm text-red-300">{error}</p> : null}
      {passwordLoginDisabled ? (
        <p className="rounded-lg border border-slate-700 bg-slate-950/50 px-3 py-2 text-sm text-slate-300">
          This server uses single sign-on. Continue with your provider or a passkey below.
        </p>
      ) : null}
      {passwordLoginDisabled ? null : (
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          setPending(true);
          try {
            const origin = typeof window !== "undefined" ? window.location.origin : "";
            const result = await signIn("credentials", {
              email,
              password,
              callbackUrl: `${origin}/`,
              redirect: false,
            });
            if (result?.error) {
              setError("Invalid email or password.");
              return;
            }
            if (result?.url) {
              window.location.href = result.url;
              return;
            }
            // Full page load on purpose: the session cookie was just set, and a client-side
            // router.push() would render the destination against the pre-sign-in session.
            // eslint-disable-next-line @next/next/no-location-assign-relative-destination
            window.location.href = `${origin}/`;
          } catch {
            setError("Sign-in failed. Please try again.");
          } finally {
            setPending(false);
          }
        }}
      >
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          type="email"
          placeholder="Email"
          className={inputClass}
        />
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          type="password"
          placeholder="Password"
          className={inputClass}
        />
        <button type="submit" disabled={pending} className={`w-full ${primaryBtnClass} py-2.5 sm:py-2`}>
          Login
        </button>
      </form>
      )}
      <button
        type="button"
        disabled={pending}
        className={`inline-flex w-full items-center justify-center ${secondaryBtnClass} py-2.5`}
        onClick={async () => {
          setError(null);
          setPending(true);
          try {
            const origin = window.location.origin;
            const begin = await beginPasswordlessSignInAction();
            if (!begin.ok) {
              setError(begin.error);
              return;
            }
            let response;
            try {
              response = await startAuthentication({ optionsJSON: begin.options });
            } catch (err) {
              const { cancelled, message } = describeWebAuthnError(err);
              if (!cancelled) setError(message);
              return;
            }
            const result = await signIn("passkey", {
              challengeId: begin.challengeId,
              response: JSON.stringify(response),
              callbackUrl: `${origin}/`,
              redirect: false,
            });
            if (result?.error) {
              setError("Passkey sign-in failed. Try again or use your password.");
              return;
            }
            // Full page load on purpose: the session cookie was just set (see LoginForm).
            window.location.href = result?.url ?? `${origin}/`;
          } catch {
            setError("Passkey sign-in failed. Please try again.");
          } finally {
            setPending(false);
          }
        }}
      >
        Sign in with a passkey
      </button>
      <SsoSignInForms callbackUrl="/" />
    </div>
  );
}



export function PasswordResetRequestForm() {
  return (
    <ServerActionForm action={requestPasswordResetAction} className="space-y-3">
      <input name="email" type="email" required placeholder="Email" className={inputClass} />
      <button className={primaryBtnClass}>Request reset</button>
    </ServerActionForm>
  );
}

export function PasswordResetForm() {
  return (
    <ServerActionForm action={resetPasswordAction} className="space-y-3">
      <input name="email" type="email" required placeholder="Email" className={inputClass} />
      <input name="token" required placeholder="Reset token" className={inputClass} />
      <input name="newPassword" type="password" required placeholder="New password" className={inputClass} />
      <button className={primaryBtnClass}>Reset password</button>
    </ServerActionForm>
  );
}
