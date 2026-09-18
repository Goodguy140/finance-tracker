"use client";

import { ServerActionForm } from "@/components/server-action-form";
import {
  inputClass,
  primaryBtnClass,
} from "./shared";
import {
  updateAdminOauthSettingsAction,
  updatePasswordLoginSettingAction,
} from "@/app/actions";

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


export function AdminPasswordLoginForm({
  passwordLoginDisabled,
  configuredViaEnv,
}: {
  passwordLoginDisabled: boolean;
  configuredViaEnv: boolean;
}) {
  return (
    <ServerActionForm action={updatePasswordLoginSettingAction} className="space-y-2">
      <section className="space-y-2 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
        <h3 className="font-semibold text-slate-100">Sign-in methods</h3>
        {configuredViaEnv ? (
          <p className="text-xs text-slate-400">
            DISABLE_PASSWORD_LOGIN is set in the environment and overrides this setting. Unset it
            to manage password sign-in from here.
          </p>
        ) : null}
        <label className="flex items-center gap-2 text-slate-300">
          <input
            type="checkbox"
            name="passwordLoginDisabled"
            value="true"
            defaultChecked={passwordLoginDisabled}
            disabled={configuredViaEnv}
          />
          Disable password sign-in (single sign-on only)
        </label>
        <p className="text-xs text-slate-500">
          Passkeys keep working — they need no identity provider. Refused unless Google or
          Authentik is enabled and your own account already has that provider linked, since
          otherwise nobody can get back in.
        </p>
        <button className={primaryBtnClass} disabled={configuredViaEnv}>
          Save sign-in settings
        </button>
      </section>
    </ServerActionForm>
  );
}
