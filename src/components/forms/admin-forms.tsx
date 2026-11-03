"use client";

import { useState } from "react";
import { useConfirmIdentity } from "@/components/mfa/confirm-identity";
import { ServerActionForm } from "@/components/server-action-form";
import {
  inputClass,
  primaryBtnClass,
  secondaryBtnClass,
  selectClass,
  textAreaClass,
} from "./shared";
import {
  removeAdminApnsSettingsAction,
  sendApnsTestAction,
  updateAdminApnsSettingsAction,
  updateAdminOauthSettingsAction,
  updateAdminPlaidSettingsAction,
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
  const confirmIdentity = useConfirmIdentity();
  return (
    <ServerActionForm action={updateAdminOauthSettingsAction} beforeSubmit={confirmIdentity} className="space-y-6">
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
  const confirmIdentity = useConfirmIdentity();
  return (
    <ServerActionForm action={updatePasswordLoginSettingAction} beforeSubmit={confirmIdentity} className="space-y-2">
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


export function AdminPlaidForm({
  enabled,
  syncSchedulerEnabled,
  syncSchedulerForcedOffByEnv,
  clientId,
  environment,
  configuredViaEnv,
  warnings,
}: {
  enabled: boolean;
  syncSchedulerEnabled: boolean;
  syncSchedulerForcedOffByEnv: boolean;
  clientId: string;
  environment: "sandbox" | "production";
  configuredViaEnv: boolean;
  warnings: string[];
}) {
  const confirmIdentity = useConfirmIdentity();
  return (
    <ServerActionForm action={updateAdminPlaidSettingsAction} beforeSubmit={confirmIdentity} className="space-y-2">
      <section className="space-y-2 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
        <h3 className="font-semibold text-slate-100">Plaid (bank transaction sync)</h3>
        {warnings.map((warning) => (
          <p key={warning} className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
            {warning}
          </p>
        ))}
        {configuredViaEnv ? (
          <p className="text-xs text-slate-400">
            PLAID_CLIENT_ID and PLAID_SECRET are set in the environment and override the fields
            below. Both are required for the environment to take over.
          </p>
        ) : null}
        <label className="flex items-center gap-2 text-slate-300">
          <input type="checkbox" name="plaidEnabled" value="true" defaultChecked={enabled} />
          Enable Plaid bank sync
        </label>
        <label className="flex items-center gap-2 text-slate-300">
          <input
            type="checkbox"
            name="plaidSyncScheduler"
            value="true"
            defaultChecked={syncSchedulerEnabled}
          />
          Sync connected banks in the background
        </label>
        <p className="text-xs text-slate-500">
          {syncSchedulerForcedOffByEnv
            ? "PLAID_SYNC_SCHEDULER is false in the environment, so the sweep stays off whatever is ticked here. Saved anyway, and it takes effect if that variable is removed."
            : "Off means banks are only refreshed when someone presses Sync now or Sync all. Nothing the sweep finds is posted to your books either way — it waits in the review queue."}
        </p>
        <input
          name="plaidClientId"
          defaultValue={clientId}
          placeholder="Plaid client ID"
          className={inputClass}
        />
        <input
          name="plaidSecret"
          type="password"
          placeholder="Plaid secret (leave blank to keep)"
          className={inputClass}
        />
        <label className="block text-xs text-slate-400">
          Environment
          <select name="plaidEnv" defaultValue={environment} className={selectClass}>
            <option value="sandbox">Sandbox — fake data, no real bank</option>
            <option value="production">Production — real accounts, billed per item</option>
          </select>
        </label>
        <p className="text-xs text-slate-500">
          Credentials are encrypted with SERVER_SETTINGS_ENCRYPTION_KEY. Rotating that key makes
          them unreadable and every linked bank has to be relinked.
        </p>
        <button className={primaryBtnClass}>Save Plaid settings</button>
      </section>
    </ServerActionForm>
  );
}

/**
 * Apple's push key for the iPhone app. The key is never shown back; a blank key field keeps it.
 * Saving and removing need "Confirm it's you", as Plaid's credentials do.
 */
export function AdminApnsForm({
  configured,
  keySaved,
  keyId,
  teamId,
  bundleId,
}: {
  configured: boolean;
  keySaved: boolean;
  keyId: string;
  teamId: string;
  bundleId: string;
}) {
  const confirmIdentity = useConfirmIdentity();
  const [tested, setTested] = useState<string | null>(null);
  return (
    <section className="space-y-2 rounded-2xl border border-slate-800 bg-slate-900/70 p-4" data-testid="admin-apns">
      <h3 className="font-semibold text-slate-100">Apple push (iPhone app alerts)</h3>
      <p className="text-xs text-slate-400">
        {configured
          ? "A key is saved. Bill reminders, charge alerts and budget alerts reach iPhones signed in to the app that allowed notifications."
          : "No key saved, so the iPhone app gets no alerts. Create an Apple Push Notifications service key under Certificates, Identifiers & Profiles → Keys in your Apple developer account, then paste the .p8 file here."}
      </p>
      <ServerActionForm action={updateAdminApnsSettingsAction} beforeSubmit={confirmIdentity} className="space-y-2">
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="block text-xs text-slate-400">
            Key ID
            <input name="apnsKeyId" defaultValue={keyId} placeholder="ABC123DEFG" className={inputClass} autoComplete="off" />
          </label>
          <label className="block text-xs text-slate-400">
            Team ID
            <input name="apnsTeamId" defaultValue={teamId} placeholder="Membership details" className={inputClass} autoComplete="off" />
          </label>
          <label className="block text-xs text-slate-400">
            Bundle ID
            <input name="apnsBundleId" defaultValue={bundleId} className={inputClass} autoComplete="off" />
          </label>
        </div>
        <label className="block text-xs text-slate-400">
          Key (.p8)
          <textarea
            name="apnsKey"
            rows={4}
            spellCheck={false}
            autoComplete="off"
            placeholder={keySaved ? "Saved. Leave blank to keep it." : "-----BEGIN PRIVATE KEY-----"}
            className={`${textAreaClass} font-mono text-xs`}
          />
        </label>
        <p className="text-xs text-slate-500">
          Encrypted with SERVER_SETTINGS_ENCRYPTION_KEY and never shown again. Whoever holds this key can send
          notifications to the app, so keep the file somewhere safe or delete it once saved.
        </p>
        <button className={primaryBtnClass}>Save Apple push settings</button>
      </ServerActionForm>
      {configured ? (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <ServerActionForm action={sendApnsTestAction} onSuccess={(result) => setTested(result.message)}>
            <button className={secondaryBtnClass} onClick={() => setTested(null)}>
              Send a test to my iPhones
            </button>
          </ServerActionForm>
          <ServerActionForm action={removeAdminApnsSettingsAction} beforeSubmit={confirmIdentity}>
            <button className={secondaryBtnClass}>Remove key</button>
          </ServerActionForm>
          {tested ? (
            <span role="status" className="text-xs text-emerald-300">
              {tested}
            </span>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
