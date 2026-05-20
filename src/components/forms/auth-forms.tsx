"use client";

import { useId, useLayoutEffect, useState, useSyncExternalStore, type ChangeEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { signIn, signOut } from "next-auth/react";
import { AccountTypePill } from "@/components/account-type-pill";
import { SsoSignInForms } from "@/components/sso-sign-in-forms";
import { ServerActionForm } from "@/components/server-action-form";
import { BudgetAlertPreferences } from "@/components/budget-alert-preferences";
import { ExpenseTitleAutocomplete } from "@/components/expense-title-autocomplete";
import { ACCOUNT_TYPE_LABELS, ACCOUNT_TYPE_ORDER } from "@/lib/account-type-labels";
import { parseImportedDate } from "@/lib/import-dates";
import { categoryIdForExpenseTitle, type ExpenseTitleSuggestion } from "@/lib/expense-title-suggestions";
import { formatCurrency, parseStatementAmount } from "@/lib/money";
import {
  inputClass,
  selectClass,
  textAreaClass,
  formGridResponsive,
  spanFullSm,
  primaryBtnClass,
  secondaryBtnClass,
  LabeledField,
  CurrencyAmountInput,
  DateField,
  type Option,
} from "./shared";
import { signupAction, requestPasswordResetAction, resetPasswordAction } from "@/app/actions";

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
          await signupAction(formData);
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

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <div className="space-y-3">
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
            window.location.href = `${origin}/`;
          } catch {
            setError("Sign-in failed. Please try again.");
          } finally {
            setPending(false);
          }
        }}
      >
        {error ? <p className="text-sm text-red-300">{error}</p> : null}
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
      <SsoSignInForms callbackUrl="/" />
    </div>
  );
}

export function LogoutButton() {
  return (
    <button onClick={() => signOut({ callbackUrl: "/login" })} className={secondaryBtnClass}>
      Logout
    </button>
  );
}

export type AddMenuFormKey = "income" | "splitExpense" | "recurring" | "investment";


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
