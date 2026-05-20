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
import { updateAdminOauthSettingsAction } from "@/app/actions";

export function AdminOauthForm({
  googleEnabled,
  googleClientId,
  authentikEnabled,
  authentikIssuer,
  authentikClientId,
  authentikConfiguredViaEnv,
}: {
  googleEnabled: boolean;
  googleClientId: string;
  authentikEnabled: boolean;
  authentikIssuer: string;
  authentikClientId: string;
  authentikConfiguredViaEnv: boolean;
}) {
  return (
    <ServerActionForm action={updateAdminOauthSettingsAction} className="space-y-6">
      <section className="space-y-2 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
        <h3 className="font-semibold text-slate-100">Google OAuth</h3>
        <label className="flex items-center gap-2 text-slate-300">
          <input type="checkbox" name="googleEnabled" value="true" defaultChecked={googleEnabled} />
          Enable Google sign-in
        </label>
        <input name="googleClientId" defaultValue={googleClientId} placeholder="Google Client ID" className={inputClass} />
        <input name="googleClientSecret" type="password" placeholder="Google Client Secret (leave blank to keep)" className={inputClass} />
      </section>

      <section className="space-y-2 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
        <h3 className="font-semibold text-slate-100">Authentik SSO (OIDC)</h3>
        {authentikConfiguredViaEnv ? (
          <p className="text-xs text-slate-400">
            Authentik is configured via environment variables (AUTHENTIK_ISSUER, AUTHENTIK_CLIENT_ID,
            AUTHENTIK_CLIENT_SECRET). Those override the fields below when set.
          </p>
        ) : null}
        <label className="flex items-center gap-2 text-slate-300">
          <input type="checkbox" name="authentikEnabled" value="true" defaultChecked={authentikEnabled} />
          Enable Authentik SSO
        </label>
        <input
          name="authentikIssuer"
          defaultValue={authentikIssuer}
          placeholder="Issuer URL, e.g. https://authentik.example.com/application/o/finance-tracker/"
          className={inputClass}
        />
        <input
          name="authentikClientId"
          defaultValue={authentikClientId}
          placeholder="OIDC Client ID"
          className={inputClass}
        />
        <input
          name="authentikClientSecret"
          type="password"
          placeholder="OIDC Client Secret (leave blank to keep)"
          className={inputClass}
        />
        <p className="text-xs text-slate-500">
          In Authentik, set the redirect URI to{" "}
          <span className="font-mono text-slate-400">{"{NEXTAUTH_URL}/api/auth/callback/authentik"}</span>.
        </p>
      </section>

      <button className={primaryBtnClass}>Save OAuth settings</button>
    </ServerActionForm>
  );
}

