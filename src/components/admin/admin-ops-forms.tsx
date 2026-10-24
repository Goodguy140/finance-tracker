"use client";

import {
  updateOperationsSettingsAction,
  updatePlaidSyncIntervalAction,
  updatePublicSignupAction,
} from "@/app/actions";
import { SourceBadge } from "@/components/admin/ui";
import { inputClass, primaryBtnClass } from "@/components/forms/shared";
import { useConfirmIdentity } from "@/components/mfa/confirm-identity";
import { ServerActionForm } from "@/components/server-action-form";
import type { ResolvedSetting } from "@/lib/ops-settings";

/**
 * A checkbox drawn as a switch. It stays a real checkbox, so it submits with the form and
 * keeps the checkbox role that assistive tech and the e2e suite both look for.
 */
function SwitchField({
  name,
  label,
  description,
  defaultChecked,
  disabled,
}: {
  name: string;
  label: string;
  description?: string;
  defaultChecked: boolean;
  disabled?: boolean;
}) {
  return (
    <label className={`flex items-start gap-3 ${disabled ? "cursor-not-allowed opacity-70" : "cursor-pointer"}`}>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input
          type="checkbox"
          name={name}
          value="true"
          defaultChecked={defaultChecked}
          disabled={disabled}
          className="peer sr-only"
        />
        <span className="h-5 w-9 rounded-full bg-slate-700 transition-colors peer-checked:bg-sky-500 peer-focus-visible:ring-2 peer-focus-visible:ring-sky-400 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-slate-900" />
        <span className="pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm text-slate-200">{label}</span>
        {description ? <span className="block text-xs text-slate-500">{description}</span> : null}
      </span>
    </label>
  );
}

function EnvPinnedNote({ setting }: { setting: ResolvedSetting<unknown> }) {
  if (setting.source !== "environment") return null;
  return (
    <p className="text-xs text-amber-200/90">
      {setting.envName} is set in the environment and wins over this setting. Unset it to manage the value from here.
      {setting.stored !== null ? ` The saved value (${String(setting.stored)}) applies once it is removed.` : ""}
    </p>
  );
}

function SettingCard({
  title,
  setting,
  children,
}: {
  title: string;
  setting: ResolvedSetting<unknown>;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title} className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-slate-100">{title}</h3>
        <SourceBadge source={setting.source} envName={setting.envName} />
      </div>
      <EnvPinnedNote setting={setting} />
      {children}
    </section>
  );
}

export function AdminSignupPolicyForm({ status }: { status: ResolvedSetting<boolean> }) {
  const pinned = status.source === "environment";
  const confirmIdentity = useConfirmIdentity();
  return (
    <ServerActionForm action={updatePublicSignupAction} beforeSubmit={confirmIdentity}>
      <SettingCard title="Account creation" setting={status}>
        <SwitchField
          name="publicSignup"
          label="Allow anyone to create an account"
          description={
            status.value
              ? "Open: the sign-up page and first-time single sign-on both create accounts."
              : "Closed: only existing accounts can sign in. New people need an admin to create them."
          }
          defaultChecked={status.value}
          disabled={pinned}
        />
        <button className={primaryBtnClass} disabled={pinned}>
          Save sign-up policy
        </button>
      </SettingCard>
    </ServerActionForm>
  );
}

export function AdminOperationsForm({
  retention,
  recurring,
  minDays,
  maxDays,
}: {
  retention: ResolvedSetting<number>;
  recurring: ResolvedSetting<boolean>;
  minDays: number;
  maxDays: number;
}) {
  const retentionPinned = retention.source === "environment";
  const recurringPinned = recurring.source === "environment";
  return (
    <ServerActionForm action={updateOperationsSettingsAction} className="space-y-4">
      <SettingCard title="Recurring rules" setting={recurring}>
        <SwitchField
          name="recurringAutoPost"
          label="Post recurring rules automatically"
          description="Rules set to post automatically are posted by an hourly background sweep. Off pauses the sweep; each user's own due rules still post when they open the dashboard."
          defaultChecked={recurring.value}
          disabled={recurringPinned}
        />
      </SettingCard>
      <SettingCard title="Audit log retention" setting={retention}>
        <label className="block space-y-1 text-sm text-slate-300">
          <span className="block">Keep audit entries for (days)</span>
          <input
            name="auditRetentionDays"
            type="number"
            inputMode="numeric"
            min={minDays}
            max={maxDays}
            step={1}
            required
            defaultValue={retention.value}
            disabled={retentionPinned}
            className={`${inputClass} max-w-40`}
          />
        </label>
        <p className="text-xs text-slate-500">
          Between {minDays} and {maxDays} days. Older entries are pruned gradually as new ones are written, so a
          shorter window takes effect over the following hours, not instantly.
        </p>
      </SettingCard>
      <button className={primaryBtnClass}>Save operations settings</button>
    </ServerActionForm>
  );
}

export function AdminPlaidIntervalForm({
  interval,
  min,
  max,
}: {
  interval: ResolvedSetting<number>;
  min: number;
  max: number;
}) {
  const pinned = interval.source === "environment";
  return (
    <ServerActionForm action={updatePlaidSyncIntervalAction}>
      <SettingCard title="Background sync interval" setting={interval}>
        <label className="block space-y-1 text-sm text-slate-300">
          <span className="block">Minutes between syncs of each bank</span>
          <input
            name="plaidSyncIntervalMinutes"
            type="number"
            inputMode="numeric"
            min={min}
            max={max}
            step={1}
            required
            defaultValue={interval.value}
            disabled={pinned}
            className={`${inputClass} max-w-40`}
          />
        </label>
        <p className="text-xs text-slate-500">
          Between {min} and {max} minutes. Shorter means fresher review queues but more calls against Plaid&apos;s rate
          limits. The running scheduler picks the new value up after its next tick.
        </p>
        <button className={primaryBtnClass} disabled={pinned}>
          Save interval
        </button>
      </SettingCard>
    </ServerActionForm>
  );
}
